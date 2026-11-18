/**
 * T-077 activity history and export, tested from PRD FR-18/FR-21 and UX Spec 14: activity defaults to meaningful
 * operations and findings; filters by server, result, period and type; search matches names, titles and ids but
 * never secret contents; export offers a readable report and JSON, states date range, time zone and redaction,
 * uses unambiguous timestamps, and is a persistent downloadable result. Harness: support/world.mts (real stores,
 * tracker and fleet service; controlled collector; synthetic hosts; process guard).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { A, B, HOUR, MIN, attempts, diskFinding, world, type World } from "./support/world.mts";

const { ActivityResponseSchema, ExportResultSchema, ExportListSchema, ActivityErrorSchema, REDACTION_STATEMENT } = await import("../../../packages/contracts/src/index.ts");
const SECRET = "sk-test-FAKE0123456789abcdefABCDEF"; // fake, shaped like an API key
const PLANTED_UNIT = `${SECRET}.service`;

async function activity(w: World, qs = ""): Promise<any[]> {
  const r = await w.call("GET", `/api/activity${qs}`); assert.equal(r.status, 200, `${qs}: ${r.raw.slice(0, 200)}`);
  assert.ok(ActivityResponseSchema.safeParse(r.data).success, `activity response breaks the contract: ${r.raw.slice(0, 200)}`); return r.data.records;
}
/** A day of history: a disk finding that opens and resolves, an unreachable server, a planted secret in a unit name. */
async function history(w: World): Promise<void> {
  w.mode[A] = { kind: "ok", srvPct: 97, failedUnit: PLANTED_UNIT }; await w.check(); await w.advance(15 * MIN); await w.check();
  w.mode[B] = { kind: "unreachable" }; await w.advance(15 * MIN); await w.check(); await w.advance(15 * MIN); await w.check();
  w.mode[A] = { kind: "ok", srvPct: 40 }; w.mode[B] = { kind: "ok", srvPct: 40 }; await w.advance(15 * MIN); await w.check();
}
const isoWithZone = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})\b/;

test("AC-01 findings give an 'opened' and a 'resolved' record; the resolved one says which check resolved it", async () => {
  const w = await world(); try {
    await diskFinding(w); w.mode[A] = { kind: "ok", srvPct: 40 }; await w.advance(15 * MIN); await w.check();
    const f = (await activity(w, "?type=finding")).filter((r) => r.serverId === A && /disk|\/srv/i.test(r.title + r.summary));
    assert.ok(f.length >= 2, `${f.length} finding records for one open/resolve cycle`);
    const resolved = f.find((r) => r.result === "succeeded" || /resolved/i.test(r.title + r.summary)); assert.ok(resolved, "no resolved record");
    assert.match(resolved!.summary, /check/i, "the resolved record does not say which check established recovery");
  } finally { await w.close(); }
});

test("AC-02 health checks are recorded with result and coverage, failures with fixed text; nothing from server output", async () => {
  const w = await world(); try {
    await history(w);
    const ins = await activity(w, "?type=inspection"); assert.ok(ins.length >= 6, `${ins.length} inspection records for 5 passes x 2 servers`);
    const failed = ins.filter((r) => r.serverId === B && r.result === "failed"); assert.ok(failed.length >= 2, "failed checks are missing");
    for (const r of failed) assert.ok(r.summary.length > 5 && !/stderr|ssh:|Permission denied/i.test(r.summary), `failure text looks raw: ${r.summary}`);
    const all = JSON.stringify(await activity(w)); assert.ok(!all.includes("Planted unit"), "server output text reached the activity list");
  } finally { await w.close(); }
});

