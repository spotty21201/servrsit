import { test } from "node:test";
import assert from "node:assert/strict";
import { createFixtureClient, fixturePlans } from "./fixtures";
import { toOperationVM, STOP_HELP } from "./operationViewModel";

const NOW = new Date("2026-11-17T03:00:00Z");
const TZ = "Asia/Jakarta";
const client = createFixtureClient(() => NOW);
const plan = fixturePlans(NOW)["fixture-plan-production"]!;

async function vm(id: string) {
  const r = await client.getOperation(id);
  assert.ok(r.ok);
  return toOperationVM(r.data, plan, NOW, TZ);
}

test("all eight states use the UX section 11 labels", async () => {
  const want: Record<string, string> = {
    "fixture-op-queued": "Waiting to start",
    "fixture-op-running": "Working on Fixture Timika",
    "fixture-op-verifying": "Checking the result",
    "fixture-op-succeeded": "Completed and verified",
    "fixture-op-partial": "Some work completed",
    "fixture-op-failed": "Could not complete",
    "fixture-op-cancelled": "Cancelled — no work started",
    "fixture-op-unknown": "Result not yet confirmed",
  };
  for (const [id, label] of Object.entries(want)) assert.equal((await vm(id)).stateLabel, label, id);
});

test("only 'succeeded' reads as success; verifying and unknown do not", async () => {
  assert.equal((await vm("fixture-op-verifying")).badge, "progress");
  assert.equal((await vm("fixture-op-verifying")).receipt, null);
  assert.equal((await vm("fixture-op-unknown")).badge, "unknown");
  assert.equal((await vm("fixture-op-succeeded")).badge, "passed");
  assert.doesNotMatch((await vm("fixture-op-verifying")).explanation, /complete(d)? and verified|succe/i);
});

test("steps carry real times in the owner zone; pending steps carry none", async () => {
  const run = await vm("fixture-op-running");
  assert.deepEqual(run.steps.map((s) => s.status), ["done", "done", "current", "pending", "pending"]);
  assert.match(run.steps[0]?.startedAt ?? "", /^\d\d:\d\d:\d\d$/);
  assert.equal(run.steps[3]?.startedAt, null);
  const done = await vm("fixture-op-succeeded");
  assert.deepEqual(done.steps.map((s) => s.status), ["done", "done", "done", "done", "done"]);
});

test("unknown outcome: sent/install/verify not confirmed, receipt says what is known so far, recheck offered", async () => {
  const u = await vm("fixture-op-unknown");
  assert.equal(u.steps[2]?.status, "unknown");
  assert.equal(u.steps[3]?.status, "unknown");
  assert.equal(u.recheck, true);
  assert.equal(u.receiptTitle, "What we know so far");
  assert.match(u.receipt?.stillNeeded[0] ?? "", /unavailable until it is confirmed/);
});

test("failed and cancelled: nothing changed, later steps not started", async () => {
  const f = await vm("fixture-op-failed");
  assert.equal(f.steps[1]?.status, "failed");
  assert.equal(f.steps[2]?.status, "not-started");
  assert.match(f.receipt?.changed[0] ?? "", /none: the target did not accept/);
  const c = await vm("fixture-op-cancelled");
  assert.equal(c.steps[1]?.status, "not-started");
});

test("receipt separates changed / verified / still needed / could not verify", async () => {
  const p = await vm("fixture-op-partial");
  assert.equal(p.receipt?.changed.length, 2);
  assert.equal(p.receipt?.verified[0], "2 of 3 packages match the plan.");
  assert.equal(p.receipt?.couldNotVerify.some((l) => l.startsWith("openssh-server:amd64")), true);
  const ok = await vm("fixture-op-succeeded");
  assert.equal(ok.receipt?.stillNeeded[0], "Nothing further for this operation.");
  assert.ok(ok.receipt?.couldNotVerify.some((l) => /services/.test(l)));
});

test("verified install with a reboot still needed says both in the title and the follow-up", async () => {
  const r = await vm("fixture-op-succeeded-reboot");
  assert.equal(r.headline, "Completed and verified. Reboot still needed.");
  assert.match(r.receipt?.stillNeeded[0] ?? "", /Reboot Fixture Timika/);
});

