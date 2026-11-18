import { test } from "node:test";
import assert from "node:assert/strict";
import { SNOOZE_MS } from "@servrsit/contracts";
import { createFixtureFindingsClient } from "../fixtures/findingsFixture";
import { actionErrorText, schedulerFromFleet, schedulerNotice, sortFindings, summarise, toFindingVM } from "./findingsViewModel";

const NOW = new Date("2026-11-17T03:00:00Z"); // 10:00 WIB
const TZ = "Asia/Jakarta";
const fixed = () => NOW;

async function vms(scheduler: "running" | "paused" | "delayed" | "unavailable" = "running") {
  const c = createFixtureFindingsClient(fixed, () => scheduler);
  const r = await c.list();
  assert.ok(r.ok);
  return { c, snap: r.data, list: r.data.findings.map((f) => toFindingVM(f, NOW, TZ)) };
}

test("five states, with the wording the spec asks for", async () => {
  const { list } = await vms();
  const by = Object.fromEntries(list.map((f) => [f.state, f]));
  assert.equal(by["new"]?.stateLabel, "New");
  assert.equal(by["acknowledged"]?.stateLabel, "Acknowledged");
  assert.equal(by["snoozed"]?.stateLabel, "Snoozed");
  assert.equal(by["resolved"]?.stateLabel, "Resolved");
  assert.equal(by["not-rechecked"]?.stateLabel, "Previously detected, not rechecked");
  assert.match(by["acknowledged"]?.stateNote ?? "", /Acknowledged is not resolved/);
  assert.match(by["snoozed"]?.stateNote ?? "", /only delays notifications\. It is not resolved/);
  assert.match(by["not-rechecked"]?.stateNote ?? "", /not resolved/);
  assert.doesNotMatch(by["not-rechecked"]?.stateLabel ?? "", /^Resolved/);
});

test("first and last observed carry owner-zone times with ages", async () => {
  const { list } = await vms();
  const f1 = list.find((f) => f.id === "f1");
  assert.match(f1?.firstObserved ?? "", /^First seen 14 Nov \d\d:\d\d WIB$/);
  assert.equal(f1?.lastObserved, "Last seen 09:56 WIB (4 min ago)");
});

test("resolved shows the observation that established recovery", async () => {
  const { list } = await vms();
  assert.match(list.find((f) => f.id === "f5")?.stateNote ?? "", /^The check at 09:15 found memory at 61 %/);
});

test("Acknowledge and Snooze are separate actions with separate availability", async () => {
  const { list } = await vms();
  const g = (id: string) => list.find((f) => f.id === id)!;
  assert.deepEqual([g("f1").canAcknowledge, g("f1").canSnooze], [true, true]);   // new
  assert.deepEqual([g("f3").canAcknowledge, g("f3").canSnooze], [false, true]);  // acknowledged
  assert.deepEqual([g("f4").canAcknowledge, g("f4").canSnooze], [false, true]);  // snoozed
  assert.deepEqual([g("f5").canAcknowledge, g("f5").canSnooze], [false, false]); // resolved
  assert.deepEqual([g("f6").canAcknowledge, g("f6").canSnooze], [false, false]); // not rechecked
});

test("fixture client: acknowledge does not resolve, snooze does not acknowledge, 1 h / 1 day / 1 week", async () => {
  const { c } = await vms();
  const a = await c.acknowledge("f1");
  assert.ok(a.ok && a.data.state === "acknowledged" && a.data.resolvedAt === null && a.data.resolvedBy === null);
  const s = await c.snooze("f2", "1d");
  assert.ok(s.ok && s.data.state === "snoozed" && s.data.acknowledgedAt === null);
  assert.equal(Date.parse(s.data.snoozedUntil!) - NOW.getTime(), SNOOZE_MS["1d"]);
  assert.equal(SNOOZE_MS["1h"], 3_600_000);
  assert.equal(SNOOZE_MS["1w"], 7 * 86_400_000);
  const ackSnoozed = await c.acknowledge("f4");
  assert.ok(ackSnoozed.ok && ackSnoozed.data.state === "snoozed"); // still snoozed, not changed by acknowledge
  assert.deepEqual(await c.acknowledge("f5"), { ok: false, error: "NOT_ALLOWED" });
  assert.deepEqual(await c.snooze("f6", "1h"), { ok: false, error: "NOT_ALLOWED" });
  assert.deepEqual(await c.acknowledge("nope"), { ok: false, error: "NOT_FOUND" });
});

