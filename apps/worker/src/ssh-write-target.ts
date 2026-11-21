/**
 * The REAL SSH write target (T-089, ADR-021). Package updates only.
 *
 * Two forms:
 *  - `new SshWriteTarget(serverId)`: no connection. It refuses every write with
 *    WRITES_DISABLED and contacts nothing. Every real server gets this form
 *    unless the controller's own configuration enables writes for it.
 *  - `new SshWriteTarget(serverId, hostKeyFingerprint, connection)`: built by
 *    the API only for a server its writes.json enables (Sentani only; never
 *    settable through the API or UI). The write gate itself is checked again
 *    by the Dispatcher and the approval route on every use.
 *
 * With a connection:
 *  - preview and installed versions are read with the INSPECT key and the
 *    fixed read-only script (packages/ssh preview.ts), nothing named by the
 *    plan is sent to the server;
 *  - submit and query go to the helper's gateway with the MAINTENANCE key, as
 *    one JSON request on stdin; the gateway's forced command ignores the
 *    remote command line;
 *  - a reply that is missing, cut short or not in the helper's format is never
 *    evidence: it is a TransportError, so the Dispatcher queries the same
 *    operation id before anything else (invariants 6 and 7);
 *  - restart, reboot and directory work stays refused here: their previews are
 *    null (the plan is blocked) and a manifest for them is refused locally.
 */

import { z } from "zod";
import {
  packagesPreconditionDigest,
  installedFromPreview,
  type SignedManifest,
  type TransactionPreview,
} from "@servrsit/domain";
import {
  collectInstalledViaSsh,
  collectPackagePreviewViaSsh,
  sendGatewayRequest,
  type CommandRunner,
  type FailureCode,
  type GatewayTarget,
  type SshOptions,
  type SshTarget,
} from "@servrsit/ssh";
import { TransportError, type QueryResult, type RejectCode, type RemoteRecord, type SubmitResult, type TargetIdentity, type WriteTarget } from "./target.js";

export class WritesDisabledError extends Error {
  readonly code = "WRITES_DISABLED" as const;
  constructor() {
    super("WRITES_DISABLED: writes to this server are disabled (ADR-014)");
    this.name = "WritesDisabledError";
  }
}

export interface SshWriteConnection {
  /** The helper gateway, reached with the server's maintenance key. */
  readonly gateway: GatewayTarget;
  /** Read-only inspect access (the inspect key), for previews and verification. */
  readonly inspect: { readonly target: SshTarget; readonly options: SshOptions };
  /** /etc/machine-id from the latest health check, or null when not observed. */
  readonly machineId: () => string | null;
  readonly runner?: CommandRunner | undefined;
  readonly checkResolution?: ((host: string) => Promise<void>) | undefined;
}

/** Codes the helper's submit can answer with (target-helper helper.py). */
const HELPER_REJECT_CODES = [
  "UNKNOWN_KEY", "INVALID_SIGNATURE", "UNSUPPORTED_SCHEMA", "UNSUPPORTED_OPERATION", "MISBOUND", "EXPIRED",
  "DIGEST_MISMATCH", "TARGET_BUSY", "PRECONDITION_CHANGED", "PACKAGE_HELD", "INTERACTIVE_PROMPT",
  "INVALID_REQUEST", "HELPER_UNAVAILABLE", "CONFFILE_MODIFIED",
] as const satisfies readonly RejectCode[];

const OPERATION_ID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const RecordSchema = z.object({
  operationId: OPERATION_ID,
  manifestDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  state: z.enum(["running", "finished"]),
  exitCode: z.number().int().min(-255).max(255).nullable(),
});
const SubmitReplySchema = z.union([
  z.object({ status: z.enum(["accepted", "existing"]), record: RecordSchema }),
  z.object({ status: z.literal("rejected"), code: z.enum(HELPER_REJECT_CODES) }),
]);
const UNIT = /^[A-Za-z0-9:_.@-]{1,200}\.service$/;
const ETC_PATH = /^\/etc\/[A-Za-z0-9._@+/-]{1,250}$/;
const QueryReplySchema = z.union([
  z.object({ found: z.literal(false), helperVersion: z.string().max(32) }),
  z.object({
    found: z.literal(true),
    helperVersion: z.string().max(32),
    record: RecordSchema,
    outcome: z.enum(["succeeded", "failed", "partially_succeeded"]).nullable(),
    restartNeeded: z.array(z.string()).max(200).default([]),
    reasonCode: z.string().max(64).nullable().default(null),
    keptFiles: z.array(z.object({ path: z.string(), newDefault: z.string().nullable().optional() }).passthrough()).max(200).default([]),
  }),
]);

const isTransport = (code: FailureCode) => code === "ROUTE_UNAVAILABLE" || code === "TIMEOUT";

export class SshWriteTarget implements WriteTarget {
  readonly kind = "ssh" as const;

  constructor(
    readonly serverId: string,
    readonly hostKeyFingerprint: string = "unverified",
    private readonly connection?: SshWriteConnection,
  ) {}

  /** True only when the API built this target for a write-enabled server. */
  get connected(): boolean {
    return this.connection !== undefined;
  }

  /** T-056: the pinned host key and the machine id the health check last read. */
  identity(): TargetIdentity | null {
    if (this.connection === undefined || this.hostKeyFingerprint === "unverified") return null;
    return { hostKeyFingerprint: this.hostKeyFingerprint, machineId: this.connection.machineId() };
  }

