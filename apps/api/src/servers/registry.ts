/**
 * Server registration (T-069, PRD FR-02/03, Tech Spec §6.2-6.3).
 *
 * Order: draft -> host key scan -> owner confirms the fingerprint -> a key made
 * for this server -> first read-only check -> activate. Each step re-checks
 * the state it needs; out of order is STATE_CONFLICT.
 *
 * Safety:
 *  - The address policy runs at draft creation and again before every
 *    connection (scan, first check), so a name that starts resolving to a
 *    blocked address is refused (DNS rebinding).
 *  - Nothing connects with a host key the owner did not confirm. The first
 *    check uses a known_hosts file holding only the confirmed key.
 *  - Every connection is read-only: a key exchange (scan) and the fixed
 *    collectors (first check). writesEnabled is false for every server and
 *    the database refuses anything else.
 *  - The private key is made by ssh-keygen on the controller and only its
 *    path is ever handled. Only the public line is returned.
 *  - Disconnect stops checks and deletes ServrSit's own key; it never claims
 *    the line on the server was removed.
 */

import { randomUUID } from "node:crypto";
import {
  productionStatusOf,
  SERVER_DRAFT_TTL_HOURS,
  treatedAsProduction,
  type AccessKey,
  type DisconnectResponse,
  type FirstCheck,
  type ServerDraft,
  type ServerDraftRequest,
  type ServerRegistrationErrorCode,
  type ServerUpdateRequest,
} from "@servrsit/contracts";
import { collectViaSsh, probePrivilegeViaSsh, TargetRejectedError, type CollectionResult, type PrivilegeProbeResult } from "@servrsit/ssh";
import type { NewServer, SqliteServerStore, StoredDraft, StoredServer } from "@servrsit/store";
import { isSafeFromAddress, type AddressPolicy } from "./address.js";
import { finishedCheck, runningCheck } from "./first-check.js";
import { knownHostsLine, type HostKeyScanner, type KeyVault } from "./ssh-tools.js";

export interface FirstCheckTarget {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly identityFile: string;
  readonly knownHostsFile: string;
}

export type FirstCheckCollector = (target: FirstCheckTarget) => Promise<CollectionResult>;
/** T-081: runs exactly `sudo -n -l` (lists rules, runs nothing, never prompts). */
export type PrivilegeProbe = (target: FirstCheckTarget) => Promise<PrivilegeProbeResult>;

export interface ServerRegistryOptions {
  readonly store: SqliteServerStore;
  readonly policy: AddressPolicy;
  readonly controllerAddress: string | null;
  readonly scanner: HostKeyScanner;
  readonly vault: KeyVault;
  readonly probe: (address: string, port: number) => Promise<boolean>;
  /** Default: the read-only collector over SSH, with the policy re-checking DNS. */
  readonly collector?: FirstCheckCollector | undefined;
  /** Default: the `sudo -n -l` probe over SSH, after a successful collection only. */
  readonly privilegeProbe?: PrivilegeProbe | undefined;
  /** T-081 (D-R3): how often expired drafts and their keys are swept. Default 15 minutes. */
  readonly sweepIntervalMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  /** Called after a server was added (the fleet checks it right away). */
  readonly onActivated?: ((serverId: string) => void) | undefined;
  /** True while a care operation for this server is unresolved; disconnect then waits. */
  readonly hasUnresolvedOperation?: ((serverId: string) => boolean) | undefined;
  readonly log?: { info(o: object, m: string): void; warn(o: object, m: string): void } | undefined;
}

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly error: ServerRegistrationErrorCode; readonly reason?: string | undefined };

const STATUS: Readonly<Record<ServerRegistrationErrorCode, number>> = {
  INVALID_INPUT: 400,
  ADDRESS_REJECTED: 422,
  DUPLICATE_SERVER: 409,
  DRAFT_NOT_FOUND: 404,
  DRAFT_EXPIRED: 410,
  HOST_KEY_NOT_CONFIRMED: 409,
  FINGERPRINT_MISMATCH: 422,
  HOST_KEY_CHANGED: 409,
  ROUTE_UNAVAILABLE: 502,
  STATE_CONFLICT: 409,
  SERVER_NOT_FOUND: 404,
};