test("active findings sort first, then by severity; the summary never claims an all-clear it cannot back", async () => {
  const { list } = await vms();
  const sorted = sortFindings(list);
  assert.deepEqual(sorted.map((f) => f.id), ["f1", "f3", "f2", "f4", "f6", "f5"]);
  assert.equal(summarise(list).text, "4 open findings, 2 new.");
  assert.equal(summarise([]).text, "No open findings from the checks that ran.");
});

test("scheduler states: exact titles, never an all-clear", async () => {
  const { snap: paused } = await vms("paused");
  const p = schedulerNotice(paused.scheduler, NOW, TZ);
  assert.equal(p?.title, "Checks paused");
  assert.match(p?.text ?? "", /not an all-clear/);
  assert.equal(schedulerNotice((await vms("delayed")).snap.scheduler, NOW, TZ)?.title, "Check delayed");
  const u = schedulerNotice((await vms("unavailable")).snap.scheduler, NOW, TZ);
  assert.equal(u?.title, "Scheduler unavailable");
  assert.equal(u?.tone, "failed");
  assert.equal(schedulerNotice((await vms("running")).snap.scheduler, NOW, TZ), null);
  assert.equal(schedulerNotice(null, NOW, TZ), null);
});

test("a real overdue next check from /api/fleet reads 'Check delayed'; on time or unknown does not", () => {
  assert.equal(schedulerFromFleet({ nextCheckAt: "2026-11-17T02:50:00Z" }, NOW)?.status, "delayed");
  assert.equal(schedulerFromFleet({ nextCheckAt: "2026-11-17T02:59:00Z" }, NOW)?.status, "running"); // within grace
  assert.equal(schedulerFromFleet({ nextCheckAt: "2026-11-17T03:10:00Z" }, NOW)?.status, "running");
  assert.equal(schedulerFromFleet({ nextCheckAt: null }, NOW), null);
  assert.equal(schedulerFromFleet(null, NOW), null);
});

test("ServrSit's own clock untrusted: ages carry ≈", async () => {
  const { snap } = await vms();
  assert.match(toFindingVM(snap.findings[0]!, NOW, TZ, true).lastObserved, /≈ 4 min ago/);
});

test("a lost answer never says nothing was changed", () => {
  for (const code of ["NETWORK", "TIMEOUT", "INVALID_RESPONSE"] as const) {
    assert.match(actionErrorText(code), /may or may not/);
    assert.doesNotMatch(actionErrorText(code), /Nothing was changed/);
  }
  assert.match(actionErrorText("UNAVAILABLE"), /Nothing was changed/);
  assert.match(actionErrorText("NOT_ALLOWED"), /resolved or not-rechecked/);
});

test("the fixture client reports fixture mode, no external alerts, and can pause and resume", async () => {
  let state = "running" as "running" | "paused";
  const c = createFixtureFindingsClient(fixed, () => state, (n) => { state = n as typeof state; });
  const r = await c.list();
  assert.ok(r.ok && r.data.mode === "fixture" && r.data.externalAlerts.available === false);
  const p = await c.pause();
  assert.ok(p.ok && p.data.status === "paused" && (state as string) === "paused");
  const q = await c.resume();
  assert.ok(q.ok && q.data.status === "running" && (state as string) === "running");
});
