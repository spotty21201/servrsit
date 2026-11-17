/**
 * Care-loop acceptance scenarios (Tester). Written BEFORE the implementation,
 * from PRD FR-10..FR-17, Technical Spec §9-§11 and §13, execution-security
 * invariants 1-14, and ADR-014. Scenarios depend only on the abstract
 * Harness in support/contract.mts.
 */
import assert from "node:assert/strict";
import {
  ACK_RECOVERY,
  ACK_RISK,
  PROD_ACKS,
  type Harness,
  type Kind,
  type PlanView,
  type Scenario,
} from "./support/contract.mts";
import {
  MIN,
  SEC,
  approvalFor,
  approveOk,
  assertNoWork,
  assertRefused,
  notExecuting,
  op,
  opCount,
  setup,
  targetOpIds,
  uid,
} from "./support/helpers.mts";

const KINDS: readonly Kind[] = ["packages", "restart-service", "reboot", "prepare-directories"];

/** A second, different plan for the same server. Uses another kind when the system has one. */
const altKind = (h: Harness): Kind => h.kinds.find((k) => k !== "packages") ?? "packages";

async function manifests(h: Harness, serverId: string, opId?: string): Promise<number> {
  return (await h.target(serverId).interactions()).filter((i) => i.kind === "manifest" && (opId === undefined || i.opId === opId)).length;
}

/** Interactions that name a specific operation, in the order the target saw them. */
async function opTrail(h: Harness, serverId: string): Promise<{ kind: string; opId: string }[]> {
  return (await h.target(serverId).interactions())
    .filter((i) => i.opId !== undefined)
    .map((i) => ({ kind: i.kind, opId: i.opId! }));
}

async function planOrFake(h: Harness, serverId: string, kind: Kind): Promise<{ plan: PlanView; real: boolean }> {
  const r = await h.createPlan({ serverId, kind });
  if (r.ok) return { plan: r.data!, real: true };
  assertRefused(r, `createPlan(${kind}) on a write-disabled server`);
  return {
    plan: { id: uid("plan"), version: 1, digest: "0".repeat(64), state: "fake", expiresAt: "", blockers: [] },
    real: false,
  };
}

// ---------------------------------------------------------------------------
// CL-01  Plan expiry  (FR-11, Tech §9.1, §9.2, §9.3, §8.2)
// ---------------------------------------------------------------------------
const expiry: Scenario[] = [
  {
    id: "CL-01a",
    title: "an unstarted plan can still be approved just inside its 15-minute window",
    traces: ["FR-11", "SA-007"],
    spec: ["FR-11: default expiry is 15 minutes for an unstarted plan", "Tech §9.1"],
    async run(h) {
      const { plan } = await setup(h);
      await h.advance(14 * MIN + 59 * SEC);
      const id = await approveOk(h, plan);
      assert.ok(id);
    },
  },
  {
    id: "CL-01b",
    title: "after 15 minutes the plan is expired: approval is refused with PLAN_EXPIRED and nothing reaches the server",
    traces: ["FR-11", "SA-007", "FI-010"],
    spec: ["FR-11: approval expires after 15 minutes", "Tech §13 error PLAN_EXPIRED", "UX §10.3: disable approval, explain, offer Refresh plan"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      await h.advance(15 * MIN + SEC);
      const r = await h.approve(approvalFor(plan));
      assertRefused(r, "approve expired plan", ["PLAN_EXPIRED"]);
      const p = await h.getPlan(plan.id);
      assert.equal(p.ok, true);
      assert.equal(p.data!.state, "expired", "an expired plan must read as expired");
      await h.settle();
      await assertNoWork(h, serverId, "expired plan");
    },
  },
  {
    id: "CL-01c",
    title: "refreshing an expired plan yields a different digest, and old approval or acknowledgements do not carry over",
    traces: ["FR-11", "UX §10.3"],
    spec: ["UX §10.3: previous acknowledgements and approval do not transfer automatically", "FR-11: changed scope requires a revised plan"],
    async run(h) {
      const { serverId, plan: old } = await setup(h, { production: true });
      await h.advance(16 * MIN);
      assertRefused(await h.approve(approvalFor(old, { production: true })), "approve old plan");
      const fresh = await h.createPlan({ serverId, kind: "packages" });
      assert.equal(fresh.ok, true, "a fresh plan must be creatable");
      const np = fresh.data!;
      assert.notEqual(np.digest, old.digest, "a refreshed plan needs a new digest");
      assert.ok(np.id !== old.id || np.version > old.version, "a refreshed plan is a new plan or a higher version");
      assertRefused(await h.approve(approvalFor(np, { production: true, digest: old.digest })), "new plan with the old digest");
      assertRefused(await h.approve(approvalFor(np, { production: true, acknowledgements: [] })), "new plan without acknowledgements");
      await assertNoWork(h, serverId, "refresh path before a valid approval");
      await approveOk(h, np, { production: true });
    },
  },
  {
    id: "CL-01d",
    title: "expiry applies only while unstarted: an operation already accepted by the target is not killed or expired",
    traces: ["FR-11", "FR-17", "Tech §8.2"],
    spec: ["Tech §8.2: a previously accepted job may finish after expiry", "Tech §9.1: expiry is 15 minutes while unstarted"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      const t = h.target(serverId);
      await t.holdTransactionOpen(true);
      const id = await approveOk(h, plan);
      await h.settle();
      assert.equal((await op(h, id)).state, "running", "premise: the target accepted and is working");
      await h.advance(20 * MIN);
      await h.settle();
      const mid = await op(h, id);
      assert.equal(mid.state, "running", `an accepted operation must not be expired or cancelled by plan expiry (was ${mid.state})`);
      assert.equal(await t.killSignals(), 0);
      await t.completeHeldTransaction();
      await h.advance(MIN); // the controller learns of completion on its next poll, not instantly
      await h.settle();
      assert.equal((await op(h, id)).state, "succeeded");
      assert.equal((await t.mutations()).length, 1);
    },
  },
  {
    id: "CL-01e",
    title: "a plan that expires while still queued and unsent is never sent to the target",
    traces: ["FR-11", "Tech §9.3"],
    spec: ["Tech §9.3: before sending, the worker checks plan expiry if not yet accepted remotely"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      await h.pauseDispatch(true);
      const id = await approveOk(h, plan);
      await h.advance(16 * MIN);
      await h.pauseDispatch(false);
      await h.settle();
      const o = await op(h, id);
      assert.ok(notExecuting(o.state), `an expired, unsent operation must not execute (state ${o.state})`);
      assert.equal(await manifests(h, serverId), 0, "no mutation request may be sent after expiry");
      assert.deepEqual(await h.target(serverId).mutations(), []);
    },
  },
];