function fail<T>(error: ServerRegistrationErrorCode, reason?: string): Outcome<T> {
  return { ok: false, status: STATUS[error], error, ...(reason === undefined ? {} : { reason }) };
}

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

/** What a draft row's body holds: the public draft plus who confirmed the host key. */
interface DraftBody {
  readonly draft: ServerDraft;
  readonly confirmedBy: string | null;
}

const REACHABLE_NOTE = "The network path is open. This does not test signing in.";
const UNREACHABLE_REASON = "ServrSit could not open a connection to this address and port.";

/** "Web 1 (EU)" -> "web-1-eu". Used in the key comment `servrsit-<slug>`. */
export function slugOf(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return slug === "" ? "server" : slug;
}

export class ServerRegistry {
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly collector: FirstCheckCollector;
  private readonly privilegeProbe: PrivilegeProbe;
  private sweepTimer: NodeJS.Timeout | null = null;
  /** Running first checks, by draft id (tests await them). */
  private readonly checks = new Map<string, Promise<void>>();

  constructor(private readonly o: ServerRegistryOptions) {
    this.now = o.now ?? (() => new Date());
    this.newId = o.newId ?? (() => randomUUID());
    this.collector =
      o.collector ??
      ((t) =>
        collectViaSsh(
          { host: t.host, port: t.port, user: t.user, identityFile: t.identityFile },
          { knownHostsFile: t.knownHostsFile, allowedPorts: o.policy.allowedPorts },
          {
            checkResolution: async (host) => {
              const check = await o.policy.check(host, t.port);
              if (!check.ok) throw new TargetRejectedError(check.reason);
            },
          },
        ));
    this.privilegeProbe =
      o.privilegeProbe ??
      ((t) =>
        probePrivilegeViaSsh(
          { host: t.host, port: t.port, user: t.user, identityFile: t.identityFile },
          { knownHostsFile: t.knownHostsFile, allowedPorts: o.policy.allowedPorts },
          {
            checkResolution: async (host) => {
              const check = await o.policy.check(host, t.port);
              if (!check.ok) throw new TargetRejectedError(check.reason);
            },
          },
        ));
  }

  /**
   * T-081 (D-R3): sweep now and then on a timer, so an abandoned draft's
   * private key does not stay on the controller until the next registration.
   */
  startSweeper(): void {
    if (this.sweepTimer !== null) return;
    void this.sweep().catch((error: unknown) => this.o.log?.warn({ err: error }, "servers: sweep failed"));
    this.sweepTimer = setInterval(() => {
      void this.sweep().catch((error: unknown) => this.o.log?.warn({ err: error }, "servers: sweep failed"));
    }, this.o.sweepIntervalMs ?? 15 * 60_000);
    this.sweepTimer.unref();
  }

