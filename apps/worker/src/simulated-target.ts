/**
 * [SIMULATED TARGET]
 *
 * An in-memory target that implements the remote-ledger contract, for
 * building and testing the care loop. It is never a real server: it does not
 * open connections, run processes or touch files. Fault injection exists ONLY
 * here (execution-security invariant 11).
 *
 * Contract implemented (Technical Spec §8.2, §9.3):
 *  - verifies schema version, operation, signing key id and signature,
 *    installation and server binding, and the acceptance deadline
 *  - claims the operation id atomically in its ledger; identical resubmission
 *    returns "existing", same id with a different digest is rejected
 *  - one active operation per target (server-wide change lock)
 *  - rechecks the precondition digest at acceptance
 *  - work continues regardless of the caller's connection (invariant 6)
 */

import {
  canonicalJson,
  digestOf,
  MANIFEST_SCHEMA_VERSION,
  verifyManifestSignature,
  type BootPreview,
  type DirectoriesPreview,
  type PackageChange,
  type ServicePreview,
  type SignedManifest,
  type TransactionPreview,
} from "@servrsit/domain";
import {
  TransportError,
  type DirectoryState,
  type QueryResult,
  type RejectCode,
  type RemoteRecord,
  type ServiceState,
  type SubmitResult,
  type TargetIdentity,
  type WriteTarget,
} from "./target.js";

export interface SimulatedFaults {
  /** The next submit never reaches the target (nothing is claimed). */
  dropNextSubmitBeforeSend?: boolean;
  /** The next submit is claimed and accepted, but the response is lost. */
  loseNextSubmitAck?: boolean;
  /** The next N queries fail with a transport error. */
  failQueries?: number;
  /** T-058: the next N previews fail with a transport error (target unreachable while planning). */
  failPreviews?: number;
  /** T-059: a restart leaves the unit inactive (the restart did not work). */
  restartLeavesInactive?: boolean;
  /** T-059: a reboot does not happen (same boot id afterwards). */
  rebootKeepsBootId?: boolean;
  /** T-059: these directory paths fail to be created. */
  directoryCreateFails?: string[];
  /** The next N inspections fail with a transport error. */
  failInspections?: number;
  /** Packages that the run reports as done but does NOT actually change (postcondition test). */
  silentlyUnchanged?: string[];
  /** Exit code the run reports. */
  exitCode?: number;
}

export interface SimulatedTargetOptions {
  readonly serverId: string;
  readonly installationId: string;
  readonly hostKeyFingerprint: string;
  readonly trustedKeys: Readonly<Record<string, string>>;
  /** Installed versions, keyed "name:arch". */
  readonly installed: Record<string, string>;
  /** Upgrades available, as the preview will report them. */
  readonly upgrades: PackageChange[];
  readonly now: () => Date;
  /** How long a run takes in simulated time. */
  readonly runMs?: number;
  /**
   * [SIMULATED] T-056: the machine id this target reports. Without one, the target is its own
   * machine: its identity is made unique to its serverId, so fixtures that reuse one host-key
   * fingerprint for unrelated simulated servers are not mistaken for clones. Pass a machineId to
   * model aliases and clones.
   */
  readonly machineId?: string;
  /** [SIMULATED] T-059: service units on this machine. */
  readonly services?: Readonly<Record<string, { readonly active: boolean }>>;
  /** [SIMULATED] T-059: the current boot id. */
  readonly bootId?: string;
  /** [SIMULATED] T-059: paths that already exist (directories, with owner/group/mode). */
  readonly directories?: Readonly<Record<string, { readonly owner: string; readonly group: string; readonly mode: string }>>;
}

interface LedgerEntry {
  readonly operationId: string;
  readonly manifestDigest: string;
  readonly signed: SignedManifest;
  readonly startedAt: number;
  finished: boolean;
  exitCode: number | null;
}

/** [SIMULATED] Origin given to fixture upgrades that do not name one. */
export const SIMULATED_DEFAULT_ORIGIN = "Ubuntu:24.04/noble-updates";