// ---------------------------------------------------------------------------
// CL-02  Digest, version and approval-envelope mismatch  (FR-11, Tech §9.2)
// ---------------------------------------------------------------------------
const flip = (d: string): string => d.slice(0, -1) + (d.endsWith("0") ? "1" : "0");

const digest: Scenario[] = [
  {
    id: "CL-02a",
    title: "a tampered digest is refused with PLAN_CHANGED, and the untouched plan is still approvable afterwards",
    traces: ["FR-11", "SA-007"],
    spec: ["FR-11: approval binds to one plan version", "Tech §9.2: approval requires plan digest/version", "Tech §13 PLAN_CHANGED"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      assertRefused(await h.approve(approvalFor(plan, { digest: flip(plan.digest) })), "tampered digest", ["PLAN_CHANGED"]);
      await h.settle();
      await assertNoWork(h, serverId, "tampered digest");
      await approveOk(h, plan);
    },
  },
  {
    id: "CL-02b",
    title: "another plan's digest cannot approve this plan",
    traces: ["FR-11", "invariant 4"],
    spec: ["execution-security 4: approval binds to one plan version, one scope"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      const other = await h.createPlan({ serverId, kind: altKind(h) });
      assert.equal(other.ok, true);
      assert.notEqual(other.data!.digest, plan.digest, "premise: different plans have different digests");
      assertRefused(await h.approve(approvalFor(plan, { digest: other.data!.digest })), "cross-plan digest");
      await h.settle();
      await assertNoWork(h, serverId, "cross-plan digest");
    },
  },
  {
    id: "CL-02c",
    title: "the right digest with the wrong version is refused",
    traces: ["FR-11"],
    spec: ["Tech §9.2: plan digest/version"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      for (const v of [plan.version + 1, plan.version + 100, 0]) {
        assertRefused(await h.approve(approvalFor(plan, { version: v })), `version ${v}`);
      }
      await h.settle();
      await assertNoWork(h, serverId, "wrong version");
    },
  },
  {
    id: "CL-02d",
    title: "an approval with no digest at all is refused as invalid",
    traces: ["FR-11"],
    spec: ["Tech §9.2: the approval endpoint requires the plan digest"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      assertRefused(await h.approve(approvalFor(plan, { digest: undefined })), "missing digest");
      await h.settle();
      await assertNoWork(h, serverId, "missing digest");
    },
  },
  {
    id: "CL-02e",
    title: "a production server needs both explicit acknowledgements, and a partial set is refused",
    traces: ["FR-13", "FR-14", "Tech §9.2", "UX §10.2"],
    spec: ["Tech §9.2: explicit production acknowledgements", "UX §10.2: unselected by default; recovery route and interruption risk"],
    async run(h) {
      const { serverId, plan } = await setup(h, { production: true });
      for (const acks of [[], [ACK_RECOVERY], [ACK_RISK]] as const) {
        assertRefused(await h.approve(approvalFor(plan, { acknowledgements: acks })), `acks [${acks.join(",")}]`);
      }
      await h.settle();
      await assertNoWork(h, serverId, "missing production acknowledgements");
      await approveOk(h, plan, { production: true });
    },
  },
  {
    id: "CL-02f",
    title: "approval needs a valid CSRF token: missing or wrong is refused",
    traces: ["FR-11", "Tech §9.2"],
    spec: ["Tech §9.2: the approval endpoint requires CSRF protection"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      assertRefused(await h.approve(approvalFor(plan, { csrf: "omit" })), "no csrf token");
      assertRefused(await h.approve(approvalFor(plan, { csrf: "wrong" })), "wrong csrf token");
      await h.settle();
      await assertNoWork(h, serverId, "CSRF-less approval");
      await approveOk(h, plan);
    },
  },
  {
    id: "CL-02g",
    title: "approval needs a signed-in owner: a request with no session is refused",
    traces: ["FR-01", "FR-11", "NF-001", "Tech §9.2"],
    spec: ["FR-01: a signed-out session cannot approve an operation", "Tech §9.2: authenticated owner context"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      assertRefused(await h.approve(approvalFor(plan, { session: "none" })), "no session");
      await h.settle();
      await assertNoWork(h, serverId, "unauthenticated approval");
    },
  },
];

