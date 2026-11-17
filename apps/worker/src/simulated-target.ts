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
  type PackageChange,
  type SignedManifest,
  type TransactionPreview,
} from "@servrsit/domain";
import { TransportError, type QueryResult, type RejectCode, type RemoteRecord, type SubmitResult, type WriteTarget } from "./target.js";

export interface SimulatedFaults {
  /** The next submit never reaches the target (nothing is claimed). */
  dropNextSubmitBeforeSend?: boolean;
  /** The next submit is claimed and accepted, but the response is lost. */
  loseNextSubmitAck?: boolean;
  /** The next N queries fail with a transport error. */
  failQueries?: number;
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
}

interface LedgerEntry {
  readonly operationId: string;
  readonly manifestDigest: string;
  readonly signed: SignedManifest;
  readonly startedAt: number;
  finished: boolean;
  exitCode: number | null;
}

export class SimulatedTarget implements WriteTarget {
  readonly kind = "simulated" as const;
  readonly serverId: string;
  readonly hostKeyFingerprint: string;
  readonly faults: SimulatedFaults = {};
  /** Every claim ever made, for tests: a second mutation would show up here. */
  readonly claims: string[] = [];
  /** Number of submit calls that reached the target. */
  submitsReceived = 0;
  private readonly ledger = new Map<string, LedgerEntry>();
  private readonly installed: Record<string, string>;
  private upgrades: PackageChange[];

  constructor(private readonly options: SimulatedTargetOptions) {
    this.serverId = options.serverId;
    this.hostKeyFingerprint = options.hostKeyFingerprint;
    this.installed = { ...options.installed };
    this.upgrades = [...options.upgrades];
  }

  private stateDigest(): string {
    return digestOf({ installed: this.installed, upgrades: this.upgrades });
  }

  private settle(): void {
    const now = this.options.now().getTime();
    for (const entry of this.ledger.values()) {
      if (entry.finished || now < entry.startedAt + (this.options.runMs ?? 1000)) continue;
      const unchanged = new Set(this.faults.silentlyUnchanged ?? []);
      for (const c of entry.signed.manifest.scope.packages) {
        const key = `${c.name}:${c.arch}`;
        if (!unchanged.has(key)) this.installed[key] = c.to;
      }
      this.upgrades = this.upgrades.filter((u) => this.installed[`${u.name}:${u.arch}`] !== u.to);
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

  async previewPackages(): Promise<TransactionPreview | null> {
    this.settle();
    return {
      upgrades: [...this.upgrades],
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
    if (m.operation !== "apply.packages.v1") return "UNSUPPORTED_OPERATION";
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
    if (signed.manifest.preconditionDigest !== this.stateDigest()) return { status: "rejected", code: "PRECONDITION_CHANGED" };

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
    if ((this.faults.failInspections ?? 0) > 0) {
      this.faults.failInspections = (this.faults.failInspections ?? 0) - 1;
      throw new TransportError("inspect");
    }
    this.settle();
    return Object.fromEntries(keys.map((k) => [k, this.installed[k] ?? null]));
  }

  /** For tests and diagnostics. */
  snapshot(): { installed: Readonly<Record<string, string>>; ledger: string } {
    return { installed: { ...this.installed }, ledger: canonicalJson([...this.ledger.keys()]) };
  }
}