export class SimulatedTarget implements WriteTarget {
  readonly kind = "simulated" as const;
  readonly serverId: string;
  readonly hostKeyFingerprint: string;
  readonly machineId: string;
  private readonly explicitIdentity: boolean;
  readonly faults: SimulatedFaults = {};
  /** Every claim ever made, for tests: a second mutation would show up here. */
  readonly claims: string[] = [];
  /** Number of submit calls that reached the target. */
  submitsReceived = 0;
  private readonly ledger = new Map<string, LedgerEntry>();
  private readonly installed: Record<string, string>;
  private upgrades: PackageChange[];
  private readonly services = new Map<string, { active: boolean; activeSince: string | null }>();
  private bootId: string;
  private reboots = 0;
  private readonly directories = new Map<string, { owner: string; group: string; mode: string }>();

  constructor(private readonly options: SimulatedTargetOptions) {
    this.serverId = options.serverId;
    this.hostKeyFingerprint = options.hostKeyFingerprint;
    this.machineId = options.machineId ?? `sim-machine-${options.serverId}`;
    this.explicitIdentity = options.machineId !== undefined;
    this.installed = { ...options.installed };
    this.upgrades = [...options.upgrades];
    const started = new Date(options.now().getTime() - 3600_000).toISOString();
    for (const [unit, s] of Object.entries(options.services ?? {})) this.services.set(unit, { active: s.active, activeSince: s.active ? started : null });
    this.bootId = options.bootId ?? `sim-boot-${options.serverId}`;
    for (const [path, d] of Object.entries(options.directories ?? {})) this.directories.set(path, { ...d });
  }

  // ---- T-059: per-kind state and digests -------------------------------------------

  private serviceDigest(unit: string): string {
    return digestOf({ unit, service: this.services.get(unit) ?? null });
  }

  private bootDigest(): string {
    return digestOf({ bootId: this.bootId });
  }

  private directoriesDigest(paths: readonly string[]): string {
    return digestOf({ existing: [...paths].sort().filter((p) => this.directories.has(p)) });
  }

  /** The precondition digest for the kind of work a manifest asks for. */
  private digestFor(m: SignedManifest["manifest"]): string {
    const scope = m.scope as { unit?: string; requested?: ReadonlyArray<{ path: string }> };
    switch (m.operation) {
      case "restart.service.v1":
        return this.serviceDigest(scope.unit ?? "");
      case "reboot.host.v1":
        return this.bootDigest();
      case "prepare.directories.v1":
        return this.directoriesDigest((scope.requested ?? []).map((d) => d.path));
      default:
        return this.stateDigest();
    }
  }

  private failIfPartitioned(): void {
    if ((this.faults.failPreviews ?? 0) > 0) {
      this.faults.failPreviews = (this.faults.failPreviews ?? 0) - 1;
      throw new TransportError("query");
    }
  }

  async previewService(unit: string): Promise<ServicePreview | null> {
    this.failIfPartitioned();
    this.settle();
    const s = this.services.get(unit);
    return { exists: s !== undefined, active: s?.active ?? false, activeSince: s?.activeSince ?? null, stateDigest: this.serviceDigest(unit) };
  }

  async previewBoot(): Promise<BootPreview | null> {
    this.failIfPartitioned();
    this.settle();
    return { bootId: this.bootId, stateDigest: this.bootDigest() };
  }

  async previewDirectories(paths: readonly string[]): Promise<DirectoriesPreview | null> {
    this.failIfPartitioned();
    this.settle();
    return { existing: paths.filter((p) => this.directories.has(p)), stateDigest: this.directoriesDigest(paths) };
  }

  async inspectService(unit: string): Promise<ServiceState> {
    this.failInspection();
    this.settle();
    const s = this.services.get(unit);
    return { exists: s !== undefined, active: s?.active ?? false, activeSince: s?.activeSince ?? null };
  }

  async inspectBoot(): Promise<{ readonly bootId: string }> {
    this.failInspection();
    this.settle();
    return { bootId: this.bootId };
  }

