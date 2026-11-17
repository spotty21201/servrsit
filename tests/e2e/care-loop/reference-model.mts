/**
 * Spec-derived reference model of the care loop, used ONLY to self-check the
 * scenarios (are they able to pass? are they able to fail?). It is not a copy
 * of Coder's code and is never used as evidence about the real system.
 *
 * Rules implemented, with sources:
 *  - plan expiry 15 min while unstarted; accepted work may finish (FR-11, Tech §8.2, §9.1)
 *  - approval binds version + digest; PLAN_CHANGED / PLAN_EXPIRED (FR-11, Tech §9.2, §13)
 *  - production acknowledgements; session + CSRF (Tech §9.2)
 *  - idempotent approval; one unresolved mutation per canonical server (Tech §9.2, §9.4)
 *  - helper recomputes the transaction and refuses a changed one (Tech §10.2 step 5)
 *  - retries query the same operation id first (invariant 7, Tech §9.3)
 *  - outcome_unknown blocks conflicting writes; time never unblocks it (invariant 8, Tech §9.4)
 *  - stop request is a flag, not a cancellation (FR-16, Tech §11)
 *  - writesEnabled gate at plan, approval and dispatch; absent means false (ADR-014)
 *
 * `mutants` switch individual rules off to prove the scenarios notice.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  PROD_ACKS,
  UNRESOLVED,
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

const SEC = 1000;
const MIN = 60 * SEC;

export type Mutant =
  | "noExpiry" | "expiryKillsAccepted" | "ignoreDigest" | "ignoreVersion" | "acksNotRequired"
  | "noCsrf" | "noAuth" | "noIdempotency" | "noTargetBusy" | "duplicateOps" | "noTxnRecheck"
  | "ignoreRemovalBlock" | "noQueryBeforeRetry" | "regenIdOnRetry" | "unknownDoesNotBlock"
  | "leaseExpiryUnblocks" | "reconcileRedispatches" | "stopKills" | "stopCancelsQueuedWithoutQuery"
  | "writesGateMissing" | "writesGateApproveOnly" | "clientOverride" | "assistantApproves"
  | "defaultWritesTrue"
  | "onlyPackages"
  /** Design variant, NOT a fault: planning itself refuses write-disabled servers. Spec allows both (FR-10). */
  | "planBlocksOnWrites";

interface Txn { packages: string[]; deps: string[]; removals: string[]; candidate: number }

class Sim implements TargetSim {
  partitioned = false;
  drop: null | "before-acceptance" | "after-acceptance" = null;
  thenPartition = false;
  hold = false;
  kills = 0;
  readonly led = new Map<string, { opId: string; state: string; digest: string }>();
  readonly muts: MutationRecord[] = [];
  readonly log: Interaction[] = [];
  private held: { opId: string; kind: string }[] = [];
  private seq = 0;
  txn: Txn = { packages: ["openssl", "libc6"], deps: [], removals: [], candidate: 1 };

  record(kind: Interaction["kind"], opId?: string): void {
    this.log.push({ seq: ++this.seq, kind, opId });
  }
  snapshot(): string { return JSON.stringify(this.txn); }

  receive(m: { opId: string; digest: string; snapshot: string; kind: string }, skipRecheck: boolean):
    "lost" | "accepted" | "digest-mismatch" | { rejected: string } {
    if (this.drop === "before-acceptance") { this.drop = null; return "lost"; }
    this.record("manifest", m.opId);
    const existing = this.led.get(m.opId);
    if (existing) return existing.digest === m.digest ? "accepted" : "digest-mismatch";
    if (!skipRecheck && m.snapshot !== this.snapshot()) {
      this.led.set(m.opId, { opId: m.opId, state: "rejected", digest: m.digest });
      return { rejected: "PLAN_CHANGED" };
    }
    if (this.hold) {
      this.led.set(m.opId, { opId: m.opId, state: "running", digest: m.digest });
      this.held.push({ opId: m.opId, kind: m.kind });
    } else {
      this.led.set(m.opId, { opId: m.opId, state: "done", digest: m.digest });
      this.muts.push({ opId: m.opId, kind: m.kind });
    }
    if (this.drop === "after-acceptance") {
      this.drop = null;
      if (this.thenPartition) { this.partitioned = true; this.thenPartition = false; }
      return "lost";
    }
    return "accepted";
  }