// ---------------------------------------------------------------------------
// CL-03  Double approval and concurrent requests  (FR-11, FR-14, Tech §9.2, §9.4)
// ---------------------------------------------------------------------------
const dupes: Scenario[] = [
  {
    id: "CL-03a",
    title: "the same approval sent twice returns the same operation and the server changes once",
    traces: ["FR-11", "SA-014"],
    spec: ["Tech §9.2: repeated client requests return the same operation", "FR-11: repeated clicks cannot start duplicate work"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      const input = approvalFor(plan);
      const a = await h.approve(input);
      const b = await h.approve(input);
      assert.equal(a.ok && b.ok, true, "a replay with the same idempotency key must succeed");
      assert.equal(a.data!.operationId, b.data!.operationId);
      await h.settle();
      assert.equal(await opCount(h, [serverId]), 1);
      assert.equal((await h.target(serverId).mutations()).length, 1);
    },
  },
  {
    id: "CL-03b",
    title: "ten simultaneous approvals with one key produce exactly one operation and one mutation",
    traces: ["FR-11", "FR-14", "SA-014"],
    spec: ["Tech §9.2: one transaction records the approval and creates the unique operation", "Tech §9.4: duplicated HTTP requests"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      const input = approvalFor(plan);
      const rs = await Promise.all(Array.from({ length: 10 }, () => h.approve(input)));
      for (const r of rs) assert.equal(r.ok, true, `every duplicate must resolve to the existing operation (got ${r.status} ${r.code})`);
      assert.equal(new Set(rs.map((r) => r.data!.operationId)).size, 1, "all duplicates must name one operation");
      await h.settle();
      assert.equal(await opCount(h, [serverId]), 1);
      assert.equal((await h.target(serverId).mutations()).length, 1);
    },
  },
  {
    id: "CL-03c",
    title: "a second approval with a different key cannot create a second operation for the same plan version",
    traces: ["FR-11", "SA-014"],
    spec: ["Tech §9.2: idempotency key scoped to owner + plan version", "FR-11: approval is bound to one plan version"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      const a = await h.approve(approvalFor(plan));
      assert.equal(a.ok, true);
      const b = await h.approve(approvalFor(plan));
      if (b.ok) assert.equal(b.data!.operationId, a.data!.operationId, "a second success must name the same operation");
      else assertRefused(b, "second key");
      await h.settle();
      assert.equal(await opCount(h, [serverId]), 1);
      assert.equal((await h.target(serverId).mutations()).length, 1);
    },
  },
  {
    id: "CL-03d",
    title: "two different plans for one server approved at once: one runs, the other gets TARGET_BUSY",
    traces: ["FR-14", "SA-014", "Tech §9.4"],
    spec: ["FR-14: two different requests cannot change the same machine simultaneously", "Tech §9.4: one unresolved mutation per canonical server"],
    async run(h) {
      const { serverId, plan: a } = await setup(h);
      const b = (await h.createPlan({ serverId, kind: altKind(h) })).data!;
      const [ra, rb] = await Promise.all([h.approve(approvalFor(a)), h.approve(approvalFor(b))]);
      assert.equal([ra, rb].filter((r) => r.ok).length, 1, "exactly one of two conflicting approvals may succeed");
      assertRefused(ra.ok ? rb : ra, "the loser", ["TARGET_BUSY"]);
      await h.settle();
      assert.equal(await opCount(h, [serverId]), 1);
      assert.equal((await h.target(serverId).mutations()).length, 1);
    },
  },
  {
    id: "CL-03e",
    title: "a second display name for the same machine cannot bypass the same-server lock",
    traces: ["FR-02", "FR-14", "Tech §9.4"],
    spec: ["FR-02 acceptance: two display names cannot accidentally bypass the same-server operation lock"],
    async run(h) {
      const s1 = await h.addServer({ name: uid("srv"), writesEnabled: true });
      const s2 = await h.addServer({ name: uid("alias"), writesEnabled: true, aliasOf: s1.id });
      const pa = (await h.createPlan({ serverId: s1.id, kind: "packages" })).data!;
      const pb = (await h.createPlan({ serverId: s2.id, kind: altKind(h) })).data!;
      await approveOk(h, pa);
      assertRefused(await h.approve(approvalFor(pb)), "approval via the alias", ["TARGET_BUSY"]);
      await h.settle();
      assert.equal(await opCount(h, [s1.id, s2.id]), 1);
      assert.equal((await h.target(s1.id).mutations()).length, 1);
    },
  },
  {
    id: "CL-03f",
    title: "replaying a completed approval returns the original operation and changes nothing",
    traces: ["FR-11", "FR-16"],
    spec: ["Tech §9.2: repeated client requests return the same operation, never a fresh execution"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      const input = approvalFor(plan);
      const first = await h.approve(input);
      assert.equal(first.ok, true);
      await h.settle();
      assert.equal((await op(h, first.data!.operationId)).state, "succeeded", "premise: the operation completed");
      const replay = await h.approve(input);
      assert.equal(replay.ok, true);
      assert.equal(replay.data!.operationId, first.data!.operationId);
      await h.settle();
      assert.equal(await opCount(h, [serverId]), 1);
      assert.equal((await h.target(serverId).mutations()).length, 1);
    },
  },
];