  async inspectDirectories(paths: readonly string[]): Promise<readonly DirectoryState[]> {
    this.failInspection();
    this.settle();
    return paths.map((path) => {
      const d = this.directories.get(path);
      return { path, exists: d !== undefined, isDirectory: d !== undefined, owner: d?.owner ?? null, group: d?.group ?? null, mode: d?.mode ?? null };
    });
  }

  private failInspection(): void {
    if ((this.faults.failInspections ?? 0) > 0) {
      this.faults.failInspections = (this.faults.failInspections ?? 0) - 1;
      throw new TransportError("inspect");
    }
  }

  /** Apply a finished run of a non-package kind. Never overwrites or reowns an existing path. */
  private applyAction(m: SignedManifest["manifest"], finishedAt: string): void {
    const scope = m.scope as { unit?: string; directories?: ReadonlyArray<{ path: string; owner: string; group: string; mode: string }> };
    if (m.operation === "restart.service.v1" && scope.unit !== undefined) {
      const before = this.services.get(scope.unit);
      if (before === undefined) return;
      this.services.set(scope.unit, this.faults.restartLeavesInactive === true ? { active: false, activeSince: before.activeSince } : { active: true, activeSince: finishedAt });
    } else if (m.operation === "reboot.host.v1") {
      if (this.faults.rebootKeepsBootId === true) return;
      this.reboots += 1;
      this.bootId = `sim-boot-${this.serverId}-r${this.reboots}`;
      for (const [unit, s] of this.services) this.services.set(unit, s.active ? { active: true, activeSince: finishedAt } : s);
    } else if (m.operation === "prepare.directories.v1") {
      const fails = new Set(this.faults.directoryCreateFails ?? []);
      for (const d of scope.directories ?? []) {
        if (this.directories.has(d.path) || fails.has(d.path)) continue;
        this.directories.set(d.path, { owner: d.owner, group: d.group, mode: d.mode });
      }
    }
  }

  private stateDigest(): string {
    return digestOf({ installed: this.installed, upgrades: this.upgrades });
  }

  private settle(): void {
    const now = this.options.now().getTime();
    for (const entry of this.ledger.values()) {
      if (entry.finished || now < entry.startedAt + (this.options.runMs ?? 1000)) continue;
      const m = entry.signed.manifest;
      if (m.operation === "apply.packages.v1" && "packages" in m.scope) {
        const unchanged = new Set(this.faults.silentlyUnchanged ?? []);
        for (const c of m.scope.packages) {
          const key = `${c.name}:${c.arch}`;
          if (!unchanged.has(key)) this.installed[key] = c.to;
        }
        this.upgrades = this.upgrades.filter((u) => this.installed[`${u.name}:${u.arch}`] !== u.to);
      } else {
        this.applyAction(m, new Date(entry.startedAt + (this.options.runMs ?? 1000)).toISOString());
      }
      entry.finished = true;
      entry.exitCode = this.faults.exitCode ?? 0;
    }
  }

  private activeOperation(): LedgerEntry | null {
    this.settle();
    for (const e of this.ledger.values()) if (!e.finished) return e;
    return null;
  }

  private record(e: LedgerEntry): RemoteRecord {
    return {
      operationId: e.operationId,
      manifestDigest: e.manifestDigest,
      state: e.finished ? "finished" : "running",
      exitCode: e.exitCode,
    };
  }

  /** Change the simulated machine between planning and approval (precondition test). */
  addUpgrade(change: PackageChange): void {
    this.upgrades.push(change);
  }

  /** T-056: [SIMULATED] identity, so aliases of one simulated machine can be detected. */
  identity(): TargetIdentity {
    if (this.explicitIdentity) return { hostKeyFingerprint: this.hostKeyFingerprint, machineId: this.machineId };
    return { hostKeyFingerprint: `${this.hostKeyFingerprint}#${this.serverId}`, machineId: this.machineId };
  }

  async previewPackages(): Promise<TransactionPreview | null> {
    this.failIfPartitioned();
    this.settle();
    return {
      // [SIMULATED] A fixture upgrade without an origin is labelled as Ubuntu's archive (T-062).
      upgrades: this.upgrades.map((u) => ({ ...u, origin: u.origin ?? SIMULATED_DEFAULT_ORIGIN })),
      removals: [],
      downgrades: [],
      held: [],
      locked: this.activeOperation() !== null,
      stateDigest: this.stateDigest(),
    };
  }

