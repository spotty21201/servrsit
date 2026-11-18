/**
 * T-076 findings and scheduler, tested from PRD FR-19/FR-20 and UX Spec 13.1/13.2. Harness: support/world.mts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { A, B, HOUR, MIN, World, attempts, diskFinding, post, world, FindingsErrorSchema, FindingRecordSchema } from "./support/world.mts";

// ===================================================================================== thresholds and dedup (FR-20)
test("FN-01 one check over the line is not yet a warning; two successive checks make a warning at 85% and critical at 95% (FR-20 defaults)", async () => {
  const w = await world();
  try {
    w.mode[A] = { kind: "ok", srvPct: 90 }; await w.check();
    const first = await w.disk(); assert.ok(first.every((f) => f.severity !== "warning" && f.severity !== "critical"), `a single check gave ${first.map((f) => f.severity)}`);
    await w.advance(15 * MIN); await w.check(); let d = await w.disk(); assert.equal(d.length, 1); assert.equal(d[0].severity, "warning");
    w.mode[A] = { kind: "ok", srvPct: 97 }; await w.advance(15 * MIN); await w.check(); await w.advance(15 * MIN); await w.check();
    d = await w.disk(); assert.equal(d.length, 1, "escalation created a second record"); assert.equal(d[0].severity, "critical");
  } finally { await w.close(); }
});

test("FN-02 DEDUP: ten repeated detections are one record; first/last observed times are kept and advanced", async () => {
  const w = await world();
  try {
    const f0 = await diskFinding(w);
    for (let i = 0; i < 10; i++) { await w.advance(15 * MIN); await w.check(); await w.list(); }
    const d = await w.disk(); assert.equal(d.length, 1, `${d.length} records for one issue`); assert.equal(d[0].id, f0.id, "the record id changed");
    assert.equal(d[0].firstObservedAt, f0.firstObservedAt); assert.ok(d[0].lastObservedAt > f0.lastObservedAt, "lastObservedAt did not move");
    assert.ok(FindingRecordSchema.safeParse(d[0]).success);
  } finally { await w.close(); }
});

test("FN-03 different issues stay separate: two mounts, two servers, and a failed unit are distinct records", async () => {
  const w = await world();
  try {
    w.mode[A] = { kind: "ok", srvPct: 97, failedUnit: true }; w.mode[B] = { kind: "ok", srvPct: 97 };
    await w.check(); await w.advance(15 * MIN); await w.check();
    const all = await w.list(); const keyed = new Set(all.map((f) => `${f.serverId}|${f.key}`));
    assert.equal(keyed.size, all.length, "two records share a server and key");
    assert.equal((await w.disk(A)).length, 1); assert.equal((await w.disk(B)).length, 1);
    assert.ok(all.some((f) => f.serverId === A && f.rule.startsWith("systemd")), "the failed unit has no record");
  } finally { await w.close(); }
});

// ===================================================================================== acknowledge and snooze (FR-20, UX 13.1)
test("FN-10 ACKNOWLEDGE is not resolution: the finding stays open, keeps being updated, and keeps its acknowledgement", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w); const r = await post(w, f.id, "acknowledge"); assert.equal(r.status, 200, r.raw);
    assert.equal(r.data.state, "acknowledged"); assert.equal(r.data.resolvedAt, null); assert.ok(r.data.acknowledgedAt);
    await w.advance(15 * MIN); await w.check(); const d = (await w.disk())[0];
    assert.equal(d.id, f.id); assert.equal(d.state, "acknowledged", `after the next detection the state is ${d.state}`); assert.equal(d.resolvedAt, null);
    assert.ok(d.lastObservedAt > f.lastObservedAt, "an acknowledged finding stopped being updated");
    const again = await post(w, f.id, "acknowledge"); assert.equal(again.status, 200, "acknowledging twice must be harmless");
  } finally { await w.close(); }
});

test("FN-11 SNOOZE is not resolution: snoozed until the chosen time, then back to its earlier state; only 1h/1d/1w accepted", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w);
    for (const bad of [{}, { for: "2h" }, { for: "" }, { for: 3600 }, { for: "1h", extra: 1 }, { until: "2030-01-01T00:00:00Z" }]) { const r = await post(w, f.id, "snooze", bad); assert.equal(r.status, 400, `snooze ${JSON.stringify(bad)} -> ${r.status}`); assert.ok(FindingsErrorSchema.safeParse(r.data).success); }
    const s = await post(w, f.id, "snooze", { for: "1h" }); assert.equal(s.status, 200, s.raw); assert.equal(s.data.state, "snoozed"); assert.equal(s.data.resolvedAt, null);
    assert.equal(Date.parse(s.data.snoozedUntil) - w.t, HOUR, "snoozedUntil is not one hour from now");
    await w.advance(30 * MIN); await w.check(); assert.equal((await w.disk())[0].state, "snoozed", "the next detection ended the snooze early");
    await w.advance(31 * MIN); await w.check(); const after = (await w.disk())[0]; assert.equal(after.state, "new", `after the snooze ended the state is ${after.state}`); assert.equal(after.id, f.id);
  } finally { await w.close(); }
});

test("FN-12 acknowledge and snooze on unknown or malformed ids are clean 4xx; on a resolved finding they are refused (NOT_ALLOWED)", async () => {
  const w = await world();
  try {
    for (const id of ["00000000-0000-4000-8000-000000000000", "x", "../x"]) for (const what of ["acknowledge", "snooze"]) { // very long ids: FN-12b
      const r = await post(w, encodeURIComponent(id), what, what === "snooze" ? { for: "1h" } : undefined);
      assert.ok(r.status >= 400 && r.status < 500, `${what} on ${id.slice(0, 12)}: ${r.status}`); assert.ok(!r.raw.includes("a".repeat(40)), `the refusal echoes the id: ${r.raw.slice(0, 160)}`);
    }
    const f = await diskFinding(w); w.mode[A] = { kind: "ok", srvPct: 40 }; await w.advance(15 * MIN); await w.check();
    assert.equal((await w.disk())[0].state, "resolved", "premise: resolved");
    for (const what of ["acknowledge", "snooze"]) { const r = await post(w, f.id, what, what === "snooze" ? { for: "1h" } : undefined); assert.equal(r.status, 409, `${what} a resolved finding: ${r.status}`); assert.equal(r.data.error, "NOT_ALLOWED"); }
  } finally { await w.close(); }
});

test("FN-12b a very long id gets the contract's error body and is not echoed (same framework behaviour as D-R1)", { todo: "reported: D-X2" }, async () => {
  const w = await world();
  try { const r = await post(w, "a".repeat(200), "acknowledge"); assert.ok(FindingsErrorSchema.safeParse(r.data).success, `body: ${r.raw.slice(0, 120)}`); assert.ok(!r.raw.includes("a".repeat(40)), "the refusal echoes the id"); } finally { await w.close(); }
});

// ===================================================================================== resolution needs evidence (UX 13.1)
test("FN-20 RESOLUTION NEEDS EVIDENCE: a fresh successful check that covered the disk and no longer shows it resolves the finding and says which check", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w); w.mode[A] = { kind: "ok", srvPct: 40 }; await w.advance(15 * MIN); const at = new Date(w.t).toISOString(); await w.check();
    const d = (await w.disk())[0]; assert.equal(d.id, f.id); assert.equal(d.state, "resolved"); assert.equal(d.resolvedAt, at, "resolvedAt is not the time of the recovering check");
    assert.ok(d.resolvedBy && d.resolvedBy.includes(at), `resolvedBy does not name the check: ${d.resolvedBy}`);
  } finally { await w.close(); }
});

test("FN-21 PREVIOUSLY DETECTED, NOT RECHECKED: when the server cannot be reached, the finding is not-rechecked, never resolved", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w); w.mode[A] = { kind: "unreachable" };
    for (let i = 0; i < 3; i++) { await w.advance(15 * MIN); await w.check(); }
    const d = (await w.list()).find((x) => x.id === f.id); assert.ok(d, "the finding disappeared while the server was unreachable");
    assert.equal(d.state, "not-rechecked", `state is ${d.state}`); assert.equal(d.resolvedAt, null); assert.equal(d.resolvedBy, null);
  } finally { await w.close(); }
});

test("FN-22 NOT RECHECKED when the covering check could not run (df failed) even though the server answered", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w); w.mode[A] = { kind: "ok", dfBroken: true }; await w.advance(15 * MIN); await w.check();
    const d = (await w.list()).find((x) => x.id === f.id)!; assert.equal(d.state, "not-rechecked", `a check with the disk section unavailable gave ${d.state}`); assert.equal(d.resolvedAt, null);
  } finally { await w.close(); }
});

test("FN-23 NOT RECHECKED when the data is stale: no check for hours does not resolve anything", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w); w.mode[A] = { kind: "ok", srvPct: 40 }; await w.advance(6 * HOUR); // no check runs
    const d = (await w.list()).find((x) => x.id === f.id)!; assert.notEqual(d.state, "resolved", "a finding resolved with no new check"); assert.equal(d.resolvedAt, null);
    console.log(`# FN-23 state after 6 h without a check: ${d.state}`);
  } finally { await w.close(); }
});

test("FN-24 a not-rechecked finding that is seen again returns to an open state on the SAME record; one that a later good check no longer shows resolves", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w); w.mode[A] = { kind: "unreachable" }; await w.advance(15 * MIN); await w.check();
    assert.equal((await w.list()).find((x) => x.id === f.id)!.state, "not-rechecked");
    w.mode[A] = { kind: "ok", srvPct: 97 }; await w.advance(15 * MIN); await w.check();
    const back = await w.disk(); assert.equal(back.length, 1, "seeing it again created a second record"); assert.equal(back[0].id, f.id); assert.ok(["new", "acknowledged"].includes(back[0].state), `state ${back[0].state}`);
    w.mode[A] = { kind: "unreachable" }; await w.advance(15 * MIN); await w.check(); w.mode[A] = { kind: "ok", srvPct: 40 }; await w.advance(15 * MIN); await w.check();
    assert.equal((await w.disk())[0].state, "resolved", "a not-rechecked finding that a good check no longer shows did not resolve");
  } finally { await w.close(); }
});

test("FN-25 a recurrence after resolution is a NEW record; the resolved one keeps its evidence and stays visible for a while", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w); w.mode[A] = { kind: "ok", srvPct: 40 }; await w.advance(15 * MIN); await w.check();
    const resolved = (await w.disk())[0]; assert.equal(resolved.state, "resolved");
    w.mode[A] = { kind: "ok", srvPct: 97 }; await w.advance(15 * MIN); await w.check(); await w.advance(15 * MIN); await w.check();
    const d = await w.disk(); const open = d.filter((x) => x.state !== "resolved"); const old = d.find((x) => x.id === f.id);
    assert.equal(open.length, 1, `${open.length} open disk records`); assert.notEqual(open[0].id, f.id, "the resolved record was reopened");
    assert.ok(old && old.state === "resolved" && old.resolvedBy === resolved.resolvedBy, "the resolved record lost its evidence");
    await w.advance(8 * 24 * HOUR); await w.check(); assert.ok(!(await w.disk()).some((x) => x.id === f.id), "a resolved record is still listed after 8 days (7-day window)");
  } finally { await w.close(); }
});

test("FN-26 acknowledging does not stop resolution, and resolution needs no acknowledgement", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w); await post(w, f.id, "acknowledge"); await post(w, f.id, "snooze", { for: "1w" });
    w.mode[A] = { kind: "ok", srvPct: 40 }; await w.advance(15 * MIN); await w.check();
    const d = (await w.disk())[0]; assert.equal(d.state, "resolved", `a snoozed, acknowledged finding did not resolve: ${d.state}`);
  } finally { await w.close(); }
});

test("FN-27 the unreachable finding appears after two failed scheduled checks and resolves only on a successful contact", async () => {
  const w = await world();
  try {
    await w.check(); w.mode[B] = { kind: "unreachable" }; await w.advance(15 * MIN); await w.check();
    const one = (await w.list()).filter((f) => f.serverId === B && f.rule.startsWith("connection")); assert.equal(one.length, 0, "one failed check already made an unreachable finding");
    await w.advance(15 * MIN); await w.check(); const two = (await w.list()).filter((f) => f.serverId === B && f.rule.startsWith("connection")); assert.equal(two.length, 1, "two failed checks made no unreachable finding");
    w.mode[B] = { kind: "ok", srvPct: 40 }; await w.advance(15 * MIN); await w.check();
    assert.equal((await w.list()).find((f) => f.id === two[0].id)!.state, "resolved");
  } finally { await w.close(); }
});

// ===================================================================================== scheduler (FR-19, UX 13.2) and Stage A alerts (FR-20)
test("FN-30 PAUSE is not an all-clear: no checks run, findings are not resolved, and the status says paused with the reason; RESUME runs one current check, no backlog", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w);
    const p = await w.call("POST", "/api/scheduler/pause", { reason: "maintenance window" }); assert.equal(p.status, 200, p.raw); assert.equal(p.data.status, "paused"); assert.equal(p.data.reason, "maintenance window");
    w.mode[A] = { kind: "ok", srvPct: 40 }; const before = w.collections;
    for (let i = 0; i < 8; i++) { await w.advance(15 * MIN); await w.check(); }
    assert.equal(w.collections, before, "checks ran while paused"); const d = (await w.list()).find((x) => x.id === f.id)!; assert.notEqual(d.state, "resolved", "a paused scheduler resolved a finding");
    const list = await w.call("GET", "/api/findings"); assert.equal(list.data.scheduler.status, "paused");
    const r = await w.call("POST", "/api/scheduler/resume"); assert.equal(r.status, 200, r.raw); await new Promise((res) => setTimeout(res, 50));
    const ran = w.collections - before; console.log(`# FN-30 checks run by resume after 2 h paused (8 missed): ${ran}`);
    assert.ok(ran >= 1 && ran <= 2, `resume ran ${ran} collections (one current check per server expected, no backlog of 8)`);
    for (const bad of [{ reason: "x".repeat(200) }, { reason: "<script>" }, { reason: 5 }, { other: 1 }]) assert.equal((await w.call("POST", "/api/scheduler/pause", bad)).status, 400, `pause ${JSON.stringify(bad).slice(0, 30)}`);
  } finally { await w.close(); }
});

test("FN-31 Stage A says plainly that external alerts are unavailable (FR-20)", async () => {
  const w = await world();
  try { const r = await w.call("GET", "/api/findings"); assert.equal(r.data.externalAlerts.available, false); assert.ok(r.data.externalAlerts.reason.length > 10); } finally { await w.close(); }
});

test("FN-32 every findings and scheduler route needs a session (401) and every POST a CSRF token (403)", async () => {
  const w = await world();
  try {
    const f = await diskFinding(w);
    for (const [m, u, b] of [["GET", "/api/findings"], ["GET", "/api/scheduler"], ["POST", `/api/findings/${f.id}/acknowledge`], ["POST", `/api/findings/${f.id}/snooze`, { for: "1h" }], ["POST", "/api/scheduler/pause", {}], ["POST", "/api/scheduler/resume"]] as const) {
      assert.equal((await w.call(m, u, b, { session: false })).status, 401, `${m} ${u} without a session`);
      if (m === "POST") assert.equal((await w.call(m, u, b, { csrf: false })).status, 403, `${m} ${u} without CSRF`);
    }
    assert.equal((await w.disk())[0].state, "new", "a refused request changed the finding");
  } finally { await w.close(); }
});

test("FN-33 summaries are the product's own text: no raw server output reaches a finding", async () => {
  const w = await world();
  try {
    w.mode[A] = { kind: "ok", srvPct: 97, failedUnit: true }; await w.check(); await w.advance(15 * MIN); await w.check();
    for (const f of await w.list()) assert.ok(!/<script>|\$\(|IGNORE ALL|BEGIN [A-Z ]*PRIVATE/i.test(f.summary), `summary carries hostile text: ${f.summary.slice(0, 80)}`);
  } finally { await w.close(); }
});

test("FN-34 fixture mode keeps [FIXTURE DATA] findings in memory only and reports the scheduler as unavailable", async () => {
  const w = await world("fixture");
  try {
    const r = await w.call("GET", "/api/findings"); assert.equal(r.status, 200); assert.equal(r.data.mode, "fixture"); assert.equal(r.data.scheduler.status, "unavailable");
    assert.equal(w.findingStore.list("1970-01-01T00:00:00.000Z").length, 0, "fixture findings were written to the persistent store");
  } finally { await w.close(); }
});

test("GUARD: no process, socket or DNS lookup was attempted", () => { assert.deepEqual(attempts, []); });