// ---------------------------------------------------------------------------
// CL-04  Changed transaction invalidates approval  (FR-11, FR-12, Tech §10.2 step 5)
// ---------------------------------------------------------------------------
const changed: Scenario[] = [
  {
    id: "CL-04a",
    title: "if the package transaction changes after approval, nothing is committed and the reason is given",
    traces: ["FR-11", "FR-12", "FI-010", "SA-007"],
    spec: ["Tech §10.2 step 5: if different, perform no commit and require a new plan", "FR-12: lock, disk or broken state stops work with an explanation"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      await h.pauseDispatch(true);
      const id = await approveOk(h, plan);
      await h.target(serverId).changeTransaction("add-dependency");
      await h.pauseDispatch(false);
      await h.settle();
      const o = await op(h, id);
      assert.ok(notExecuting(o.state), `a changed transaction must not execute (state ${o.state})`);
      assert.ok(o.reason && o.reason.length > 0, "the operation must say why it did not run");
      assert.deepEqual(await h.target(serverId).mutations(), [], "no package may be installed from a changed transaction");
    },
  },
  {
    id: "CL-04b",
    title: "the old approval cannot be reused for the changed transaction; a new plan with a new digest can be",
    traces: ["FR-11", "SA-007"],
    spec: ["FR-11: a changed package transaction invalidates approval and requires a revised plan"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      await h.pauseDispatch(true);
      const first = await approveOk(h, plan);
      await h.target(serverId).changeTransaction("add-dependency");
      await h.pauseDispatch(false);
      await h.settle();
      assertRefused(await h.approve(approvalFor(plan)), "re-approving the superseded plan");
      await h.settle();
      assert.deepEqual(await h.target(serverId).mutations(), []);
      const fresh = await h.createPlan({ serverId, kind: "packages" });
      assert.equal(fresh.ok, true);
      assert.notEqual(fresh.data!.digest, plan.digest, "the revised plan must differ");
      const second = await approveOk(h, fresh.data!);
      assert.notEqual(second, first, "a revised plan is a new operation");
      await h.settle();
      assert.equal((await h.target(serverId).mutations()).length, 1, "exactly the revised transaction is applied");
    },
  },
  {
    id: "CL-04c",
    title: "if the target changes between plan and approval, approving the old digest is refused",
    traces: ["FR-11", "Tech §9.2"],
    spec: ["Tech §9.2: the approval endpoint checks target state", "FR-11: a changed target or transaction invalidates approval"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      await h.target(serverId).changeTransaction("new-candidate-version");
      const seen = await h.inspect(serverId);
      assert.equal(seen.ok, true, "premise: the controller observed the target again");
      assertRefused(await h.approve(approvalFor(plan)), "stale plan", ["PLAN_CHANGED"]);
      await h.settle();
      await assertNoWork(h, serverId, "stale plan");
      const fresh = await h.createPlan({ serverId, kind: "packages" });
      assert.equal(fresh.ok, true);
      await approveOk(h, fresh.data!);
    },
  },
  {
    id: "CL-04d",
    title: "a transaction that would remove packages is blocked in Stage A and cannot be approved",
    traces: ["FR-12", "FI-013"],
    spec: ["FR-12: any removal is blocked in A", "Tech §9.1: blocked plans have no approval path that bypasses the reasons"],
    async run(h) {
      const server = await h.addServer({ name: uid("srv"), writesEnabled: true });
      await h.target(server.id).changeTransaction("add-removal");
      const r = await h.createPlan({ serverId: server.id, kind: "packages" });
      if (r.ok) {
        assert.equal(r.data!.state, "blocked", "a plan with a removal must be blocked");
        assert.ok(r.data!.blockers.length > 0, "a blocked plan must carry typed reasons");
        assertRefused(await h.approve(approvalFor(r.data!)), "blocked plan");
      } else {
        assertRefused(r, "plan with a removal");
      }
      await h.settle();
      await assertNoWork(h, server.id, "removal");
    },
  },
];

// ---------------------------------------------------------------------------
// CL-05  Retry after a lost acknowledgement queries the same operation ID first
//        (FR-17, invariant 7, Tech §9.3)
// ---------------------------------------------------------------------------
async function assertQueryThenNoReissue(h: Harness, serverId: string, label: string): Promise<string> {
  const ids = await targetOpIds(h, serverId);
  assert.equal(ids.length, 1, `${label}: the target must only ever see ONE operation id, saw ${ids.length}: ${ids.join(", ")}`);
  const X = ids[0]!;
  const trail = (await opTrail(h, serverId)).filter((e) => e.opId === X);
  assert.ok(trail.some((e) => e.kind === "query"), `${label}: the retry must query the operation id first`);
  assert.equal(trail.filter((e) => e.kind === "manifest").length, 1, `${label}: the mutation request must be sent once`);
  const firstManifest = trail.findIndex((e) => e.kind === "manifest");
  const firstQuery = trail.findIndex((e) => e.kind === "query");
  assert.ok(firstQuery >= 0);
  return X + (firstManifest < firstQuery ? ":manifest-first" : ":query-first");
}