  stopSweeper(): void {
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  // -------------------------------------------------------------------------
  // Drafts
  // -------------------------------------------------------------------------

  private body(d: StoredDraft): DraftBody {
    return d.body as unknown as DraftBody;
  }

  private save(d: StoredDraft, draft: ServerDraft, changes: Partial<Omit<StoredDraft, "id" | "owner" | "body">> = {}, confirmedBy?: string): void {
    const body: DraftBody = { draft, confirmedBy: confirmedBy ?? this.body(d).confirmedBy };
    this.o.store.saveDraft({ ...d, ...changes, body: body as unknown as Record<string, unknown> });
  }

  /** Remove expired drafts and the key files they never used. */
  async sweep(): Promise<void> {
    for (const d of this.o.store.listExpiredDrafts(this.now())) {
      if (this.checks.has(d.id)) continue;
      this.o.store.deleteDraft(d.id);
      await this.removeKeys(d.id);
    }
  }

  private async removeKeys(id: string): Promise<boolean> {
    try {
      return await this.o.vault.remove(id);
    } catch (error) {
      this.o.log?.warn({ err: error, id }, "servers: could not remove key directory");
      return false;
    }
  }

  private load(owner: string, id: string): Outcome<StoredDraft> {
    const d = this.o.store.getDraft(id);
    if (d === null || d.owner !== owner) return fail("DRAFT_NOT_FOUND");
    if (new Date(d.expiresAt).getTime() <= this.now().getTime()) return fail("DRAFT_EXPIRED", "This draft expired. Start again.");
    return ok(d);
  }

  async createDraft(owner: string, req: ServerDraftRequest): Promise<Outcome<ServerDraft>> {
    await this.sweep();
    const check = await this.o.policy.check(req.address, req.port);
    if (!check.ok) return fail("ADDRESS_REJECTED", check.reason);
    // T-081 (D-R2): the same address first, so re-registering a server under
    // its own name leads to the existing record (duplicateOf), not a name error.
    const existing = this.o.store.findActiveByEndpoint(check.host, check.port);
    if (existing === null && this.o.store.listActive().some((s) => s.name.toLowerCase() === req.name.toLowerCase())) {
      return fail("INVALID_INPUT", "A server with this name already exists.");
    }
    const first = check.addresses[0];
    const reachable = first !== undefined && (await this.o.probe(first, check.port));
    const at = this.now();
    const draft: ServerDraft = {
      id: this.newId(),
      state: "draft",
      address: check.host,
      port: check.port,
      user: req.user,
      name: req.name,
      role: req.role,
      production: treatedAsProduction(productionStatusOf(req.production, req.productionStatus)),
      productionStatus: productionStatusOf(req.production, req.productionStatus),
      duplicateOf: existing === null ? null : { id: existing.id, name: existing.name },
      reachability: reachable ? { reachable: true, note: REACHABLE_NOTE } : { reachable: false, reason: UNREACHABLE_REASON },
      hostKey: null,
      hostKeyConfirmedAt: null,
      accessKey: null,
      createdAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + SERVER_DRAFT_TTL_HOURS * 3600_000).toISOString(),
    };
    this.o.store.saveDraft({
      id: draft.id, owner, body: { draft, confirmedBy: null }, hostKeyLine: null, firstCheck: null, keyDir: null, expiresAt: draft.expiresAt,
    });
    this.o.log?.info({ draftId: draft.id, reachable, duplicate: existing !== null }, "servers: draft created");
    return ok(draft);
  }

  getDraft(owner: string, id: string): Outcome<ServerDraft> {
    const d = this.load(owner, id);
    return d.ok ? ok(this.body(d.value).draft) : d;
  }

  async deleteDraft(owner: string, id: string): Promise<Outcome<null>> {
    const d = this.o.store.getDraft(id);
    if (d === null || d.owner !== owner) return fail("DRAFT_NOT_FOUND");
    if (this.checks.has(id)) return fail("STATE_CONFLICT", "The first check is still running.");
    this.o.store.deleteDraft(id);
    await this.removeKeys(id);
    return ok(null);
  }

  async scanHostKey(owner: string, id: string): Promise<Outcome<ServerDraft>> {
    const loaded = this.load(owner, id);
    if (!loaded.ok) return loaded;
    const d = loaded.value;
    const draft = this.body(d).draft;
    if (draft.state !== "draft" && draft.state !== "host-key-seen") {
      return fail("STATE_CONFLICT", "The host key was already confirmed for this draft. If the server's key has changed, delete this draft and start again.");
    }
    const check = await this.o.policy.check(draft.address, draft.port);
    if (!check.ok) return fail("ADDRESS_REJECTED", check.reason);
    const first = check.addresses[0];
    if (first === undefined) return fail("ROUTE_UNAVAILABLE");
    const scan = await this.o.scanner(first, check.port);
    if (!scan.ok) {
      const unreachable = { ...draft, reachability: { reachable: false as const, reason: UNREACHABLE_REASON } };
      this.save(d, unreachable);
      return fail(
        "ROUTE_UNAVAILABLE",
        scan.code === "OUTPUT_INVALID" ? "The server did not present a usable host key." : "ServrSit could not reach this address yet.",
      );
    }
    const next: ServerDraft = {
      ...draft,
      state: "host-key-seen",
      reachability: { reachable: true, note: REACHABLE_NOTE },
      hostKey: { algorithm: scan.key.algorithm, fingerprint: scan.key.fingerprint, observedAt: this.now().toISOString() },
    };
    this.save(d, next, { hostKeyLine: knownHostsLine(draft.address, draft.port, scan.key) });
    this.o.log?.info({ draftId: id, algorithm: scan.key.algorithm }, "servers: host key scanned");
    return ok(next);
  }

