import { test } from "node:test";
import assert from "node:assert/strict";
import { createBaselinesClient } from "./baselines";
import type { CsrfSource } from "./http";

const csrf: CsrfSource = { headers: async () => ({ "x-csrf-token": "tok" }) };
const B = "00000000-0000-4000-8000-00000000ba01";
const T = "00000000-0000-4000-8000-00000000ba02";
/** [FIXTURE DATA] A synthetic comparison. */
const CMP = {
  baselineId: B, version: 1, targetId: T, observedAt: "2026-11-17T10:00:00.000Z", source: "simulated",
  rows: [{ conventionId: "pkg:nginx", kind: "package", label: "nginx", expected: "version 1", found: "version 2", status: "different-by-design", reason: "Marked intentional on this server.", actionable: false, intentional: { reason: null, markedAt: "2026-11-17T10:00:00.000Z" } }],
};

function fake(respond: (url: string, init: RequestInit) => Response) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return respond(url, init); }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

test("mark and unmark go to the contract paths with CSRF and return the stub's row arrays", async () => {
  const f = fake(() => json(CMP));
  const c = createBaselinesClient({ fetchImpl: f.fetchImpl, csrf });
  const m = await c.markIntentional(B, T, "pkg:nginx", null);
  assert.equal(m.ok && m.data[0]!.status, "different-by-design");
  await c.unmarkIntentional(B, T, "dir:srv:app/releases");
  assert.deepEqual(f.seen.map((s) => `${s.init.method} ${s.url}`), [`PUT /api/baselines/${B}/exceptions`, `DELETE /api/baselines/${B}/exceptions/${T}/dir%3Asrv%3Aapp%2Freleases`]);
  assert.deepEqual(JSON.parse(String(f.seen[0]!.init.body)), { targetId: T, conventionId: "pkg:nginx", reason: null });
  assert.ok(f.seen.every((s) => (s.init.headers as Record<string, string>)["x-csrf-token"] === "tok"));
});

test("list wrappers are validated strictly; errors are the contract's codes", async () => {
  const c1 = createBaselinesClient({ fetchImpl: fake(() => json({ events: [{ at: "2026-11-17T10:00:00.000Z", text: "Version 1 saved." }] })).fetchImpl, csrf });
  assert.deepEqual(await c1.history(B, T), { ok: true, data: [{ at: "2026-11-17T10:00:00.000Z", text: "Version 1 saved." }] });
  const c2 = createBaselinesClient({ fetchImpl: fake(() => json({ events: [], extra: 1 })).fetchImpl, csrf });
  assert.deepEqual(await c2.history(B, T), { ok: false, error: "INVALID_RESPONSE" });
  const c3 = createBaselinesClient({ fetchImpl: fake(() => json({ error: "STALE_CANDIDATES", reason: "Load the reference server's candidates again before saving." }, 409)).fetchImpl, csrf });
  assert.deepEqual(await c3.saveBaseline({ name: "Web", referenceId: B, conventionIds: ["pkg:nginx"] }), {
    ok: false, error: "STALE_CANDIDATES", reason: "Load the reference server's candidates again before saving.",
  });
});

test("createSetupPlan returns the plan id and what was not included", async () => {
  const c = createBaselinesClient({ fetchImpl: fake(() => json({ planId: B, included: 2, notIncluded: [{ label: "nginx", reason: "r" }] }, 201)).fetchImpl, csrf });
  const r = await c.createSetupPlan(B, T);
  assert.deepEqual(r.ok && [r.data.planId, r.data.included, r.data.notIncluded.length], [B, 2, 1]);
});
