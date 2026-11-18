/**
 * T-076 findings and scheduler, tested from PRD FR-19/FR-20 and UX Spec 13.1/13.2. Written from the spec; the
 * contract (packages/contracts/src/findings.ts) supplies paths and shapes only.
 *
 * Harness: the real buildServer (live mode, T-053 owner session), the real FindingTracker, stores and routes, and a
 * real FleetService. Only the collector is replaced: it builds REAL observations with the product's own
 * buildObservation from output I control (disk %, failed units, a check that cannot run, or no connection).
 * Synthetic config: two fake hosts, no real server. A process guard blocks every process, socket and DNS call.
 */
import childProcess from "node:child_process";
import dns from "node:dns";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const attempts: string[] = [];
for (const n of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) (childProcess as any)[n] = (f: string) => { attempts.push(`child_process.${n}(${f})`); throw new Error("GUARD"); };
for (const n of ["connect", "createConnection"]) (net as any)[n] = (...a: unknown[]) => { attempts.push(`net.${n}(${String(a[0])})`); throw new Error("GUARD"); };
for (const n of ["lookup", "resolve"]) { (dns as any)[n] = (h: string) => { attempts.push(`dns.${n}(${h})`); throw new Error("GUARD"); }; (dns.promises as any)[n] = (h: string) => { attempts.push(`dns.promises.${n}(${h})`); throw new Error("GUARD"); }; }
syncBuiltinESMExports();

const { buildServer } = await import("../../../apps/api/src/server.ts");
const { enrolOwner, setupTokenSink } = await import("../../../apps/api/src/auth/testing.ts");
const { FleetService } = await import("../../../apps/api/src/fleet/service.ts");
const { FleetConfigSchema } = await import("../../../apps/api/src/fleet/config.ts");
const { buildObservation } = await import("../../../packages/ssh/src/index.ts");
const { NORMAL, renderOutput } = await import("../../../packages/ssh/src/collector.fixtures.ts");
const { SqliteAuthStore, SqliteServerStore, SqliteFindingStore, SqliteSettingsStore } = await import("../../../packages/store/src/index.ts");
const { FindingsResponseSchema, FindingRecordSchema, FindingsErrorSchema } = await import("../../../packages/contracts/src/index.ts");

const A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
const NONCE = "0123456789abcdef0123456789abcdef";
type Mode = { kind: "ok"; srvPct?: number; failedUnit?: boolean; dfBroken?: boolean } | { kind: "unreachable" };
const HOUR = 3_600_000, MIN = 60_000;

function df(srvPct: number): string {
  const used = Math.round(51474044 * srvPct / 100);
  return `Filesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/sda5        112947452   9572756  97591144       9% /\n/dev/sdb1         51474044  ${used}  ${51474044 - used}      ${srvPct}% /srv`;
}