  async confirmHostKey(owner: string, id: string, fingerprint: string): Promise<Outcome<ServerDraft>> {
    const loaded = this.load(owner, id);
    if (!loaded.ok) return loaded;
    const d = loaded.value;
    const draft = this.body(d).draft;
    if (draft.state === "host-key-confirmed" && draft.hostKey?.fingerprint === fingerprint) return ok(draft);
    if (draft.state !== "host-key-seen" || draft.hostKey === null || d.hostKeyLine === null) {
      return fail("STATE_CONFLICT", "Scan the host key first.");
    }
    if (fingerprint !== draft.hostKey.fingerprint) {
      this.o.log?.warn({ draftId: id }, "servers: fingerprint mismatch");
      return fail("FINGERPRINT_MISMATCH", "That fingerprint is not the one the server presented.");
    }
    await this.o.vault.writeKnownHosts(id, d.hostKeyLine);
    const twin = this.o.store.findActiveByHostKey(fingerprint);
    const next: ServerDraft = {
      ...draft,
      state: "host-key-confirmed",
      hostKeyConfirmedAt: this.now().toISOString(),
      duplicateOf: draft.duplicateOf ?? (twin === null ? null : { id: twin.id, name: twin.name }),
    };
    this.save(d, next, { keyDir: this.o.vault.dirFor(id) }, owner);
    this.o.log?.info({ draftId: id }, "servers: host key confirmed");
    return ok(next);
  }

  async issueAccessKey(owner: string, id: string): Promise<Outcome<ServerDraft>> {
    const loaded = this.load(owner, id);
    if (!loaded.ok) return loaded;
    const d = loaded.value;
    const draft = this.body(d).draft;
    if (draft.accessKey !== null) return ok(draft);
    if (draft.state === "draft" || draft.state === "host-key-seen") {
      return fail("HOST_KEY_NOT_CONFIRMED", "Confirm the host key before a key is made.");
    }
    if (draft.state !== "host-key-confirmed") return fail("STATE_CONFLICT");
    const from = this.o.controllerAddress;
    if (from === null || !isSafeFromAddress(from)) {
      return fail("STATE_CONFLICT", "ServrSit's own address is not configured, so a key limited to it cannot be made.");
    }
    const slug = slugOf(draft.name);
    const key = await this.o.vault.generate(id, `servrsit-${slug}`);
    const accessKey: AccessKey = {
      authorizedKeysLine: `restrict,from="${from}" ${key.keyType} ${key.keyBase64} servrsit-${slug}`,
      algorithm: "ED25519",
      keyFingerprint: key.fingerprint,
      controllerAddress: from,
      createdAt: this.now().toISOString(),
    };
    const next: ServerDraft = { ...draft, state: "key-issued", accessKey };
    this.save(d, next);
    this.o.log?.info({ draftId: id, keyFingerprint: key.fingerprint }, "servers: access key made");
    return ok(next);
  }

  // -------------------------------------------------------------------------
  // First check
  // -------------------------------------------------------------------------