  async mutations() { return [...this.muts]; }
  async interactions() { return [...this.log]; }
  async ledger(): Promise<LedgerEntry[]> { return [...this.led.values()].map((e) => ({ opId: e.opId, state: e.state })); }
  async killSignals() { return this.kills; }
  async partition(on: boolean) { this.partitioned = on; }
  async dropNextAck(when: "before-acceptance" | "after-acceptance", opts?: { thenPartition?: boolean }) {
    this.drop = when; this.thenPartition = opts?.thenPartition === true;
  }
  async changeTransaction(how: "add-dependency" | "new-candidate-version" | "add-removal") {
    if (how === "add-dependency") this.txn.deps.push(`libnew${this.txn.deps.length}`);
    else if (how === "new-candidate-version") this.txn.candidate += 1;
    else this.txn.removals.push("oldpkg");
  }
  async holdTransactionOpen(on: boolean) { this.hold = on; }
  async completeHeldTransaction() {
    for (const h of this.held) {
      const e = this.led.get(h.opId);
      if (e && e.state === "running") { e.state = "done"; this.muts.push({ opId: h.opId, kind: h.kind }); }
    }
    this.held = [];
  }
}

interface Srv { id: string; name: string; production: boolean; writes: boolean | undefined; canon: string }
interface Plan {
  id: string; version: number; serverId: string; canon: string; kind: Kind; digest: string;
  expiresAt: number; snapshot: string; blockers: string[]; approvedOp?: string;
}
interface Op {
  id: string; remoteId: string; serverId: string; canon: string; planId: string; version: number;
  state: string; stopRequested: boolean; reason?: string; events: { seq: number; type: string; at: string }[];
  attempted: boolean; uncertain: boolean; uncertainSince: number; nextAttemptAt: number; unknownSince: number;
}

const ok = <T,>(status: number, data: T): Res<T> => ({ ok: true, status, data });
const fail = <T = never,>(status: number, code: string): Res<T> => ({ ok: false, status, code });

export class ReferenceModel implements Harness {
  readonly name: string;
  get kinds(): readonly Kind[] {
    return this.has("onlyPackages") ? ["packages"] : ["packages", "restart-service", "reboot", "prepare-directories"];
  }
  private now = Date.parse("2026-01-01T00:00:00Z");
  private readonly servers = new Map<string, Srv>();
  private readonly sims = new Map<string, Sim>();
  private readonly plans = new Map<string, Plan>();
  private readonly ops = new Map<string, Op>();
  private readonly idem = new Map<string, string>();
  private paused = false;

  constructor(private readonly m: ReadonlySet<Mutant> = new Set()) {
    this.name = m.size ? `reference-model+${[...m].join(",")}` : "reference-model";
  }
  private has(x: Mutant): boolean { return this.m.has(x); }
  private iso(): string { return new Date(this.now).toISOString(); }

  // ---- setup ----
  async addServer(o: { name: string; production?: boolean; writesEnabled?: boolean | undefined; aliasOf?: string }) {
    const id = randomUUID();
    const canon = o.aliasOf ? this.servers.get(o.aliasOf)!.canon : id;
    if (!this.sims.has(canon)) this.sims.set(canon, new Sim());
    this.servers.set(id, { id, name: o.name, production: o.production ?? false, writes: o.writesEnabled, canon });
    return { id };
  }
  private srv(id: string): Srv { const s = this.servers.get(id); if (!s) throw new Error(`unknown server ${id}`); return s; }
  private sim(s: Srv): Sim { return this.sims.get(s.canon)!; }
  target(serverId: string): TargetSim { return this.sim(this.srv(serverId)); }

  private planWritesOk(s: Srv, override: boolean): boolean {
    if (this.has("writesGateMissing")) return true;
    if (this.has("defaultWritesTrue") && s.writes === undefined) return true;
    if (this.has("clientOverride") && override) return true;
    return s.writes === true;
  }
  private dispatchWritesOk(s: Srv): boolean {
    if (this.has("writesGateMissing") || this.has("writesGateApproveOnly")) return true;
    if (this.has("defaultWritesTrue") && s.writes === undefined) return true;
    return s.writes === true;
  }