const lostAck: Scenario[] = [
  {
    id: "CL-05a",
    title: "ack lost after the target accepted: every retry queries the same id, never re-sends, and the server changes once",
    traces: ["FR-17", "SA-009", "FI-002", "invariant 7"],
    spec: ["invariant 7: queue retries query the same remote operation ID before any further action", "Tech §9.3: never regenerate an ID because a response was lost"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      await h.target(serverId).dropNextAck("after-acceptance");
      const id = await approveOk(h, plan);
      await h.settle();
      assert.equal((await h.target(serverId).ledger()).length, 1, "premise: the target accepted before the ack was lost");
      for (let i = 0; i < 3; i++) {
        await h.advance(2 * MIN);
        await h.settle();
      }
      const tag = await assertQueryThenNoReissue(h, serverId, "after-acceptance");
      const X = tag.split(":")[0]!;
      const o = await op(h, id);
      assert.ok([o.id, o.remoteId].includes(X), "the remote operation id must be the operation's own id");
      assert.equal((await h.target(serverId).mutations()).length, 1, "exactly one mutation");
      assert.equal(await opCount(h, [serverId]), 1);
      assert.ok(["running", "verifying", "succeeded"].includes(o.state), `the operation must follow the target's evidence (was ${o.state})`);
    },
  },
  {
    id: "CL-05b",
    title: "request lost before acceptance: the retry queries first (not found), then re-sends with the SAME id",
    traces: ["FR-17", "FI-001", "invariant 7"],
    spec: ["invariant 7", "Tech §9.3: the controller must never regenerate an ID merely because an SSH response was lost"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      await h.target(serverId).dropNextAck("before-acceptance");
      const id = await approveOk(h, plan);
      await h.settle();
      await h.advance(2 * MIN);
      await h.settle();
      // If the drop had not happened, the target's first contact would be the mutation request, not a query.
      const tag = await assertQueryThenNoReissue(h, serverId, "before-acceptance");
      assert.ok(tag.endsWith(":query-first"), "the target's first contact for this id must be a query");
      assert.equal((await h.target(serverId).ledger()).length, 1);
      assert.equal((await h.target(serverId).mutations()).length, 1);
      assert.equal(await opCount(h, [serverId]), 1);
      assert.ok([id].includes((await op(h, id)).id));
    },
  },
  {
    id: "CL-05c",
    title: "controller restart after acceptance: it queries the same id and does not re-send",
    traces: ["FR-17", "FI-006", "invariant 7"],
    spec: ["FR-17: reconcile real machine state before retrying after an executor restart", "Tech §9.4: a replacement worker reconciles the existing operation"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      await h.target(serverId).dropNextAck("after-acceptance", { thenPartition: true });
      await approveOk(h, plan);
      await h.settle();
      await h.restartController();
      await h.target(serverId).partition(false);
      await h.advance(MIN);
      await h.settle();
      await assertQueryThenNoReissue(h, serverId, "restart");
      assert.equal((await h.target(serverId).mutations()).length, 1);
      assert.equal(await opCount(h, [serverId]), 1);
    },
  },
];

// ---------------------------------------------------------------------------
// CL-06  outcome_unknown blocks conflicting writes  (FR-17, invariant 8, Tech §9.4, §11)
// ---------------------------------------------------------------------------
async function makeUnknown(h: Harness): Promise<{ serverId: string; opId: string }> {
  const { serverId, plan } = await setup(h);
  const t = h.target(serverId);
  await t.dropNextAck("after-acceptance", { thenPartition: true });
  const opId = await approveOk(h, plan);
  await h.settle();
  await h.advance(30 * MIN);
  await h.settle();
  const o = await op(h, opId);
  assert.equal(o.state, "outcome_unknown", `premise: an unreachable target with no ack must be outcome_unknown, was ${o.state}`);
  // Reachability alone is NOT evidence: restore the route but do not reconcile.
  await t.partition(false);
  return { serverId, opId };
}