test("AC-03 filters: type, server, result, period; limit; invalid filters are 400 with the contract's error body", async () => {
  const w = await world(); try {
    await history(w);
    for (const type of ["finding", "inspection"]) for (const r of await activity(w, `?type=${type}`)) assert.equal(r.type, type);
    for (const r of await activity(w, `?server=${B}`)) assert.equal(r.serverId, B);
    for (const r of await activity(w, "?result=failed")) assert.equal(r.result, "failed");
    const all = await activity(w); const mid = all.map((r) => r.at).sort()[Math.floor(all.length / 2)];
    for (const r of await activity(w, `?from=${encodeURIComponent(mid)}`)) assert.ok(r.at >= mid, `from= returned ${r.at} < ${mid}`);
    assert.equal((await activity(w, "?limit=2")).length, 2);
    for (const bad of ["?type=everything", "?server=not-a-uuid", "?result=great", "?from=yesterday", "?limit=0", "?limit=5000", "?unknown=1"]) {
      const r = await w.call("GET", `/api/activity${bad}`); assert.equal(r.status, 400, `${bad} -> ${r.status}`); assert.ok(ActivityErrorSchema.safeParse(r.data).success, `${bad}: ${r.raw.slice(0, 120)}`);
    }
  } finally { await w.close(); }
});

test("AC-04 search matches server names (any case) and a configured secret never appears in the list", async () => {
  const w = await world((x) => { x.secrets = [SECRET]; }); try {
    await history(w);
    for (const q of ["Bravo", "bravo"]) { const r = await activity(w, `?q=${q}`); assert.ok(r.length > 0 && r.every((x) => x.serverName === "Fixture Bravo" || /bravo/i.test(x.title + x.summary)), `search ${q}`); }
    assert.ok(!JSON.stringify(await activity(w)).includes(SECRET), "the secret appears in the activity list");
  } finally { await w.close(); }
});

test("AC-04b search never matches secret contents (UX 14): a configured secret's text finds nothing", { todo: "reported: D-AC1" }, async () => {
  const w = await world((x) => { x.secrets = [SECRET]; }); try {
    await history(w); const r = await activity(w, `?q=${encodeURIComponent(SECRET.slice(0, 20))}`);
    assert.equal(r.length, 0, `searching for the secret's text found ${r.length} record(s): a guess at a secret can be confirmed by search`);
  } finally { await w.close(); }
});

test("AC-04c search matches identifiers (UX 14): a server id and a record id find their records", { todo: "reported: D-AC2" }, async () => {
  const w = await world(); try {
    await history(w); const rec = (await activity(w)).find((r) => r.type === "finding")!;
    assert.ok((await activity(w, `?q=${B}`)).length > 0, "a full server id finds nothing"); assert.ok((await activity(w, `?q=${encodeURIComponent(rec.id)}`)).some((r) => r.id === rec.id), "a record id finds nothing");
  } finally { await w.close(); }
});

test("AC-05 EXPORT (report and JSON): states range, time zone and redaction; unambiguous timestamps; secrets scrubbed; persistent and downloadable", async () => {
  const w = await world((x) => { x.secrets = [SECRET]; }); try {
    await history(w); const from = new Date(w.t - 2 * HOUR).toISOString(), to = new Date(w.t + MIN).toISOString();
    for (const format of ["report", "json"] as const) {
      const c = await w.call("POST", "/api/exports", { format, from, to, timeZone: "Asia/Jakarta" }); assert.equal(c.status, 201, c.raw.slice(0, 200));
      assert.ok(ExportResultSchema.safeParse(c.data).success, `export result breaks the contract: ${c.raw.slice(0, 200)}`);
      assert.equal(c.data.redaction, REDACTION_STATEMENT); assert.equal(c.data.timeZone, "Asia/Jakarta"); assert.ok(c.data.recordCount > 0);
      assert.equal(Date.parse(c.data.expiresAt) - Date.parse(c.data.createdAt), 7 * 24 * HOUR, "exports do not last 7 days");
      const d = await w.call("GET", c.data.downloadUrl); assert.equal(d.status, 200);
      assert.match(String(w.lastHeaders["content-disposition"] ?? ""), /attachment/i, "not delivered as a download"); assert.match(String(w.lastHeaders["content-type"] ?? ""), format === "json" ? /json/ : /text\/plain/);
      const body = d.raw; assert.ok(!body.includes(SECRET), `the ${format} export contains the planted secret`);
      assert.ok(body.includes("Asia/Jakarta"), `the ${format} export does not state its time zone`); assert.ok(/redact/i.test(body), `the ${format} export does not state redaction`);
      assert.ok(isoWithZone.test(body), `the ${format} export has no timestamp with an explicit offset`);
      if (format === "json") { const j = JSON.parse(body); assert.ok(j, "JSON export does not parse"); }
    }
    const list = await w.call("GET", "/api/exports"); assert.ok(ExportListSchema.safeParse(list.data).success); assert.equal(list.data.exports.length, 2, "exports are not listed persistently");
  } finally { await w.close(); }
});