  // ---- plans ----
  async createPlan(i: { serverId: string; kind: Kind }): Promise<Res<PlanView>> {
    if (!this.kinds.includes(i.kind)) return fail(400, "INVALID_INPUT");
    const s = this.srv(i.serverId); const t = this.sim(s);
    if (t.partitioned) return fail(503, "ROUTE_UNAVAILABLE");
    const blockers: string[] = [];
    if (this.has("planBlocksOnWrites") && !this.planWritesOk(s, false)) blockers.push("READ_ONLY_ACCESS");
    if (t.txn.removals.length > 0 && !this.has("ignoreRemovalBlock")) blockers.push("REMOVAL_NOT_SUPPORTED");
    const id = randomUUID(); const version = 1; const expiresAt = this.now + 15 * MIN; const snapshot = t.snapshot();
    const digest = createHash("sha256").update(JSON.stringify({ id, version, canon: s.canon, kind: i.kind, snapshot, expiresAt })).digest("hex");
    const plan: Plan = { id, version, serverId: s.id, canon: s.canon, kind: i.kind, digest, expiresAt, snapshot, blockers };
    this.plans.set(id, plan);
    return ok(200, this.planView(plan));
  }
  private planView(p: Plan): PlanView {
    const state = p.blockers.length ? "blocked" : p.approvedOp ? "approved" : this.now >= p.expiresAt ? "expired" : "ready";
    return { id: p.id, version: p.version, digest: p.digest, state, expiresAt: new Date(p.expiresAt).toISOString(), blockers: [...p.blockers] };
  }
  async getPlan(planId: string): Promise<Res<PlanView>> {
    const p = this.plans.get(planId);
    return p ? ok(200, this.planView(p)) : fail(404, "NOT_FOUND");
  }

  // ---- approval ----
  async approve(i: ApproveInput): Promise<Res<{ operationId: string }>> {
    if (i.session === "none" && !this.has("noAuth")) return fail(401, "UNAUTHENTICATED");
    if (i.csrf && i.csrf !== "valid" && !this.has("noCsrf")) return fail(403, "CSRF_INVALID");
    if (i.digest === undefined) return fail(400, "VALIDATION");
    const plan = this.plans.get(i.planId);
    if (!plan) return fail(404, "NOT_FOUND");
    const s = this.srv(plan.serverId); const t = this.sim(s);
    const ik = `${plan.id}:${plan.version}:${i.idempotencyKey}`;
    const dupes = this.has("noIdempotency") || this.has("duplicateOps");
    if (!dupes && this.idem.has(ik)) return ok(202, { operationId: this.idem.get(ik)! });
    const override = i.extra?.["writesEnabled"] === true || i.extra?.["force"] === true || i.extraHeaders?.["x-writes-enabled"] === "true";
    if (!this.planWritesOk(s, override)) return fail(403, "READ_ONLY_ACCESS");
    if (plan.version !== i.version && !this.has("ignoreVersion")) return fail(409, "PLAN_CHANGED");
    if (plan.digest !== i.digest && !this.has("ignoreDigest")) return fail(409, "PLAN_CHANGED");
    if (plan.blockers.length) return fail(409, "PLAN_BLOCKED");
    if (this.now >= plan.expiresAt && !this.has("noExpiry")) return fail(409, "PLAN_EXPIRED");
    if (!this.has("noTxnRecheck") && t.snapshot() !== plan.snapshot) return fail(409, "PLAN_CHANGED");
    if (s.production && !this.has("acksNotRequired") && !PROD_ACKS.every((a) => i.acknowledgements?.includes(a))) {
      return fail(400, "ACKNOWLEDGEMENT_REQUIRED");
    }
    if (!dupes && plan.approvedOp) return fail(409, "PLAN_ALREADY_APPROVED");
    if (!this.has("noTargetBusy") && !this.has("duplicateOps")) {
      const blocker = [...this.ops.values()].find((o) =>
        o.canon === plan.canon && UNRESOLVED.includes(o.state) &&
        !(this.has("unknownDoesNotBlock") && o.state === "outcome_unknown") &&
        !(this.has("leaseExpiryUnblocks") && o.state === "outcome_unknown" && this.now - o.unknownSince >= 20 * MIN));
      if (blocker) return fail(409, blocker.state === "outcome_unknown" ? "OUTCOME_UNKNOWN" : "TARGET_BUSY");
    }
    const op = this.createOp(plan);
    this.idem.set(ik, op.id);
    return ok(202, { operationId: op.id });
  }
  private createOp(plan: Plan): Op {
    const id = randomUUID();
    const op: Op = {
      id, remoteId: id, serverId: plan.serverId, canon: plan.canon, planId: plan.id, version: plan.version,
      state: "queued", stopRequested: false, events: [], attempted: false, uncertain: false,
      uncertainSince: 0, nextAttemptAt: 0, unknownSince: 0,
    };
    this.ops.set(id, op); plan.approvedOp = id; this.ev(op, "queued");
    return op;
  }
  private ev(o: Op, type: string): void { o.events.push({ seq: o.events.length + 1, type, at: this.iso() }); }
  private to(o: Op, state: string, reason?: string): void {
    o.state = state; if (reason) o.reason = reason; this.ev(o, state);
    if (state === "outcome_unknown") o.unknownSince = this.now;
  }
  private view(o: Op): OpView {
    return { id: o.id, remoteId: o.remoteId, state: o.state, stopRequested: o.stopRequested, serverId: o.serverId,
      planId: o.planId, planVersion: o.version, reason: o.reason, events: o.events.map((e) => ({ ...e })) };
  }
  async getOperation(id: string): Promise<Res<OpView>> { const o = this.ops.get(id); return o ? ok(200, this.view(o)) : fail(404, "NOT_FOUND"); }
  async listOperations(serverId: string): Promise<Res<readonly OpView[]>> {
    return ok(200, [...this.ops.values()].filter((o) => o.serverId === serverId).map((o) => this.view(o)));
  }