const unknown: Scenario[] = [
  {
    id: "CL-06a",
    title: "while outcome is unknown, a conflicting approval is refused even though the target is reachable again",
    traces: ["FR-17", "FR-14", "SA-009", "invariant 8"],
    spec: ["invariant 8: unknown outcome blocks conflicting writes", "Tech §9.4: until authoritative evidence resolves it"],
    async run(h) {
      const { serverId } = await makeUnknown(h);
      const before = await manifests(h, serverId);
      const b = await h.createPlan({ serverId, kind: altKind(h) });
      assert.equal(b.ok, true, "premise: a new plan can be drawn up");
      assertRefused(await h.approve(approvalFor(b.data!)), "conflicting approval", ["TARGET_BUSY", "OUTCOME_UNKNOWN"]);
      assert.equal(await opCount(h, [serverId]), 1, "no second operation may be created");
      assert.equal(await manifests(h, serverId), before, "no new mutation request may reach the target");
    },
  },
  {
    id: "CL-06b",
    title: "lease expiry and the passage of time never unblock an unknown outcome",
    traces: ["FR-17", "invariant 8", "Tech §9.4"],
    spec: ["Tech §9.4: lease expiry does not prove remote work stopped and never authorizes another mutation"],
    async run(h) {
      const { serverId } = await makeUnknown(h);
      const before = await manifests(h, serverId);
      const t = h.target(serverId);
      for (const wait of [10 * MIN, 60 * MIN, 24 * 60 * MIN]) {
        await t.partition(true);
        await h.advance(wait);
        await h.settle(); // the worker keeps trying to reconcile and keeps failing
        await t.partition(false); // reachable again, but no reconcile has succeeded
        const p = await h.createPlan({ serverId, kind: altKind(h) });
        assert.equal(p.ok, true);
        assertRefused(await h.approve(approvalFor(p.data!)), `after ${wait / MIN} more minutes`, ["TARGET_BUSY", "OUTCOME_UNKNOWN"]);
      }
      assert.equal(await manifests(h, serverId), before);
      assert.equal(await opCount(h, [serverId]), 1);
    },
  },
  {
    id: "CL-06c",
    title: "an unknown outcome on one server does not block work on another",
    traces: ["FR-14", "Tech §9.4"],
    spec: ["Tech §9.4: one unresolved mutation per canonical server identity (not per fleet)"],
    async run(h) {
      await makeUnknown(h);
      const other = await setup(h);
      await approveOk(h, other.plan);
      await h.settle();
      assert.equal((await h.target(other.serverId).mutations()).length, 1);
    },
  },
  {
    id: "CL-06d",
    title: "reconcile only reads: it never sends a mutation and never guesses an outcome",
    traces: ["FR-17", "Tech §13 reconcile", "invariant 7"],
    spec: ["Tech §13: reconcile reads existing remote state; never implicitly starts a new mutation", "Tech §11: outcome_unknown until evidence"],
    async run(h) {
      const { serverId, opId } = await makeUnknown(h);
      const t = h.target(serverId);
      await t.partition(true);
      const sentBefore = await manifests(h, serverId);
      const mutBefore = (await t.mutations()).length;
      const r = await h.reconcile(opId);
      if (r.ok) assert.equal(r.data!.state, "outcome_unknown", "with no evidence the state must stay unknown");
      assert.equal((await op(h, opId)).state, "outcome_unknown", "no guess of success or failure without evidence");
      assert.equal(await manifests(h, serverId), sentBefore);
      assert.equal((await t.mutations()).length, mutBefore);
    },
  },
  {
    id: "CL-06e",
    title: "authoritative evidence resolves it by APPENDING events: history is kept and the block lifts",
    traces: ["FR-16", "FR-17", "Tech §11"],
    spec: ["Tech §11: terminal records cannot be edited into success; later evidence is appended as a reconciliation event", "invariant 8"],
    async run(h) {
      const { serverId, opId } = await makeUnknown(h);
      const before = (await op(h, opId)).events;
      assert.ok(before.some((e) => e.type === "outcome_unknown"), "the uncertainty must be recorded as an event");
      const sentBefore = await manifests(h, serverId);
      const r = await h.reconcile(opId);
      assert.equal(r.ok, true, `reconcile must work once the target is reachable (${r.status} ${r.code})`);
      await h.settle();
      const after = await op(h, opId);
      assert.notEqual(after.state, "outcome_unknown", "evidence exists on the target, so the state must resolve");
      assert.ok(!["cancelled_before_start"].includes(after.state), "the target holds the operation, so it cannot be 'cancelled before start'");
      assert.deepEqual(after.events.slice(0, before.length), before, "earlier events must be unchanged");
      assert.ok(after.events.length > before.length, "resolution must add events");
      const seqs = after.events.map((e) => e.seq);
      assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), "sequence must be ordered");
      assert.equal(new Set(seqs).size, seqs.length, "sequence numbers must be unique");
      assert.ok(after.events.some((e) => e.type === "outcome_unknown"), "the earlier uncertainty must remain visible");
      assert.equal(await manifests(h, serverId), sentBefore, "resolving must not send another mutation");
      // The first operation applied everything pending, so a new update must appear before there is anything to plan.
      await h.target(serverId).changeTransaction("add-dependency");
      const next = await h.createPlan({ serverId, kind: altKind(h) });
      assert.equal(next.ok, true);
      await approveOk(h, next.data!);
    },
  },
];