test("AC-06 an export expires after 7 days: download is 410 and it leaves the list; it is never edited", async () => {
  const w = await world(); try {
    await history(w); const c = await w.call("POST", "/api/exports", { format: "json", from: new Date(w.t - 2 * HOUR).toISOString(), to: new Date(w.t + MIN).toISOString(), timeZone: "UTC" });
    const first = (await w.call("GET", c.data.downloadUrl)).raw;
    await w.advance(2 * HOUR); await w.check(); assert.equal((await w.call("GET", c.data.downloadUrl)).raw, first, "the stored export changed when new activity arrived");
    await w.advance(7 * 24 * HOUR); const gone = await w.call("GET", c.data.downloadUrl); assert.equal(gone.status, 410, `expired download: ${gone.status}`); assert.equal(gone.data?.error, "EXPIRED");
    assert.equal((await w.call("GET", "/api/exports")).data.exports.length, 0, "an expired export is still listed");
  } finally { await w.close(); }
});

test("AC-07 export requests are validated: bad zone, reversed range, unknown format or fields are 400; unknown download id 404", async () => {
  const w = await world(); try {
    const base = { format: "json", from: new Date(w.t - HOUR).toISOString(), to: new Date(w.t).toISOString(), timeZone: "UTC" };
    for (const bad of [{ ...base, timeZone: "Mars/Olympus" }, { ...base, from: base.to, to: base.from }, { ...base, format: "pdf" }, { ...base, extra: 1 }, { ...base, from: "yesterday" }]) {
      const r = await w.call("POST", "/api/exports", bad); assert.equal(r.status, 400, `${JSON.stringify(bad).slice(0, 80)} -> ${r.status}`);
    }
    const r = await w.call("GET", "/api/exports/00000000-0000-4000-8000-000000000000/download"); assert.equal(r.status, 404);
  } finally { await w.close(); }
});

test("AC-08 every activity and export route needs a session; POST /api/exports also CSRF", async () => {
  const w = await world(); try {
    for (const [m, u, b] of [["GET", "/api/activity"], ["GET", "/api/exports"], ["GET", "/api/exports/00000000-0000-4000-8000-000000000000/download"], ["POST", "/api/exports", { format: "json", from: new Date(w.t - HOUR).toISOString(), to: new Date(w.t).toISOString(), timeZone: "UTC" }]] as const) {
      assert.equal((await w.call(m, u, b, { session: false })).status, 401, `${m} ${u}`);
      if (m === "POST") assert.equal((await w.call(m, u, b, { csrf: false })).status, 403, `${m} ${u} without CSRF`);
    }
  } finally { await w.close(); }
});

test("AC-09 retention: inspection records older than 30 days are pruned; finding records are kept for the 90-day window", async () => {
  const w = await world(); try {
    await history(w); const before = await activity(w); await w.advance(31 * 24 * HOUR); await w.check();
    const after = await activity(w); const oldIns = after.filter((r) => r.type === "inspection" && Date.parse(r.at) < w.t - 30 * 24 * HOUR);
    assert.equal(oldIns.length, 0, `${oldIns.length} inspection records older than 30 days are still listed`);
    assert.ok(after.some((r) => r.type === "finding" && before.some((b) => b.id === r.id)), "finding records were dropped before 90 days");
  } finally { await w.close(); }
});

test("GUARD (activity): no process, socket or DNS lookup was attempted", () => { assert.deepEqual(attempts, []); });
void B;