class World {
  t = Date.parse("2026-02-10T03:00:00Z");
  mode: Record<string, Mode> = { [A]: { kind: "ok", srvPct: 40 }, [B]: { kind: "ok", srvPct: 40 } };
  collections = 0;
  app!: Awaited<ReturnType<typeof buildServer>>; owner!: { cookie: string; csrfToken: string };
  service!: InstanceType<typeof FleetService>;
  findingStore = new SqliteFindingStore({ path: ":memory:" }); settings = new SqliteSettingsStore({ path: ":memory:" });
  async start(mode: "live" | "fixture" = "live") {
    const config = FleetConfigSchema.parse({ healthIntervalMinutes: 15, ownerTimeZone: "Asia/Jakarta", registration: {},
      hosts: [A, B].map((id, i) => ({ id, name: i ? "Fixture Bravo" : "Fixture Alpha", role: null, production: i === 0, importantServices: [], collect: true, writesEnabled: false, access: "ssh", address: `100.64.1.${10 + i}`, port: 22, user: "servrsit" })) }); // the product's own schema applies its defaults
    const store = new SqliteServerStore({ path: ":memory:" });
    this.service = new FleetService({
      config: config as never, knownHostsFile: "/nonexistent/known_hosts", now: () => new Date(this.t),
      hosts: () => store.listActive().map((s: any) => ({ id: s.id, name: s.name, role: s.role, production: s.production, importantServices: [], collect: true, writesEnabled: false, access: "ssh", address: s.address, port: s.port, user: s.user })) as never,
      pinChecker: async () => "pinned",
      collector: async (host: any) => {
        this.collections++; const m = this.mode[host.id]!; const at = new Date(this.t);
        if (m.kind === "unreachable") return { ok: false, failure: { code: "ROUTE_UNAVAILABLE", message: "The host could not be reached." }, attemptedAt: at.toISOString(), contacted: true } as never;
        const sections: any = { ...NORMAL, df: { rc: m.dfBroken ? 1 : 0, body: m.dfBroken ? "" : df(m.srvPct ?? 40) } };
        if (!m.failedUnit) sections.failed = { rc: 0, body: "" };
        return { ok: true, observation: buildObservation({ stdout: renderOutput(sections, NONCE), nonce: NONCE, source: "ssh", startedAt: at, collectedAt: at, durationMs: 50, outputTruncated: false }) } as never;
      },
    } as never);
    const sink = setupTokenSink(); const auth = new SqliteAuthStore({ path: ":memory:" });
    this.app = await buildServer({ config: config as never, mode, startChecks: false, ownerContextPath: null, logger: false, fleetService: mode === "live" ? this.service : undefined,
      auth: { store: auth, onSetupToken: sink.onSetupToken }, servers: { store, now: () => new Date(this.t) }, findings: { store: this.findingStore, settings: this.settings, now: () => new Date(this.t) } } as never);
    this.owner = await enrolOwner(this.app as never, sink.token());
    if (mode === "live") { this.service.start(); await new Promise((r) => setTimeout(r, 20)); } // the real interval is 15 min and unref'd; ticks are driven by check()
  }
  /** One tick of the product's scheduler: a pass runs only while the scheduler's timer exists (pause clears it). */
  async check(): Promise<void> { if ((this.service as any).timer !== null) await (this.service as any).refreshAll(); }
  async advance(ms: number) { this.t += ms; }
  async call(method: "GET" | "POST", url: string, body?: unknown, o: { session?: boolean; csrf?: boolean } = {}) {
    const headers: Record<string, string> = {}; if (o.session !== false) headers["cookie"] = this.owner.cookie;
    if (method === "POST") { headers["origin"] = "http://127.0.0.1:5173"; if (o.csrf !== false && o.session !== false) headers["x-csrf-token"] = this.owner.csrfToken; }
    const r = await this.app.inject({ method, url, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
    let data: any; try { data = r.body ? JSON.parse(r.body) : undefined; } catch { data = undefined; } return { status: r.statusCode, data, raw: r.body };
  }
  async list(): Promise<any[]> { const r = await this.call("GET", "/api/findings"); assert.equal(r.status, 200, r.raw.slice(0, 200)); const p = FindingsResponseSchema.safeParse(r.data); assert.ok(p.success, `findings response breaks the contract: ${r.raw.slice(0, 200)}`); return r.data.findings; }
  async disk(server = A): Promise<any[]> { return (await this.list()).filter((f) => f.serverId === server && f.rule.startsWith("disk")); }
  async close() { await this.app.close(); }
}
async function world(m: "live" | "fixture" = "live") { const w = new World(); await w.start(m); return w; }
/** Two successive successful checks over the line (FR-20: sustained across two checks before it is a warning). */
async function diskFinding(w: World, pct = 97): Promise<any> {
  w.mode[A] = { kind: "ok", srvPct: pct }; await w.check(); await w.advance(15 * MIN); await w.check();
  const d = await w.disk(); assert.equal(d.length, 1, `premise: one disk finding after two checks at ${pct}%, got ${d.length}`); return d[0];
}
const post = (w: World, id: string, what: string, body?: unknown) => w.call("POST", `/api/findings/${id}/${what}`, body);

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
