import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettingsClient } from "./settings";
import type { CsrfSource } from "./http";

const csrf: CsrfSource = { headers: async () => ({ "x-csrf-token": "tok" }) };
/** [FIXTURE DATA] Synthetic settings. */
const DATA = {
  schedule: { intervalMinutes: 15, dailyTime: "03:00", dailyTimeInEffect: false, timeZone: "Asia/Jakarta", paused: false, pausedSince: null },
  ai: { enabled: false, available: false, providerLabel: "None.", route: "No external service.", region: null, sends: "x" },
  retention: { observationsDays: 30, operationRecordsDays: 90, exportsDays: 7 },
  servers: [{ id: "00000000-0000-4000-8000-00000000c001", name: "Fixture A", production: false, keyKind: "owner key", hostKeyConfirmedAt: null, connected: true }],
};

function fake(respond: (url: string, init: RequestInit) => Response) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return respond(url, init); }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

test("schedule, pause and AI calls use the contract paths, methods and bodies with CSRF", async () => {
  const f = fake(() => json(DATA));
  const c = createSettingsClient({ fetchImpl: f.fetchImpl, csrf });
  assert.equal((await c.get()).ok, true);
  await c.saveSchedule({ intervalMinutes: 30, dailyTime: "04:00", timeZone: "UTC" });
  await c.setPaused(true);
  await c.setAi(false);
  assert.deepEqual(f.seen.map((s) => `${s.init.method} ${s.url} ${s.init.body ?? ""}`), [
    "GET /api/settings ",
    'PUT /api/settings/schedule {"intervalMinutes":30,"dailyTime":"04:00","timeZone":"UTC"}',
    'POST /api/settings/schedule/pause {"paused":true}',
    'PUT /api/settings/ai {"enabled":false}',
  ]);
  assert.ok(f.seen.slice(1).every((s) => (s.init.headers as Record<string, string>)["x-csrf-token"] === "tok"));
});

test("errors come back as plain codes; a disconnect claiming remote removal is refused", async () => {
  const c1 = createSettingsClient({ fetchImpl: fake(() => json({ error: "NOT_ALLOWED", reason: "No AI provider is configured on ServrSit, so AI cannot be turned on here." }, 409)).fetchImpl, csrf });
  assert.deepEqual(await c1.setAi(true), { ok: false, error: "NOT_ALLOWED", reason: "No AI provider is configured on ServrSit, so AI cannot be turned on here." });
  const off = { serverId: DATA.servers[0]!.id, schedulesStopped: true, controllerKeyDeleted: false, remoteKeyRemoved: true, remoteSteps: ["x"], authorizedKeysLine: null };
  const c2 = createSettingsClient({ fetchImpl: fake(() => json(off)).fetchImpl, csrf });
  assert.deepEqual(await c2.disconnect(DATA.servers[0]!.id), { ok: false, error: "INVALID_RESPONSE" });
  const c3 = createSettingsClient({ fetchImpl: fake(() => json({ error: "STATE_CONFLICT", reason: "An operation on this server is not resolved yet. Disconnect after it is." }, 409)).fetchImpl, csrf });
  assert.equal((await c3.disconnect(DATA.servers[0]!.id) as { error?: string }).error, "STATE_CONFLICT");
});
