/**
 * Binding of the abstract Harness (support/contract.mts) to the INTEGRATED
 * care loop (T-048 on integration/live-v1). Plumbing only: no assertions.
 *
 * What is real here: the Fastify app from apps/api buildServer() with its real
 * care routes, CSRF guard and SQLite store; the real Dispatcher; the real
 * SimulatedTarget ledger. T-048 offers no HTTP test mode (simulated servers can
 * only be injected in code), so requests go through fastify.inject() in this
 * process. No socket is opened and no server, real or otherwise, is contacted.
 *
 * What is mine: the clock; a recording proxy around SimulatedTarget that logs,
 * in order, what the target saw (this is the oracle); fault controls.
 *
 * Mapping decisions, all deliberately visible:
 *  - Error code: body.error. For PLAN_BLOCKED the first typed blocker's code is
 *    used (Tech §9.1: blocked plans carry typed reasons; §13 names TARGET_BUSY etc.).
 *  - Plan state "expired" is derived from the plan's expiresAt and my clock.
 *  - Acknowledgements: the system has ONE production acknowledgement. Both
 *    abstract ones together map to it; a partial set maps to none.
 *  - Idempotency keys are hashed to the 16-128 char format the schema needs.
 *  - Routes that do not exist (stop-request, reconcile) return their real 404.
 *    For reconcile only, the fallback is the Dispatcher's own reconciliation
 *    step, and the fact is recorded in `fallbacks` for the report.
 *  - Aliases and a scheduler have no counterpart: reported, never faked.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CSRF_HEADER, CsrfGuard } from "../../../apps/api/src/csrf.ts";
import { buildServer } from "../../../apps/api/src/server.ts";

type App = Awaited<ReturnType<typeof buildServer>>;
import { Dispatcher, SimulatedTarget, TransportError, type WriteTarget } from "../../../apps/worker/src/index.ts";
import { createSigner, PRODUCTION_ACK } from "../../../packages/domain/src/index.ts";
import { MemoryIntentStore, SqliteCareStore, type OperationEvent, type StoredOperation } from "../../../packages/store/src/index.ts";
import {
  ACK_RECOVERY,
  ACK_RISK,
  UnsupportedByBinding,
  type ApproveInput,
  type Harness,
  type Interaction,
  type Kind,
  type LedgerEntry,
  type MutationRecord,
  type OpView,
  type PlanView,
  type Res,
  type TargetSim,
} from "./support/contract.mts";

export type Binding =
  | { bound: false; reason: string }
  | { bound: true; create(): Promise<InProcessHarness> };

const INSTALL = "inst-test";
const FINGERPRINT = "SHA256:simulated-host-key";
const SIM_PREFIX = "00000000-0000-4000-8000-";
const tmpDirs: string[] = [];
process.on("exit", () => { for (const d of tmpDirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } });

class Clock {
  t = Date.parse("2026-11-17T10:00:00.000Z");
  now = (): Date => new Date(this.t);
  advance(ms: number): void { this.t += ms; }
}

/** What the target saw, in order. Wraps the real SimulatedTarget; adds no behaviour except partition and logging. */
class RecordingTarget implements WriteTarget {
  readonly kind = "simulated" as const;
  readonly serverId: string;
  readonly hostKeyFingerprint = FINGERPRINT;
  readonly log: Interaction[] = [];
  partitioned = false;
  armPartitionAfterSubmit = false;
  removalInPreview = false;
  private seq = 0;
  constructor(readonly sim: SimulatedTarget, serverId: string) { this.serverId = serverId; }

  private rec(kind: Interaction["kind"], opId?: string): void { this.log.push({ seq: ++this.seq, kind, opId }); }

  async previewPackages() {
    if (this.partitioned) { this.rec("connect-failed"); throw new TransportError("inspect"); }
    this.rec("inspect");
    const p = await this.sim.previewPackages();
    return p && this.removalInPreview ? { ...p, removals: ["oldpkg"] } : p;
  }
  async submit(signed: Parameters<SimulatedTarget["submit"]>[0]) {
    const id = signed.manifest.operationId;
    if (this.partitioned) { this.rec("connect-failed", id); throw new TransportError("before-send"); }
    const before = this.sim.submitsReceived;
    try {
      return await this.sim.submit(signed);
    } finally {
      // Only requests that actually reached the target are logged: a dropped one was never seen.
      if (this.sim.submitsReceived > before) {
        this.rec("manifest", id);
        if (this.armPartitionAfterSubmit) { this.partitioned = true; this.armPartitionAfterSubmit = false; }
      }
    }
  }
  async query(operationId: string) {
    if (this.partitioned) { this.rec("connect-failed", operationId); throw new TransportError("query"); }
    this.rec("query", operationId);
    return this.sim.query(operationId);
  }
  async inspectInstalled(keys: readonly string[]) {
    if (this.partitioned) { this.rec("connect-failed"); throw new TransportError("inspect"); }
    this.rec("inspect");
    return this.sim.inspectInstalled(keys);
  }
}