// ---------------------------------------------------------------------------
// CL-07  A stop request is not a cancellation  (FR-16, FR-17, Tech §11, UX §11)
// ---------------------------------------------------------------------------
const stop: Scenario[] = [
  {
    id: "CL-07a",
    title: "stopping a running operation records a request: nothing is killed, the state stays running, the work finishes",
    traces: ["FR-16", "FR-17", "invariant 6"],
    spec: ["FR-16: a stop request is a request to stop at a safe boundary, not an immediate reversal", "Tech §11: stop_requested is an orthogonal flag, not proof of cancellation", "Tech §10.2: a safe-stop request does not force-terminate an active package transaction"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      const t = h.target(serverId);
      await t.holdTransactionOpen(true);
      const id = await approveOk(h, plan);
      await h.settle();
      assert.equal((await op(h, id)).state, "running", "premise: work is in progress");
      const r1 = await h.requestStop(id);
      const r2 = await h.requestStop(id);
      assert.equal(r1.ok && r2.ok, true, "a stop request must be accepted, and repeating it must be harmless");
      await h.settle();
      const o = await op(h, id);
      assert.equal(o.stopRequested, true, "the flag must be recorded");
      assert.equal(o.state, "running", `a stop request must not change the state (was ${o.state})`);
      assert.equal(await t.killSignals(), 0, "an active transaction must not be signalled");
      assert.ok(o.events.some((e) => e.type === "stop-requested"), "the request must be in the history");
      await t.completeHeldTransaction();
      await h.advance(MIN); // next poll interval
      await h.settle();
      const done = await op(h, id);
      assert.equal(done.state, "succeeded", "the already-accepted work completes and is verified");
      assert.equal((await t.mutations()).length, 1);
      assert.equal(await t.killSignals(), 0);
      assert.ok(!done.events.some((e) => /roll|undo|revert|cancel/i.test(e.type)), "nothing may claim a reversal");
    },
  },
  {
    id: "CL-07b",
    title: "stopping an operation that was never sent is cancelled-before-start, and nothing is ever sent",
    traces: ["FR-16", "Tech §11"],
    spec: ["Tech §11: cancelled_before_start means no remote work was accepted"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      await h.pauseDispatch(true);
      const id = await approveOk(h, plan);
      const r = await h.requestStop(id);
      assert.equal(r.ok, true);
      assert.equal((await op(h, id)).state, "cancelled_before_start");
      await h.pauseDispatch(false);
      await h.settle();
      assert.equal(await manifests(h, serverId), 0, "a cancelled operation must never be sent");
      assert.deepEqual(await h.target(serverId).mutations(), []);
    },
  },
  {
    id: "CL-07c",
    title: "stopping an operation that may already be on the target must query first, never call it cancelled",
    traces: ["FR-17", "Tech §11", "invariant 6"],
    spec: ["Tech §11: if a supposedly queued job may already have reached the remote machine, query it before calling it cancelled"],
    async run(h) {
      const { serverId, plan } = await setup(h);
      await h.target(serverId).dropNextAck("after-acceptance");
      const id = await approveOk(h, plan);
      await h.settle();
      assert.equal((await h.target(serverId).ledger()).length, 1, "premise: the target holds the operation but the controller never heard");
      const r = await h.requestStop(id);
      assert.equal(r.ok, true);
      const o = await op(h, id);
      assert.notEqual(o.state, "cancelled_before_start", "the target already accepted this operation");
      await h.advance(2 * MIN);
      await h.settle();
      const later = await op(h, id);
      assert.ok(["running", "verifying", "succeeded"].includes(later.state), `must follow the target's evidence, was ${later.state}`);
      assert.equal((await h.target(serverId).mutations()).length, 1);
      assert.equal(await h.target(serverId).killSignals(), 0);
    },
  },
];

// ---------------------------------------------------------------------------
// CL-08  writesEnabled=false blocks EVERY write path  (ZT-01, ADR-014, invariants 11-12)
// ---------------------------------------------------------------------------
const FLAGS: readonly (false | undefined)[] = [false, undefined];
const label = (v: boolean | undefined): string => (v === undefined ? "absent" : String(v));

