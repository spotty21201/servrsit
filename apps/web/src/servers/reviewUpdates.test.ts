import { test } from "node:test";
import assert from "node:assert/strict";
import type { CareResult, PlanView } from "../api/care";
import { createReviewRunner, reviewErrorText, type ReviewPhase } from "./reviewUpdates";

const PLAN = { id: "3f68be24-84a0-4337-ad6d-9098118d3323" } as PlanView;

function harness(answer: () => Promise<CareResult<PlanView>>) {
  const calls: string[] = [];
  const phases: ReviewPhase[] = [];
  const nav: string[] = [];
  const runner = createReviewRunner({
    client: { createPlan: (id) => { calls.push(id); return answer(); } },
    serverId: "srv-1", onPhase: (p) => phases.push(p), navigate: (p) => nav.push(p),
  });
  return { runner, calls, phases, nav };
}

test("click: asks for a plan for this server and opens it at /plans/:id", async () => {
  const h = harness(async () => ({ ok: true, data: PLAN }));
  await h.runner.run();
  assert.deepEqual(h.calls, ["srv-1"]);
  assert.deepEqual(h.nav, [`/plans/${PLAN.id}`]);
  assert.deepEqual(h.phases.map((p) => p.phase), ["pending"]);
});

test("pending: reported while the request is out, and a second click does nothing (no double submit)", async () => {
  let release!: (r: CareResult<PlanView>) => void;
  const h = harness(() => new Promise((r) => { release = r; }));
  const first = h.runner.run();
  assert.equal(h.runner.pending, true);
  await h.runner.run();
  await h.runner.run();
  assert.equal(h.calls.length, 1);
  release({ ok: true, data: PLAN });
  await first;
  assert.equal(h.nav.length, 1);
  assert.equal(h.runner.pending, false);
});

test("error: a fixed message is shown, nothing is opened, and the button works again", async () => {
  let n = 0;
  const h = harness(async () => (n++ === 0 ? { ok: false, kind: "http", status: 503, code: "ROUTE_UNAVAILABLE" } : { ok: true, data: PLAN }));
  await h.runner.run();
  const last = h.phases[h.phases.length - 1];
  assert.equal(last?.phase, "failed");
  assert.match(last?.phase === "failed" ? last.text : "", /could not reach the server to prepare the plan\. Nothing was changed on the server/);
  assert.deepEqual(h.nav, []);
  assert.equal(h.runner.pending, false);
  await h.runner.run();
  assert.equal(h.calls.length, 2);
  assert.equal(h.nav.length, 1);
});

test("a lost or unreadable answer says no plan was opened and nothing changed on the server", () => {
  for (const kind of ["network", "timeout", "invalid-response"] as const) {
    assert.match(reviewErrorText({ kind }), /no plan was opened\. Nothing was changed on the server/);
  }
  assert.match(reviewErrorText({ kind: "http", code: "UNAUTHENTICATED" }), /signed out/);
  assert.match(reviewErrorText({ kind: "http", code: "SOMETHING_NEW" }), /Nothing was changed on the server/);
});

test("an aborted request returns to idle without an error", async () => {
  const h = harness(async () => ({ ok: false, kind: "aborted" }));
  await h.runner.run();
  assert.equal(h.phases[h.phases.length - 1]?.phase, "idle");
});

test("a server that cannot be written to still gets a plan: the runner never looks at writes", async () => {
  // The API answers a plan whose blockers include WRITES_DISABLED; the runner just opens it.
  const blocked = { ...PLAN, blockers: [{ code: "WRITES_DISABLED", message: "x" }], approvable: false } as PlanView;
  const h = harness(async () => ({ ok: true, data: blocked }));
  await h.runner.run();
  assert.deepEqual(h.nav, [`/plans/${PLAN.id}`]);
});
