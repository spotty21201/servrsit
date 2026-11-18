import { test } from "node:test";
import assert from "node:assert/strict";
import { createActivityClient } from "./activity";
import type { CsrfSource } from "./http";

const csrf: CsrfSource = { headers: async () => ({ "x-csrf-token": "tok" }) };
/** [FIXTURE DATA] Synthetic activity record and export. */
const RECORD = {
  id: "chk-1", type: "inspection", at: "2026-11-17T10:00:00.000Z", serverId: "00000000-0000-4000-8000-000000000e02", serverName: "Fixture A",
  production: false, simulated: false, title: "Health check", result: "succeeded", summary: "16 of 16 checks ran.", href: "/servers/00000000-0000-4000-8000-000000000e02",
};
const EXPORT = {
  id: "00000000-0000-4000-8000-000000000e09", format: "report", filename: "servrsit-activity-202611171000.txt", mime: "text/plain",
  createdAt: "2026-11-17T10:00:00.000Z", expiresAt: "2026-11-24T10:00:00.000Z", from: "2026-11-17T00:00:00.000Z", to: "2026-11-18T00:00:00.000Z",
  timeZone: "Asia/Jakarta", recordCount: 1, sizeBytes: 10, redaction: "x", downloadUrl: "/api/exports/00000000-0000-4000-8000-000000000e09/download",
};

function fake(respond: (url: string, init: RequestInit) => Response) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return respond(url, init); }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

test("list sends the filters as a query string and validates the records", async () => {
  const f = fake(() => json({ records: [RECORD], truncated: false }));
  const c = createActivityClient({ fetchImpl: f.fetchImpl, csrf });
  const r = await c.list({ type: "inspection", q: "disk space", server: undefined });
  assert.equal(r.ok && r.data.records[0]!.summary, "16 of 16 checks ran.");
  assert.equal(f.seen[0]!.url, "/api/activity?type=inspection&q=disk+space");
  const bad = createActivityClient({ fetchImpl: fake(() => json({ records: [{ ...RECORD, output: "raw" }], truncated: false })).fetchImpl, csrf });
  assert.deepEqual(await bad.list(), { ok: false, error: "INVALID_RESPONSE" }, "an extra field (for example raw output) is refused");
});

test("createExport posts filters (and the stub's records as ids); download fetches the file as text", async () => {
  const f = fake((url) => (url.endsWith("/download") ? new Response("ServrSit activity report\n", { status: 200 }) : json(EXPORT, 201)));
  const c = createActivityClient({ fetchImpl: f.fetchImpl, csrf });
  const req = { format: "report" as const, from: EXPORT.from, to: EXPORT.to, timeZone: "Asia/Jakarta" };
  const r = await c.createExport(req, [RECORD as never]);
  assert.equal(r.ok && r.data.downloadUrl, EXPORT.downloadUrl);
  assert.deepEqual(JSON.parse(String(f.seen[0]!.init.body)), { ...req, recordIds: ["chk-1"] });
  assert.equal((f.seen[0]!.init.headers as Record<string, string>)["x-csrf-token"], "tok");
  const d = await c.download(EXPORT as never);
  assert.deepEqual(d, { ok: true, data: { content: "ServrSit activity report\n", mime: "text/plain", filename: EXPORT.filename } });
});

test("an expired export is EXPIRED with the API's reason", async () => {
  const c = createActivityClient({ fetchImpl: fake(() => json({ error: "EXPIRED", reason: "This export has expired. Create a new one." }, 410)).fetchImpl, csrf });
  assert.deepEqual(await c.download(EXPORT as never), { ok: false, error: "EXPIRED", reason: "This export has expired. Create a new one." });
});