const writesOff: Scenario[] = [
  {
    id: "CL-08a",
    title: "control: with writes enabled, all four write kinds do work (so the refusals below are meaningful)",
    traces: ["ZT-01", "FR-12", "FR-13", "FR-15"],
    spec: ["ADR-014: writes may be fully built and tested against simulated targets"],
    async run(h) {
      for (const kind of h.kinds) {
        const { serverId, plan } = await setup(h, { production: true, kind });
        await approveOk(h, plan, { production: true });
        await h.settle();
        assert.equal((await h.target(serverId).mutations()).length, 1, `${kind}: must reach the simulated target when enabled`);
      }
    },
  },
  {
    id: "CL-08b",
    title: "writesEnabled false or absent: every kind of change is refused, creates no operation and reaches no server",
    traces: ["ZT-01", "invariant 11", "invariant 12", "FR-12", "FR-13", "FR-15"],
    spec: ["ADR-014: stay disabled for real servers behind a per-server writesEnabled=false flag", "absent must behave as false"],
    async run(h) {
      for (const flag of FLAGS) {
        for (const kind of h.kinds) {
          const server = await h.addServer({ name: uid("real"), production: true, writesEnabled: flag });
          const { plan } = await planOrFake(h, server.id, kind);
          assertRefused(await h.approve(approvalFor(plan, { production: true })), `${kind}, writesEnabled ${label(flag)}`);
          await h.settle();
          await assertNoWork(h, server.id, `${kind}, writesEnabled ${label(flag)}`);
        }
      }
    },
  },
  {
    id: "CL-08c",
    title: "a client cannot switch writes on: override fields in the body or headers are ignored",
    traces: ["ZT-01", "Tech §5 (derive authorization from server-side context)"],
    spec: ["Tech §5: do not trust submitted identifiers; authorization derives from installation context"],
    async run(h) {
      const server = await h.addServer({ name: uid("real"), production: true, writesEnabled: false });
      const { plan } = await planOrFake(h, server.id, "packages");
      const bodies: Record<string, unknown>[] = [
        { writesEnabled: true }, { writes_enabled: true }, { force: true }, { dryRun: false },
        { override: { writesEnabled: true } }, { server: { writesEnabled: true } },
      ];
      for (const extra of bodies) {
        assertRefused(await h.approve(approvalFor(plan, { production: true, extra })), `body ${JSON.stringify(extra)}`);
      }
      const headerSets: Record<string, string>[] = [{ "x-writes-enabled": "true" }, { "x-servrsit-force": "1" }];
      for (const extraHeaders of headerSets) {
        assertRefused(await h.approve(approvalFor(plan, { production: true, extraHeaders })), `headers ${JSON.stringify(extraHeaders)}`);
      }
      await h.settle();
      await assertNoWork(h, server.id, "client override attempts");
    },
  },
  {
    id: "CL-08d",
    title: "chat cannot approve: 'yes', 'do it' and similar create no operation, with writes on or off",
    traces: ["ZT-01", "NF-007", "FR-07", "FR-11", "invariant 1"],
    spec: ["FR-11: natural-language assent alone cannot bypass the authenticated approval control", "UX §9: chat assent opens the approval surface, it does not execute"],
    async run(h) {
      const phrases = ["yes", "do it", "approve", "go ahead and update the packages", "Yes, approve and run the update now"];
      for (const writes of [false, true]) {
        const server = await h.addServer({ name: uid("srv"), production: false, writesEnabled: writes });
        const { plan } = await planOrFake(h, server.id, "packages");
        for (const text of phrases) await h.assistant(text, { planId: plan.id, serverId: server.id });
        await h.settle();
        await assertNoWork(h, server.id, `assistant assent, writes ${writes}`);
      }
    },
  },
  {
    id: "CL-08e",
    title: "the gate is re-checked at dispatch: switching writes off after approval stops an unsent operation",
    traces: ["ZT-01", "invariant 12", "Tech §9.3"],
    spec: ["Tech §9.3: before sending a change, the worker re-checks revocation and policy", "ADR-014"],
    async run(h) {
      for (const flag of FLAGS) {
        const { serverId, plan } = await setup(h, { production: true });
        await h.pauseDispatch(true);
        const id = await approveOk(h, plan, { production: true });
        await h.setWritesEnabled(serverId, flag);
        await h.pauseDispatch(false);
        await h.settle();
        const o = await op(h, id);
        assert.ok(notExecuting(o.state), `writes ${label(flag)} at dispatch: the operation must not run (state ${o.state})`);
        assert.equal(await manifests(h, serverId), 0, `writes ${label(flag)}: no mutation request may be sent`);
        assert.deepEqual(await h.target(serverId).mutations(), []);
        await h.reconcile(id);
        await h.advance(MIN);
        await h.settle();
        assert.equal(await manifests(h, serverId), 0, "reconcile or later settling must not send it either");
      }
    },
  },
  {
    id: "CL-08f",
    title: "schedules, time and reconcile never write on a write-disabled server",
    traces: ["ZT-01", "FR-19", "Tech §14"],
    spec: ["FR-19: no schedule authorizes package installation, restart, reboot or cleanup", "Tech §13: reconcile never starts a mutation"],
    async run(h) {
      for (const flag of FLAGS) {
        const server = await h.addServer({ name: uid("real"), production: true, writesEnabled: flag });
        for (let i = 0; i < 5; i++) {
          await h.schedulerTick();
          await h.advance(6 * 60 * MIN);
          await h.settle();
        }
        assert.equal(await manifests(h, server.id), 0, `writes ${label(flag)}: schedules must never send a mutation`);
        assert.deepEqual(await h.target(server.id).mutations(), []);
        assert.equal(await opCount(h, [server.id]), 0);
      }
    },
  },
  {
    id: "CL-08g",
    title: "read-only inspection still works when writes are disabled (the gate is not a blanket lockout)",
    traces: ["ZT-01", "FR-05", "PRD §5.2 read-only operation"],
    spec: ["FR-03: a connection without elevated privilege can still provide supported inspection"],
    async run(h) {
      for (const flag of FLAGS) {
        const server = await h.addServer({ name: uid("real"), production: true, writesEnabled: flag });
        const r = await h.inspect(server.id);
        assert.equal(r.ok, true, `inspection must work with writes ${label(flag)} (got ${r.status} ${r.code})`);
        const kinds = new Set((await h.target(server.id).interactions()).map((i) => i.kind));
        assert.ok(!kinds.has("manifest"), "inspection must not send mutation requests");
      }
    },
  },
];

// ---------------------------------------------------------------------------
// CL-09  Stage A scope: every change kind the PRD requires exists  (FR-12, FR-13, FR-15)
// ---------------------------------------------------------------------------
const scope: Scenario[] = [
  {
    id: "CL-09a",
    title: "every Stage A change kind is implemented: packages, service restart, reboot, directory preparation",
    traces: ["FR-12", "FR-13", "FR-15"],
    spec: ["PRD §7.3 FR-12, FR-13, FR-15 are all priority A (required for founder alpha)"],
    async run(h) {
      const missing = KINDS.filter((k) => !h.kinds.includes(k));
      assert.deepEqual(missing, [], `not implemented: ${missing.join(", ")}`);
    },
  },
];

export const scenarios: readonly Scenario[] = [
  ...expiry, ...digest, ...dupes, ...changed, ...lostAck, ...unknown, ...stop, ...writesOff, ...scope,
];

export { PROD_ACKS };