  /** Packages only (T-089): no other preview is requested from a real server. */
  async previewService(): Promise<null> {
    return null;
  }

  async previewBoot(): Promise<null> {
    return null;
  }

  async previewDirectories(): Promise<null> {
    return null;
  }

  async inspectService(): Promise<never> {
    throw new WritesDisabledError();
  }

  async inspectBoot(): Promise<never> {
    throw new WritesDisabledError();
  }

  async inspectDirectories(): Promise<never> {
    throw new WritesDisabledError();
  }

  /**
   * The simulated upgrade as apt would make it, with the helper's own digest
   * rule (installed-v1). Null when the output cannot be trusted; a route or
   * time-out failure is a TransportError (the API answers ROUTE_UNAVAILABLE).
   */
  async previewPackages(): Promise<TransactionPreview | null> {
    const c = this.connection;
    if (c === undefined) return null;
    const r = await collectPackagePreviewViaSsh(c.inspect.target, c.inspect.options, { runner: c.runner, checkResolution: c.checkResolution });
    if (!r.ok) {
      if (isTransport(r.code)) throw new TransportError("inspect");
      return null;
    }
    const { installed, held } = r.installed;
    // apt and dpkg must agree on every installed version, or neither is trusted.
    if (r.preview.upgrades.some((u) => installed[`${u.name}:${u.arch}`] !== u.from)) return null;
    const heldSet = new Set(held);
    const preview: TransactionPreview = {
      upgrades: r.preview.upgrades,
      removals: r.preview.removals,
      downgrades: [],
      held: r.preview.upgrades.map((u) => `${u.name}:${u.arch}`).filter((k) => heldSet.has(k)),
      // apt-get -s takes no lock, so a lock is not visible here; the helper refuses with PACKAGE_LOCKED.
      locked: false,
      stateDigest: "",
      digestRule: "installed-v1",
    };
    const keys = preview.upgrades.map((u) => `${u.name}:${u.arch}`);
    return { ...preview, stateDigest: packagesPreconditionDigest(installedFromPreview(preview, keys)) };
  }

  async submit(signed: SignedManifest): Promise<SubmitResult> {
    const c = this.connection;
    if (c === undefined) return { status: "rejected", code: "WRITES_DISABLED" };
    if (signed.manifest.operation !== "apply.packages.v1") return { status: "rejected", code: "UNSUPPORTED_OPERATION" };
    if (signed.manifest.server.id !== this.serverId) return { status: "rejected", code: "MISBOUND" };
    const reply = await sendGatewayRequest(JSON.stringify({ version: 1, op: "submit", signed }), c.gateway, c.runner);
    if (!reply.ok) throw new TransportError(reply.reason === "HOST_NOT_PINNED" ? "before-send" : "after-send");
    const parsed = SubmitReplySchema.safeParse(reply.reply);
    // A reply not in the helper's format says nothing about what happened.
    if (!parsed.success) throw new TransportError("after-send");
    if (parsed.data.status === "rejected") return { status: "rejected", code: parsed.data.code };
    if (parsed.data.record.operationId !== signed.manifest.operationId) throw new TransportError("after-send");
    return { status: parsed.data.status, record: parsed.data.record };
  }

  async query(operationId: string): Promise<QueryResult> {
    const c = this.connection;
    if (c === undefined) throw new WritesDisabledError();
    const reply = await sendGatewayRequest(JSON.stringify({ version: 1, op: "query.operation.v1", operationId }), c.gateway, c.runner);
    if (!reply.ok) throw new TransportError("query");
    const parsed = QueryReplySchema.safeParse(reply.reply);
    // Includes {"status":"rejected","code":"HELPER_UNAVAILABLE"}: the ledger could not be read, which is not evidence.
    if (!parsed.success) throw new TransportError("query");
    const q = parsed.data;
    if (!q.found) return { found: false };
    if (q.record.operationId !== operationId) throw new TransportError("query");
    const record: RemoteRecord = {
      ...q.record,
      report: {
        helperVersion: q.helperVersion,
        outcome: q.outcome,
        reasonCode: q.reasonCode !== null && /^[A-Z_]{1,64}$/.test(q.reasonCode) ? q.reasonCode : null,
        restartNeeded: q.restartNeeded.filter((u) => UNIT.test(u)),
        keptFiles: q.keptFiles
          .filter((k) => ETC_PATH.test(k.path))
          .map((k) => ({ path: k.path, newDefault: typeof k.newDefault === "string" && ETC_PATH.test(k.newDefault) ? k.newDefault : null })),
      },
    };
    return { found: true, record };
  }

  /** Installed versions read independently of the ledger (invariant 9). Any failure is not evidence. */
  async inspectInstalled(keys: readonly string[]): Promise<Readonly<Record<string, string | null>>> {
    const c = this.connection;
    if (c === undefined) throw new WritesDisabledError();
    const r = await collectInstalledViaSsh(c.inspect.target, c.inspect.options, { runner: c.runner, checkResolution: c.checkResolution });
    if (!r.ok) throw new TransportError("inspect");
    return Object.fromEntries(keys.map((k) => [k, r.installed.installed[k] ?? null]));
  }
}
