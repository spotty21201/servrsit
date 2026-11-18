/**
 * T-076 findings and scheduler through the API. Hosts are synthetic and the
 * collector is injected: nothing is contacted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollectionResult } from "@servrsit/ssh";
import { SqliteFindingStore, SqliteSettingsStore } from "@servrsit/store";
import { FleetConfigSchema } from "../fleet/config.js";
import { FleetService } from "../fleet/service.js";
import { makeObservation } from "../fleet/observation.fixtures.js";
import { signedInServer } from "../auth/testing.js";

const A = "11111111-1111-4111-a111-111111111111";
const config = FleetConfigSchema.parse({
  healthIntervalMinutes: 15,
  hosts: [{ id: A, name: "Alpha", access: "ssh", address: "alpha.example", port: 22, user: "u", role: null, production: true, collect: true }],
});

class Clock {
  t = new Date("2026-11-17T10:00:00.000Z").getTime();
  now = () => new Date(this.t);
  advance(ms: number) { this.t += ms; }
}

async function start(opts: { settingsPath?: string } = {}) {
  const clock = new Clock();
  let next: () => CollectionResult = () => ({ ok: true, observation: makeObservation({ collectedAt: clock.now().toISOString(), diskPercent: 97 }) });
  const service = new FleetService({
    config, knownHostsFile: "/x/known_hosts", pinChecker: async () => "pinned", now: clock.now,
    collector: async () => next(),
  });
  const store = new SqliteFindingStore({ path: ":memory:" });
  const settings = new SqliteSettingsStore({ path: opts.settingsPath ?? ":memory:" });
  const s = await signedInServer({ config, fleetService: service, startChecks: false, logger: false, findings: { store, settings, now: clock.now } });
  return {
    ...s, clock, service, store, settings,
    set: (f: () => CollectionResult) => { next = f; },
    list: async () => (await s.inject({ method: "GET", url: "/api/findings" })).json() as {
      mode: string; scheduler: { status: string }; externalAlerts: { available: boolean };
      findings: Array<{ id: string; key: string; state: string; rule: string; resolvedBy: string | null; firstObservedAt: string; lastObservedAt: string; serverName: string }>;
    },
  };
}

const disk = (h: Awaited<ReturnType<typeof start>>) => h.list().then((r) => r.findings.filter((f) => f.rule === "disk.usage.v1"));

test("a detection becomes one record; repeated detections update it; external alerts are stated as unavailable", async () => {
  const h = await start();
  try {
    await h.service.refreshAll();
    const first = await h.list();
    assert.equal(first.mode, "live");
    assert.deepEqual(first.externalAlerts.available, false);
    const d1 = first.findings.filter((f) => f.rule === "disk.usage.v1");
    assert.equal(d1.length, 1);
    assert.equal(d1[0]!.state, "new");
    assert.equal(d1[0]!.serverName, "Alpha");
    h.clock.advance(15 * 60_000);
    await h.service.refreshAll();
    const d2 = await disk(h);
    assert.equal(d2.length, 1, "same issue, same record");
    assert.equal(d2[0]!.id, d1[0]!.id);
    assert.equal(d2[0]!.firstObservedAt, d1[0]!.firstObservedAt);
    assert.equal(d2[0]!.lastObservedAt, "2026-11-17T10:15:00.000Z");
  } finally { await h.app.close(); }
});

test("acknowledge and snooze change attention only; resolution needs a check that covered the issue", async () => {
  const h = await start();
  try {
    await h.service.refreshAll();
    const [f] = await disk(h);
    const ack = await h.inject({ method: "POST", url: `/api/findings/${f!.id}/acknowledge` });
    assert.equal(ack.json().state, "acknowledged");
    const sn = await h.inject({ method: "POST", url: `/api/findings/${f!.id}/snooze`, payload: { for: "1h" } });
    assert.equal(sn.json().state, "snoozed");
    assert.equal(sn.json().snoozedUntil, "2026-11-17T11:00:00.000Z");
    assert.equal((await h.inject({ method: "POST", url: `/api/findings/${f!.id}/snooze`, payload: { for: "1y" } })).statusCode, 400);
    h.clock.advance(61 * 60_000);
    await h.service.refreshAll(); // still at 97 %
    assert.equal((await disk(h))[0]!.state, "acknowledged", "the snooze ran out; it is still not resolved");

    // The next check could not read filesystems: not evidence of recovery.
    h.set(() => {
      const o = makeObservation({ collectedAt: h.clock.now().toISOString() });
      return { ok: true, observation: { ...o, host: { ...o.host, filesystems: { status: "unavailable", reason: "x" } } } };
    });
    await h.service.refreshAll();
    assert.equal((await disk(h))[0]!.state, "not-rechecked");

    // A check that covered filesystems and did not show it resolves it, and says which check.
    h.clock.advance(15 * 60_000);
    h.set(() => ({ ok: true, observation: makeObservation({ collectedAt: h.clock.now().toISOString(), diskPercent: 10 }) }));
    await h.service.refreshAll();
    const [r] = await disk(h);
    assert.equal(r!.state, "resolved");
    assert.equal(r!.resolvedBy, `The check at ${h.clock.now().toISOString()} covered this and no longer showed it.`);
    const again = await h.inject({ method: "POST", url: `/api/findings/${f!.id}/acknowledge` });
    assert.deepEqual([again.statusCode, again.json().error], [409, "NOT_ALLOWED"]);
  } finally { await h.app.close(); }
});

test("a server whose checks fail leaves its findings not-rechecked, never resolved", async () => {
  const h = await start();
  try {
    await h.service.refreshAll();
    h.clock.advance(15 * 60_000);
    h.set(() => ({ ok: false, failure: { code: "ROUTE_UNAVAILABLE", message: "x" }, attemptedAt: h.clock.now().toISOString(), contacted: true }));
    await h.service.refreshAll();
    await h.service.refreshAll();
    const list = await h.list();
    const d = list.findings.find((f) => f.rule === "disk.usage.v1");
    assert.equal(d?.state, "not-rechecked");
    assert.equal(list.findings.some((f) => f.state === "resolved"), false);
    // Once it is reachable again, the unreachable finding resolves on the attempt; disk on the observation.
    h.clock.advance(15 * 60_000);
    h.set(() => ({ ok: true, observation: makeObservation({ collectedAt: h.clock.now().toISOString(), diskPercent: 10 }) }));
    await h.service.refreshAll();
    const after = await h.list();
    assert.ok(after.findings.filter((f) => f.rule === "connection.unreachable.v1").every((f) => f.state === "resolved"));
    assert.equal(after.findings.find((f) => f.rule === "disk.usage.v1")?.state, "resolved");
  } finally { await h.app.close(); }
});

test("pause and resume: persisted across restarts, resume runs a current check, nothing is replayed", async () => {
  const settingsPath = join(mkdtempSync(join(tmpdir(), "servrsit-sched-")), "settings.db");
  const h = await start({ settingsPath });
  let calls = 0;
  h.set(() => { calls++; return { ok: true, observation: makeObservation({ collectedAt: h.clock.now().toISOString() }) }; });
  try {
    assert.equal((await h.inject({ method: "GET", url: "/api/scheduler" })).json().status, "unavailable", "not started in this process");
    h.service.start();
    await h.service.refreshAll();
    assert.equal((await h.inject({ method: "GET", url: "/api/scheduler" })).json().status, "running");
    const paused = await h.inject({ method: "POST", url: "/api/scheduler/pause", payload: { reason: "Travelling" } });
    assert.deepEqual(paused.json(), { status: "paused", since: "2026-11-17T10:00:00.000Z", reason: "Travelling" });
    const before = calls;
    await h.service.refreshHost(A);
    assert.equal(calls, before, "a paused scheduler checks nothing");
  } finally { await h.app.close(); }

  const h2 = await start({ settingsPath });
  try {
    assert.equal((await h2.inject({ method: "GET", url: "/api/scheduler" })).json().status, "paused", "the pause survived a restart");
    h2.service.start();
    let runs = 0;
    h2.set(() => { runs++; return { ok: true, observation: makeObservation({ collectedAt: h2.clock.now().toISOString() }) }; });
    assert.equal(runs, 0, "start() while paused runs nothing");
    const resumed = await h2.inject({ method: "POST", url: "/api/scheduler/resume" });
    assert.equal(resumed.json().status, "running");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(runs, 1, "one current check, not a backlog");
    assert.deepEqual(h2.settings.history("scheduler.paused").map((c) => c.value === null ? "cleared" : "set"), ["set", "cleared"]);
  } finally { await h2.service.stop(); await h2.app.close(); }
});

test("routes need a session; POSTs need the CSRF token; unknown ids are 404", async () => {
  const h = await start();
  try {
    assert.equal((await h.app.inject({ method: "GET", url: "/api/findings" })).statusCode, 401);
    assert.equal((await h.app.inject({ method: "POST", url: "/api/scheduler/pause", headers: { cookie: h.owner.cookie } })).statusCode, 403);
    assert.equal((await h.inject({ method: "POST", url: "/api/findings/00000000-0000-4000-8000-000000000999/acknowledge" })).statusCode, 404);
    assert.equal((await h.inject({ method: "POST", url: "/api/findings/not-a-uuid/acknowledge" })).statusCode, 404);
  } finally { await h.app.close(); }
});

test("an unknown rule is never resolved by absence", async () => {
  const { FindingTracker } = await import("../findings/tracker.js");
  const store = new SqliteFindingStore({ path: ":memory:" });
  const server = (findings: Array<{ id: string; rule: string; severity: "warning"; summary: string }>) => ({
    mode: "live", servers: [{ id: A, name: "Alpha", production: false, status: "healthy", observedAt: "2026-11-17T10:00:00.000Z",
      latestAttempt: { at: "2026-11-17T10:00:00.000Z", succeeded: true }, coverage: { unavailable: [] }, findings }],
  }) as never;
  const t = new FindingTracker({ store, fleet: () => server([]), now: () => new Date("2026-11-17T10:00:00.000Z") });
  t.sync(server([{ id: "x", rule: "future.rule.v9", severity: "warning", summary: "s" }]));
  const listed = t.list(server([]));
  assert.equal(listed[0]?.state, "not-rechecked");
});
