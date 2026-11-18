import { test } from "node:test";
import assert from "node:assert/strict";
import { createFindingsClient } from "./findings";
import type { CsrfSource } from "./http";

/** [FIXTURE DATA] A synthetic finding record. */
const RECORD = {
  id: "00000000-0000-4000-8000-000000000e01", serverId: "00000000-0000-4000-8000-000000000e02", serverName: "Fixture A", production: false,
  key: "disk:/", rule: "disk.usage.v1", severity: "warning", summary: "Disk space on / is at 88 %", state: "acknowledged",
  firstObservedAt: "2026-11-17T10:00:00.000Z", lastObservedAt: "2026-11-17T10:15:00.000Z", acknowledgedAt: "2026-11-17T10:16:00.000Z",
  snoozedUntil: null, resolvedAt: null, resolvedBy: null,
};
const csrf: CsrfSource = { headers: async () => ({ "x-csrf-token": "tok" }) };

function fake(respond: (url: string, init: RequestInit) => Response) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return respond(url, init); }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

test("acknowledge, snooze, pause and resume are CSRF-protected POSTs to the contract paths", async () => {
  const f = fake((url) => (url.startsWith("/api/scheduler") ? json({ status: "paused", since: "2026-11-17T10:00:00.000Z", reason: "You paused checks." }) : json(RECORD)));
  const c = createFindingsClient({ fetchImpl: f.fetchImpl, csrf });
  assert.equal((await c.acknowledge(RECORD.id)).ok, true);
  await c.snooze(RECORD.id, "1d");
  await c.pause();
  await c.resume();
  assert.deepEqual(f.seen.map((s) => `${s.init.method} ${s.url}`), [
    `POST /api/findings/${RECORD.id}/acknowledge`, `POST /api/findings/${RECORD.id}/snooze`, "POST /api/scheduler/pause", "POST /api/scheduler/resume",
  ]);
  assert.equal(f.seen[1]!.init.body, JSON.stringify({ for: "1d" }));
  assert.ok(f.seen.every((s) => (s.init.headers as Record<string, string>)["x-csrf-token"] === "tok"));
});

test("errors are the contract codes as plain strings; unexpected bodies are INVALID_RESPONSE", async () => {
  const c1 = createFindingsClient({ fetchImpl: fake(() => json({ error: "NOT_ALLOWED", reason: "A resolved finding cannot be acknowledged." }, 409)).fetchImpl, csrf });
  assert.deepEqual(await c1.acknowledge(RECORD.id), { ok: false, error: "NOT_ALLOWED", reason: "A resolved finding cannot be acknowledged." });
  const c2 = createFindingsClient({ fetchImpl: fake(() => json({ ...RECORD, state: "fixed" })).fetchImpl, csrf });
  assert.deepEqual(await c2.acknowledge(RECORD.id), { ok: false, error: "INVALID_RESPONSE" });
  const c3 = createFindingsClient({ fetchImpl: fake(() => json({ error: "UNAUTHENTICATED" }, 401)).fetchImpl, csrf });
  assert.deepEqual(await c3.list(), { ok: false, error: "UNAUTHENTICATED" });
  const c4 = createFindingsClient({ fetchImpl: (async () => { throw new TypeError("down"); }) as unknown as typeof fetch, csrf });
  assert.deepEqual(await c4.list(), { ok: false, error: "NETWORK" });
});

test("list validates the whole response, including the external-alerts statement", async () => {
  const body = { mode: "live", findings: [RECORD], scheduler: { status: "running", nextRunAt: null }, externalAlerts: { available: false, reason: "x" } };
  const c = createFindingsClient({ fetchImpl: fake(() => json(body)).fetchImpl, csrf });
  const r = await c.list();
  assert.equal(r.ok && r.data.findings[0]!.state, "acknowledged");
  const lying = createFindingsClient({ fetchImpl: fake(() => json({ ...body, externalAlerts: { available: true, reason: "x" } })).fetchImpl, csrf });
  assert.deepEqual(await lying.list(), { ok: false, error: "INVALID_RESPONSE" });
});