  // ---- worker ----
  private uncertainTick(o: Op): boolean {
    if (this.now - o.uncertainSince >= 10 * MIN) { this.to(o, "outcome_unknown"); return true; }
    return false;
  }
  private markUncertain(o: Op): void { if (!o.uncertain) { o.uncertain = true; o.uncertainSince = this.now; } }

  private step(o: Op): boolean {
    const s = this.srv(o.serverId); const t = this.sim(s); const plan = this.plans.get(o.planId)!;
    if (this.has("expiryKillsAccepted") && o.state === "running" && this.now >= plan.expiresAt) { this.to(o, "failed", "PLAN_EXPIRED"); return true; }
    if (o.state === "queued") {
      if (!o.attempted && this.paused) return false;
      if (this.now < o.nextAttemptAt) return false;
      if (!o.attempted) {
        if (!this.dispatchWritesOk(s)) { this.to(o, "cancelled_before_start", "WRITES_DISABLED"); return true; }
        if (!this.has("noExpiry") && this.now >= plan.expiresAt) { this.to(o, "cancelled_before_start", "PLAN_EXPIRED"); return true; }
      }
      if (o.uncertain) {
        if (t.partitioned) { t.record("connect-failed", o.remoteId); o.nextAttemptAt = this.now + 30 * SEC; return this.uncertainTick(o); }
        if (!this.has("noQueryBeforeRetry")) {
          t.record("query", o.remoteId);
          if (t.led.has(o.remoteId)) { o.uncertain = false; o.nextAttemptAt = 0; this.to(o, "running"); return true; }
        }
        if (this.has("regenIdOnRetry")) o.remoteId = randomUUID();
      } else if (t.partitioned) { t.record("connect-failed"); return false; }
      o.attempted = true;
      const r = t.receive({ opId: o.remoteId, digest: plan.digest, snapshot: plan.snapshot, kind: plan.kind }, this.has("noTxnRecheck"));
      if (r === "lost") { this.markUncertain(o); o.nextAttemptAt = this.now + 30 * SEC; return this.uncertainTick(o); }
      if (typeof r === "object") { this.to(o, "failed", r.rejected); return true; }
      if (r === "digest-mismatch") { this.to(o, "failed", "DIGEST_MISMATCH"); return true; }
      o.uncertain = false; o.nextAttemptAt = 0; this.to(o, "running");
      return true;
    }
    if (o.state === "verifying") { this.to(o, "succeeded"); return true; }
    if (o.state === "running") {
      if (this.now < o.nextAttemptAt) return false;
      if (t.partitioned) {
        t.record("connect-failed", o.remoteId); this.markUncertain(o); o.nextAttemptAt = this.now + 30 * SEC;
        return this.uncertainTick(o);
      }
      t.record("query", o.remoteId); o.uncertain = false;
      if (t.led.get(o.remoteId)?.state === "done") { this.to(o, "verifying"); return true; }
      o.nextAttemptAt = this.now + 30 * SEC;
    }
    return false;
  }