  private verify(signed: SignedManifest, now: number): RejectCode | null {
    const m = signed.manifest;
    if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION) return "UNSUPPORTED_SCHEMA";
    if (!["apply.packages.v1", "restart.service.v1", "reboot.host.v1", "prepare.directories.v1"].includes(m.operation)) return "UNSUPPORTED_OPERATION";
    if (this.options.trustedKeys[signed.keyId] === undefined) return "UNKNOWN_KEY";
    if (!verifyManifestSignature(signed, this.options.trustedKeys)) return "INVALID_SIGNATURE";
    if (
      m.installationId !== this.options.installationId ||
      m.server.id !== this.serverId ||
      m.server.hostKeyFingerprint !== this.hostKeyFingerprint
    ) {
      return "MISBOUND";
    }
    if (now > Date.parse(m.acceptBefore)) return "EXPIRED";
    return null;
  }

  async submit(signed: SignedManifest): Promise<SubmitResult> {
    if (this.faults.dropNextSubmitBeforeSend === true) {
      this.faults.dropNextSubmitBeforeSend = false;
      throw new TransportError("before-send");
    }
    this.submitsReceived += 1;
    const now = this.options.now().getTime();
    const digest = digestOf(signed.manifest);

    const existing = this.ledger.get(signed.manifest.operationId);
    if (existing !== undefined) {
      this.settle();
      return existing.manifestDigest === digest
        ? { status: "existing", record: this.record(existing) }
        : { status: "rejected", code: "DIGEST_MISMATCH" };
    }

    const invalid = this.verify(signed, now);
    if (invalid !== null) return { status: "rejected", code: invalid };
    if (this.activeOperation() !== null) return { status: "rejected", code: "TARGET_BUSY" };
    if (signed.manifest.preconditionDigest !== this.digestFor(signed.manifest)) return { status: "rejected", code: "PRECONDITION_CHANGED" };

    // Atomic claim (single-threaded here; the real helper uses an exclusive
    // create in its root-owned ledger).
    const entry: LedgerEntry = {
      operationId: signed.manifest.operationId,
      manifestDigest: digest,
      signed,
      startedAt: now,
      finished: false,
      exitCode: null,
    };
    this.ledger.set(entry.operationId, entry);
    this.claims.push(entry.operationId);

    if (this.faults.loseNextSubmitAck === true) {
      this.faults.loseNextSubmitAck = false;
      throw new TransportError("after-send");
    }
    return { status: "accepted", record: this.record(entry) };
  }

  async query(operationId: string): Promise<QueryResult> {
    if ((this.faults.failQueries ?? 0) > 0) {
      this.faults.failQueries = (this.faults.failQueries ?? 0) - 1;
      throw new TransportError("query");
    }
    this.settle();
    const e = this.ledger.get(operationId);
    return e === undefined ? { found: false } : { found: true, record: this.record(e) };
  }

  async inspectInstalled(keys: readonly string[]): Promise<Readonly<Record<string, string | null>>> {
    this.failInspection();
    this.settle();
    return Object.fromEntries(keys.map((k) => [k, this.installed[k] ?? null]));
  }

  /**
   * [SIMULATED] T-078: what a read-only inventory would see: directories with
   * owner, group and mode, and installed packages (name without arch -> version).
   */
  inventorySnapshot(): { directories: Array<{ path: string; owner: string; group: string; mode: string }>; installed: Record<string, string> } {
    const installed: Record<string, string> = {};
    for (const [key, version] of Object.entries(this.installed)) installed[key.split(":")[0] ?? key] = version;
    return { directories: [...this.directories.entries()].map(([path, d]) => ({ path, ...d })), installed };
  }

  /** For tests and diagnostics. */
  snapshot(): { installed: Readonly<Record<string, string>>; ledger: string } {
    return { installed: { ...this.installed }, ledger: canonicalJson([...this.ledger.keys()]) };
  }
}