  async startFirstCheck(owner: string, id: string): Promise<Outcome<FirstCheck>> {
    const loaded = this.load(owner, id);
    if (!loaded.ok) return loaded;
    const d = loaded.value;
    const draft = this.body(d).draft;
    if (draft.state === "checking" && d.firstCheck !== null) return ok(d.firstCheck as unknown as FirstCheck);
    if (!["key-issued", "checked", "check-failed"].includes(draft.state) || draft.accessKey === null) {
      return fail("STATE_CONFLICT", "Issue the access key first.");
    }
    const check = await this.o.policy.check(draft.address, draft.port);
    if (!check.ok) return fail("ADDRESS_REJECTED", check.reason);
    const running = runningCheck(id);
    this.save(d, { ...draft, state: "checking" }, { firstCheck: running as unknown as Record<string, unknown> });
    const dir = this.o.vault.dirFor(id);
    const run = this.runCheck(id, {
      host: draft.address,
      port: draft.port,
      user: draft.user,
      identityFile: `${dir}/id_ed25519`,
      knownHostsFile: `${dir}/known_hosts`,
    }).finally(() => this.checks.delete(id));
    this.checks.set(id, run);
    return ok(running);
  }

  private async runCheck(id: string, target: FirstCheckTarget): Promise<void> {
    let result: CollectionResult;
    try {
      result = await this.collector(target);
    } catch (error) {
      this.o.log?.warn({ err: error, draftId: id }, "servers: first check threw");
      result = { ok: false, failure: { code: "COLLECTION_FAILED", message: "" }, attemptedAt: this.now().toISOString(), contacted: false };
    }
    // T-081 (R-2): only after a successful collection, the disclosed `sudo -n -l`.
    let privilege: PrivilegeProbeResult | null = null;
    if (result.ok) {
      try {
        privilege = await this.privilegeProbe(target);
      } catch (error) {
        this.o.log?.warn({ err: error, draftId: id }, "servers: privilege check threw");
      }
    }
    const d = this.o.store.getDraft(id);
    if (d === null) return; // deleted meanwhile
    const outcome = finishedCheck(id, result, this.now(), privilege);
    const draft = this.body(d).draft;
    this.save(d, { ...draft, state: result.ok ? "checked" : "check-failed" }, { firstCheck: outcome as unknown as Record<string, unknown> });
    this.o.log?.info({ draftId: id, ok: result.ok, code: outcome.failureCode }, "servers: first check finished");
  }

  /** For tests: wait until a running first check has been recorded. */
  async settled(id: string): Promise<void> {
    await this.checks.get(id);
  }

  getFirstCheck(owner: string, id: string): Outcome<FirstCheck> {
    const loaded = this.load(owner, id);
    if (!loaded.ok) return loaded;
    const fc = loaded.value.firstCheck;
    return fc === null ? fail("STATE_CONFLICT", "No first check has started for this draft.") : ok(fc as unknown as FirstCheck);
  }

  // -------------------------------------------------------------------------
  // Activate, update, disconnect
  // -------------------------------------------------------------------------

  activate(owner: string, id: string): Outcome<{ serverId: string }> {
    const loaded = this.load(owner, id);
    if (!loaded.ok) return loaded;
    const d = loaded.value;
    const { draft, confirmedBy } = this.body(d);
    if (draft.state !== "checked" || draft.hostKey === null || draft.hostKeyConfirmedAt === null || draft.accessKey === null) {
      return fail("STATE_CONFLICT", "Run the first check before adding the server.");
    }
    const sameEndpoint = this.o.store.findActiveByEndpoint(draft.address, draft.port);
    const sameKey = this.o.store.findActiveByHostKey(draft.hostKey.fingerprint);
    if (draft.duplicateOf !== null || sameEndpoint !== null || sameKey !== null) {
      return fail("DUPLICATE_SERVER", "This server is already registered.");
    }
    const dir = this.o.vault.dirFor(id);
    const server: NewServer = {
      id,
      source: "registration",
      access: "ssh",
      name: draft.name,
      role: draft.role,
      productionStatus: draft.productionStatus ?? (draft.production ? "yes" : "no"),
      address: draft.address,
      port: draft.port,
      user: draft.user,
      identityFile: `${dir}/id_ed25519`,
      knownHostsFile: `${dir}/known_hosts`,
      importantServices: [],
      collect: true,
      collectDisabledReason: null,
      hostKey: {
        algorithm: draft.hostKey.algorithm,
        fingerprint: draft.hostKey.fingerprint,
        observedAt: draft.hostKey.observedAt,
        confirmedAt: draft.hostKeyConfirmedAt,
        confirmedBy: confirmedBy ?? owner,
      },
      accessKey: draft.accessKey,
      createdAt: this.now().toISOString(),
    };
    const r = this.o.store.register(server, id, owner, this.now());
    if (!r.ok) {
      return r.code === "DUPLICATE_NAME"
        ? fail("INVALID_INPUT", "A server with this name already exists.")
        : fail("DUPLICATE_SERVER", "This server is already registered.");
    }
    this.o.log?.info({ serverId: id }, "servers: server added");
    this.o.onActivated?.(id);
    return ok({ serverId: id });
  }