test("stop control is worded 'Stop after this safe step' and only shown while running", async () => {
  const run = await vm("fixture-op-running");
  assert.equal(run.stop.visible, true);
  assert.equal(run.stop.label, "Stop after this safe step");
  assert.equal(run.stop.help, STOP_HELP);
  assert.match(STOP_HELP, /not an undo/);
  assert.equal((await vm("fixture-op-running-stop")).stop.requested, true);
  assert.equal((await vm("fixture-op-succeeded")).stop.visible, false);
});

test("no percentages anywhere in the view model", async () => {
  for (const id of ["fixture-op-running", "fixture-op-verifying", "fixture-op-succeeded"]) {
    assert.doesNotMatch(JSON.stringify(await vm(id)), /\d\s?%/);
  }
});

test("transcript lines are timestamped event text with only known payload fields", async () => {
  const v = await vm("fixture-op-failed");
  assert.match(v.transcript[2]?.text ?? "", /^remote_rejected {2}queued -> failed {2}code=PACKAGE_LOCKED/);
  assert.match(v.transcript[0]?.time ?? "", /^\d\d:\d\d:\d\d$/);
});

async function vmFor(opId: string, planId: string) {
  const c = createFixtureClient(() => NOW);
  const r = await c.getOperation(opId);
  assert.ok(r.ok);
  return toOperationVM(r.data, fixturePlans(NOW)[planId]!, NOW, TZ);
}

test("a restart operation reads as a restart, verified by a new start time", async () => {
  const v = await vmFor("fixture-op-restart-succeeded", "fixture-plan-restart");
  assert.equal(v.title, "Restart nginx.service on Fixture Nabire");
  assert.equal(v.stateLabel, "Completed and verified");
  assert.equal(v.steps[2]?.title, "Restart the service");
  assert.equal(v.steps[3]?.title, "Check the service started again");
  assert.match(v.explanation, /start time is new/);
  assert.deepEqual(v.receipt?.changed, ["nginx.service restarted"]);
  assert.match(v.receipt?.couldNotVerify.join(" ") ?? "", /behaves correctly after it started/);
  assert.doesNotMatch(JSON.stringify(v.receipt), /reboot/i);
});

test("a running reboot says the server will not answer for a while; stop is offered as a request", async () => {
  const v = await vmFor("fixture-op-reboot-running", "fixture-plan-reboot");
  assert.equal(v.title, "Reboot Fixture Timika");
  assert.match(v.explanation, /rebooting and will not answer for a while/);
  assert.equal(v.stop.visible, true);
  assert.equal(v.stop.help, STOP_HELP);
});

test("a partly created set of directories lists what matched and what did not, with owner and mode", async () => {
  const v = await vmFor("fixture-op-dirs-partial", "fixture-plan-prepare");
  assert.equal(v.title, "Create directories on Fixture Dev-2");
  assert.equal(v.stateLabel, "Some work completed");
  assert.deepEqual(v.receipt?.changed, ["/srv/app (owner deploy:deploy, mode 0755)"]);
  assert.match(v.receipt?.couldNotVerify[0] ?? "", /\/srv\/backups\/app \(owner root:root, mode 0750\): it is missing or its owner, group or mode differs/);
  assert.equal(v.receipt?.verified[0], "1 of 2 directories match the plan.");
});

test("a queued operation can be cancelled before it starts; the fixture client says so", async () => {
  const c = createFixtureClient(() => NOW);
  const r = await c.getOperation("fixture-op-queued");
  assert.ok(r.ok);
  const queued = toOperationVM(r.data, plan, NOW, TZ);
  assert.equal(queued.stop.visible, true);
  assert.equal(queued.stop.label, "Cancel before it starts");
  const s = await c.requestStop("fixture-op-queued");
  assert.ok(s.ok && s.data.stop === "cancelled" && s.data.operation.state === "cancelled_before_start");
  const again = await c.requestStop("fixture-op-queued");
  assert.ok(again.ok && again.data.stop === "already-final");
  const run = await c.requestStop("fixture-op-running");
  assert.ok(run.ok && run.data.stop === "requested" && run.data.operation.stopRequested);
});

test("rechecking an unknown outcome in the fixture leaves it unknown, never resolved by the client", async () => {
  const c = createFixtureClient(() => NOW);
  const r = await c.reconcile("fixture-op-unknown");
  assert.ok(r.ok && r.data.operation.state === "outcome_unknown");
});