class Controls implements TargetSim {
  constructor(private readonly rec: RecordingTarget, private readonly runMs: { value: number }) {}
  async mutations(): Promise<readonly MutationRecord[]> { return this.rec.sim.claims.map((opId) => ({ opId, kind: "apply.packages.v1" })); }
  async interactions(): Promise<readonly Interaction[]> { return [...this.rec.log]; }
  async ledger(): Promise<readonly LedgerEntry[]> { return this.rec.sim.claims.map((opId) => ({ opId, state: "accepted" })); }
  async killSignals(): Promise<number> { return 0; } // the WriteTarget contract has no way to stop or kill a run
  async partition(on: boolean) { this.rec.partitioned = on; }
  async dropNextAck(when: "before-acceptance" | "after-acceptance", opts?: { thenPartition?: boolean }) {
    if (when === "before-acceptance") this.rec.sim.faults.dropNextSubmitBeforeSend = true;
    else { this.rec.sim.faults.loseNextSubmitAck = true; this.rec.armPartitionAfterSubmit = opts?.thenPartition === true; }
  }
  async changeTransaction(how: "add-dependency" | "new-candidate-version" | "add-removal") {
    if (how === "add-dependency") this.rec.sim.addUpgrade({ name: "libextra", arch: "amd64", from: "1.0-1", to: "1.0-2" });
    else if (how === "new-candidate-version") this.rec.sim.addUpgrade({ name: "openssl", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.6" });
    else this.rec.removalInPreview = true;
  }
  async holdTransactionOpen(on: boolean) { this.runMs.value = on ? 1e12 : 1000; }
  async completeHeldTransaction() { this.runMs.value = 0; }
}

interface Entry {
  readonly care: { id: string; name: string; production: boolean; kind: "simulated"; writesEnabled: boolean | undefined };
  readonly rec: RecordingTarget;
  readonly controls: Controls;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const asBody = (b: unknown): Record<string, any> => (b !== null && typeof b === "object" ? (b as Record<string, any>) : {});

export class InProcessHarness implements Harness {
  readonly name = "integrated care loop (in-process: buildServer + Dispatcher + SimulatedTarget)";
  readonly kinds: readonly Kind[] = ["packages"];
  /** Capabilities that fell back or do not exist, for the report. */
  readonly fallbacks = new Set<string>();
  readonly missingRoutes = new Set<string>();

  private readonly clock = new Clock();
  private readonly dir = mkdtempSync(join(tmpdir(), "careloop-"));
  private readonly dbPath = join(this.dir, "care.db");
  private readonly store = new SqliteCareStore({ path: this.dbPath });
  private readonly readDb = new DatabaseSync(this.dbPath, { readOnly: true });
  private readonly intents = new MemoryIntentStore();
  private readonly signer = createSigner("key-1");
  private readonly csrf = new CsrfGuard();
  private readonly servers = new Map<string, Entry>();
  private readonly targets = new Map<string, WriteTarget>();
  private app: App | null = null;
  private dirty = true;
  private paused = false;
  private workerSeq = 0;
  private dispatcher: Dispatcher;
  private n = 0;

  constructor() {
    tmpDirs.push(this.dir);
    process.env["SESSION_SECRET"] ??= "tester-only-session-secret-0123456789abcdef";
    this.dispatcher = this.newDispatcher();
  }

  private newDispatcher(): Dispatcher {
    return new Dispatcher({
      store: this.store, intents: this.intents, targets: this.targets,
      // The gate is read from the server record on every use, as the dispatcher's contract says.
      writesEnabled: (id) => this.servers.get(id)?.care.writesEnabled as boolean,
      signer: this.signer, installationId: INSTALL, workerId: `w${++this.workerSeq}`, now: this.clock.now, leaseMs: 30_000,
    });
  }

  private async appInstance(): Promise<App> {
    if (this.app !== null && !this.dirty) return this.app;
    if (this.app !== null) await this.app.close();
    this.app = await buildServer({
      logger: false,
      startChecks: false,
      now: this.clock.now,
      care: {
        store: this.store,
        csrf: this.csrf,
        now: this.clock.now,
        simulated: [...this.servers.values()].map((e) => ({ server: e.care as never, target: e.rec })),
      },
    });
    this.dirty = false;
    return this.app;
  }

  private async http(method: "GET" | "POST", url: string, body?: unknown, headers: Record<string, string> = {}) {
    const app = await this.appInstance();
    const res = await app.inject({ method, url, payload: body === undefined ? undefined : (body as object), headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } });
    let json: unknown = null;
    try { json = res.body.length ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, body: asBody(json) };
  }

  private toRes<T>(status: number, body: Record<string, any>, data?: T): Res<T> {
    if (status < 400) return { ok: true, status, data };
    // Approval refusals list blockers as plain strings; plan responses use {code, message}. A plan can carry several
    // (for example OUTCOME_UNKNOWN and NO_CHANGES). The gate and conflict reasons are the ones that matter to the caller.
    let blocked: string | undefined;
    if (body["error"] === "PLAN_BLOCKED" && Array.isArray(body["blockers"])) {
      const codes = (body["blockers"] as unknown[]).map((x) => (typeof x === "string" ? x : String((x as { code?: unknown }).code)));
      blocked = ["WRITES_DISABLED", "OUTCOME_UNKNOWN", "TARGET_BUSY"].find((c) => codes.includes(c)) ?? codes[0];
    }
    return { ok: false, status, code: String(blocked ?? body["error"] ?? "UNKNOWN") };
  }

  // ---- Harness: setup ----
  async addServer(o: { name: string; production?: boolean; writesEnabled?: boolean | undefined; aliasOf?: string }) {
    if (o.aliasOf !== undefined) {
      throw new UnsupportedByBinding("T-048 has no canonical-identity model: a second record for one machine would have its own server id and its own lock (FR-02 duplicate detection not built)");
    }
    const id = `${SIM_PREFIX}${(++this.n).toString(16).padStart(12, "0")}`;
    const runMs = { value: 1000 };
    const sim = new SimulatedTarget({
      serverId: id, installationId: INSTALL, hostKeyFingerprint: FINGERPRINT,
      trustedKeys: { [this.signer.keyId]: this.signer.publicKeyPem },
      installed: { "openssl:amd64": "3.0.13-0ubuntu3.4", "libssl3t64:amd64": "3.0.13-0ubuntu3.4" },
      upgrades: [
        { name: "openssl", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5" },
        { name: "libssl3t64", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5" },
      ],
      now: this.clock.now,
      // The target reads runMs on every settle, so a held transaction can be released later.
      get runMs() { return runMs.value; },
    } as never);
    const rec = new RecordingTarget(sim, id);
    const entry: Entry = {
      care: { id, name: `${o.name}-${this.n}`, production: o.production ?? false, kind: "simulated", writesEnabled: o.writesEnabled },
      rec, controls: new Controls(rec, runMs),
    };
    this.servers.set(id, entry);
    this.targets.set(id, rec);
    this.dirty = true;
    return { id };
  }

  private planView(b: Record<string, any>): PlanView {
    const blockers: string[] = Array.isArray(b["blockers"]) ? b["blockers"].map((x: { code: string }) => x.code) : [];
    const expired = this.clock.t >= Date.parse(String(b["expiresAt"]));
    return { id: b["id"], version: b["version"], digest: b["digest"], expiresAt: b["expiresAt"], blockers, state: blockers.length ? "blocked" : expired ? "expired" : "ready" };
  }

  async createPlan(i: { serverId: string; kind: Kind }): Promise<Res<PlanView>> {
    const operation = i.kind === "packages" ? "apply.packages.v1" : i.kind;
    const r = await this.http("POST", "/api/plans", { operation, serverId: i.serverId });
    return r.status === 201 ? this.toRes(r.status, r.body, this.planView(r.body)) : this.toRes(r.status, r.body);
  }
  async getPlan(planId: string): Promise<Res<PlanView>> {
    const r = await this.http("GET", `/api/plans/${planId}`);
    return r.status === 200 ? this.toRes(r.status, r.body, this.planView(r.body)) : this.toRes(r.status, r.body);
  }

  async approve(i: ApproveInput): Promise<Res<{ operationId: string }>> {
    const headers: Record<string, string> = { ...(i.extraHeaders ?? {}) };
    const token = this.csrf.token;
    if (i.csrf !== "omit") headers[CSRF_HEADER] = i.csrf === "wrong" ? token.slice(0, -1) + (token.endsWith("0") ? "1" : "0") : token;
    const acks = i.acknowledgements ?? [];
    const body: Record<string, unknown> = {
      planVersion: i.version,
      ...(i.digest === undefined ? {} : { planDigest: i.digest }),
      idempotencyKey: sha(i.idempotencyKey).slice(0, 32),
      acknowledgements: acks.includes(ACK_RECOVERY) && acks.includes(ACK_RISK) ? [PRODUCTION_ACK] : [],
      ...(i.extra ?? {}),
    };
    const r = await this.http("POST", `/api/plans/${i.planId}/approvals`, body, headers);
    return r.status < 300 ? this.toRes(r.status, r.body, { operationId: String(r.body["operationId"]) }) : this.toRes(r.status, r.body);
  }

  private opView(op: StoredOperation): OpView {
    const events: readonly OperationEvent[] = this.store.listEvents(op.id);
    let reason: string | undefined;
    for (let k = events.length - 1; k >= 0 && reason === undefined; k--) {
      const p = events[k]!.payload;
      const v = p["code"] ?? p["reason"];
      if (typeof v === "string") reason = v;
    }
    return {
      id: op.id, remoteId: op.remoteOperationId ?? undefined, state: op.state, stopRequested: op.stopRequested,
      serverId: op.serverId, planId: op.planId, planVersion: op.planVersion, reason,
      events: events.map((e) => ({ seq: e.seq, type: e.type === "stop_requested" ? "stop-requested" : e.type, at: e.at })),
    };
  }

  async getOperation(id: string): Promise<Res<OpView>> {
    const r = await this.http("GET", `/api/operations/${id}`);
    if (r.status !== 200) return this.toRes(r.status, r.body);
    return { ok: true, status: 200, data: this.opView(r.body["operation"] as StoredOperation) };
  }
  async listOperations(serverId: string): Promise<Res<readonly OpView[]>> {
    // Ground truth from the database through a second, read-only connection, not through an API route.
    const rows = this.readDb.prepare("SELECT id FROM operations WHERE server_id = ? ORDER BY created_at, id").all(serverId) as { id: string }[];
    const ops = rows.map((row) => this.opView(this.store.getOperation(row.id) as StoredOperation));
    return { ok: true, status: 200, data: ops };
  }

  async requestStop(id: string): Promise<Res<OpView>> {
    const r = await this.http("POST", `/api/operations/${id}/stop-request`);
    if (r.status === 404) this.missingRoutes.add("POST /api/operations/:id/stop-request");
    return this.toRes(r.status, { ...r.body, error: r.status === 404 ? "NOT_FOUND" : r.body["error"] });
  }
  async reconcile(id: string): Promise<Res<OpView>> {
    const r = await this.http("POST", `/api/operations/${id}/reconcile`);
    if (r.status !== 404) return r.status < 300 ? { ok: true, status: r.status, data: (await this.getOperation(id)).data } : this.toRes(r.status, r.body);
    this.missingRoutes.add("POST /api/operations/:id/reconcile");
    this.fallbacks.add("reconcile: Dispatcher.step() used because the route is missing");
    try { await this.dispatcher.step(id); } catch { /* operation not found etc: reported by the read below */ }
    return this.getOperation(id);
  }

  async assistant(text: string, ctx: { planId?: string; serverId?: string }): Promise<Res> {
    const r = await this.http("POST", "/api/assistant/messages", { message: text, scope: ctx.serverId ?? "all" });
    return r.status < 400 ? { ok: true, status: r.status, data: r.body } : this.toRes(r.status, r.body);
  }
  async inspect(serverId: string): Promise<Res> {
    // T-048 has no inspection route for simulated servers: this reads the target directly (harness-level, not product evidence).
    this.fallbacks.add("inspect: read from the simulated target directly (no product route)");
    try { await this.servers.get(serverId)!.rec.inspectInstalled([]); return { ok: true, status: 200 }; }
    catch (e) { if (e instanceof TransportError) return { ok: false, status: 503, code: "ROUTE_UNAVAILABLE" }; throw e; }
  }

  // ---- Harness: controls ----
  async settle(): Promise<void> {
    if (this.paused) return;
    let unchanged = 0;
    let last = "";
    for (let pass = 0; pass < 40 && unchanged < 3; pass++) {
      const r = await this.dispatcher.runOnce();
      if (r.status === "idle") return;
      const sig = `${r.operationId}:${r.state}:${this.store.listEvents(r.operationId).length}`;
      unchanged = sig === last ? unchanged + 1 : 0;
      last = sig;
      this.clock.advance(1500); // the target's work takes (simulated) time
    }
  }
  async advance(ms: number) { this.clock.advance(ms); }
  async restartController() { this.dispatcher = this.newDispatcher(); this.dirty = true; }
  async pauseDispatch(on: boolean) { this.paused = on; }
  async setWritesEnabled(serverId: string, v: boolean | undefined) { (this.servers.get(serverId)!.care as { writesEnabled: boolean | undefined }).writesEnabled = v; }
  async schedulerTick() { this.fallbacks.add("schedulerTick: no-op, the care loop has no scheduler path"); }
  target(serverId: string): TargetSim {
    const e = this.servers.get(serverId);
    if (!e) throw new Error(`unknown server ${serverId}`);
    return e.controls;
  }
}

export async function loadBinding(): Promise<Binding> {
  return { bound: true, create: async () => new InProcessHarness() };
}