  update(owner: string, id: string, change: ServerUpdateRequest): Outcome<StoredServer> {
    const r = this.o.store.update(
      id,
      {
        name: change.name,
        role: change.role,
        productionStatus:
          change.productionStatus ?? (change.production === undefined ? undefined : productionStatusOf(change.production)),
      },
      owner,
      this.now(),
    );
    if (r.ok) return ok(r.server);
    if (r.code === "DUPLICATE_NAME") return fail("INVALID_INPUT", "A server with this name already exists.");
    return fail("SERVER_NOT_FOUND");
  }

  async disconnect(owner: string, id: string): Promise<Outcome<DisconnectResponse>> {
    const current = this.o.store.get(id);
    if (current === null || current.disconnectedAt !== null) return fail("SERVER_NOT_FOUND");
    if (this.o.hasUnresolvedOperation?.(id) === true) {
      return fail("STATE_CONFLICT", "An operation on this server is not resolved yet. Disconnect after it is.");
    }
    const r = this.o.store.disconnect(id, owner, this.now(), { remoteKeyRemoved: false });
    if (!r.ok) return fail("SERVER_NOT_FOUND");
    // Only a key ServrSit made is deleted. A key file the owner provided is never touched.
    const controllerKeyDeleted = current.source === "registration" ? await this.removeKeys(id) : false;
    this.o.store.appendEvent(id, controllerKeyDeleted ? "controller-key-deleted" : "controller-key-kept", "system", { source: current.source }, this.now());
    this.o.log?.info({ serverId: id, controllerKeyDeleted }, "servers: server disconnected");
    return ok({
      serverId: id,
      schedulesStopped: true,
      controllerKeyDeleted,
      remoteKeyRemoved: false,
      remoteSteps: remoteSteps(current),
      authorizedKeysLine: current.accessKey?.authorizedKeysLine ?? null,
    });
  }
}

/** Fixed steps for removing ServrSit's access on the server itself. */
export function remoteSteps(s: StoredServer): string[] {
  if (s.access === "local") {
    return ["ServrSit read this machine directly. There is no remote key to remove."];
  }
  const user = s.user ?? "the account ServrSit used";
  if (s.source === "registration" && s.accessKey !== null) {
    const comment = s.accessKey.authorizedKeysLine.split(" ").at(-1) ?? "servrsit";
    return [
      "Sign in to the server with your own account, not with ServrSit's key.",
      `Open ~/.ssh/authorized_keys for the account ${user}.`,
      `Delete the line that ends with ${comment} (shown below) and save the file.`,
      "Before you close that session, check that you can still sign in with your own key.",
    ];
  }
  return [
    "ServrSit used a key you provided. It did not make a key for this server and has not deleted yours.",
    `If that key exists only for ServrSit, remove its line from ~/.ssh/authorized_keys for the account ${user}.`,
    "Keep at least one other way to sign in before you remove anything.",
  ];
}