  async settle(): Promise<void> {
    for (let n = 0; n < 25; n++) {
      let changed = false;
      for (const o of [...this.ops.values()]) if (this.step(o)) changed = true;
      if (!changed) break;
    }
  }
  async advance(ms: number) { this.now += ms; }
  async pauseDispatch(on: boolean) { this.paused = on; }
  async restartController() {
    for (const o of this.ops.values()) {
      if (o.state === "queued" && o.attempted) { this.markUncertain(o); o.nextAttemptAt = this.now; }
    }
  }
  async setWritesEnabled(serverId: string, v: boolean | undefined) { this.srv(serverId).writes = v; }
  async schedulerTick() {
    for (const s of this.servers.values()) { const t = this.sim(s); if (!t.partitioned) t.record("inspect"); }
  }

  // ---- stop / reconcile ----
  async requestStop(id: string): Promise<Res<OpView>> {
    const o = this.ops.get(id); if (!o) return fail(404, "NOT_FOUND");
    const t = this.sim(this.srv(o.serverId));
    if (o.state === "queued") {
      if (!o.attempted || this.has("stopCancelsQueuedWithoutQuery")) this.to(o, "cancelled_before_start");
      else if (t.partitioned) { o.stopRequested = true; this.ev(o, "stop-requested"); }
      else {
        t.record("query", o.remoteId);
        if (t.led.has(o.remoteId)) { o.uncertain = false; o.nextAttemptAt = 0; this.to(o, "running"); o.stopRequested = true; this.ev(o, "stop-requested"); }
        else this.to(o, "cancelled_before_start");
      }
    } else if (["running", "verifying", "outcome_unknown"].includes(o.state)) {
      o.stopRequested = true; this.ev(o, "stop-requested");
      if (this.has("stopKills") && o.state === "running") { t.kills += 1; this.to(o, "failed", "STOPPED"); }
    }
    return ok(200, this.view(o));
  }

  async reconcile(id: string): Promise<Res<OpView>> {
    const o = this.ops.get(id); if (!o) return fail(404, "NOT_FOUND");
    const t = this.sim(this.srv(o.serverId));
    if (["outcome_unknown", "queued", "running"].includes(o.state)) {
      if (t.partitioned) { t.record("connect-failed", o.remoteId); return ok(200, this.view(o)); }
      if (this.has("reconcileRedispatches") && o.state === "outcome_unknown") {
        const plan = this.plans.get(o.planId)!; o.remoteId = randomUUID();
        t.receive({ opId: o.remoteId, digest: plan.digest, snapshot: plan.snapshot, kind: plan.kind }, true);
      }
      t.record("query", o.remoteId);
      const e = t.led.get(o.remoteId);
      if (o.state === "outcome_unknown") {
        this.ev(o, "reconciled");
        if (e) { o.uncertain = false; o.nextAttemptAt = 0; this.to(o, e.state === "done" ? "verifying" : "running"); }
        else this.to(o, "cancelled_before_start", "NOT_ACCEPTED");
      }
    }
    return ok(200, this.view(o));
  }

  // ---- chat and read-only ----
  async assistant(text: string, ctx: { planId?: string; serverId?: string }): Promise<Res> {
    if (this.has("assistantApproves") && /\b(yes|approve|do it|go ahead)\b/i.test(text) && ctx.planId) {
      const plan = this.plans.get(ctx.planId);
      if (plan && !plan.approvedOp) this.createOp(plan);
    }
    return ok(200, { reply: "Use the approval control on the plan page." });
  }
  async inspect(serverId: string): Promise<Res> {
    const t = this.sim(this.srv(serverId));
    if (t.partitioned) return fail(503, "ROUTE_UNAVAILABLE");
    t.record("inspect");
    return ok(200, {});
  }
}
