/**
 * Shared harness for T-076 findings and T-077 activity: the real buildServer (live mode, owner session), real
 * FindingTracker, stores, routes and a real FleetService. Only the collector is replaced: it builds REAL
 * observations with the product's buildObservation from output this harness controls. Synthetic config, two fake
 * hosts. A process guard (installed on import) blocks every process, socket and DNS call.
 */
import childProcess from "node:child_process";
import dns from "node:dns";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import assert from "node:assert/strict";

export const attempts: string[] = [];
for (const n of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) (childProcess as any)[n] = (f: string) => { attempts.push(`child_process.${n}(${f})`); throw new Error("GUARD"); };
for (const n of ["connect", "createConnection"]) (net as any)[n] = (...a: unknown[]) => { attempts.push(`net.${n}(${String(a[0])})`); throw new Error("GUARD"); };
for (const n of ["lookup", "resolve"]) { (dns as any)[n] = (h: string) => { attempts.push(`dns.${n}(${h})`); throw new Error("GUARD"); }; (dns.promises as any)[n] = (h: string) => { attempts.push(`dns.promises.${n}(${h})`); throw new Error("GUARD"); }; }
syncBuiltinESMExports();

const { buildServer } = await import("../../../../apps/api/src/server.ts");
const { enrolOwner, setupTokenSink } = await import("../../../../apps/api/src/auth/testing.ts");
const { FleetService } = await import("../../../../apps/api/src/fleet/service.ts");
const { FleetConfigSchema } = await import("../../../../apps/api/src/fleet/config.ts");
const { buildObservation } = await import("../../../../packages/ssh/src/index.ts");
const { NORMAL, renderOutput } = await import("../../../../packages/ssh/src/collector.fixtures.ts");
const { SqliteAuthStore, SqliteServerStore, SqliteFindingStore, SqliteSettingsStore } = await import("../../../../packages/store/src/index.ts");
export const { FindingsResponseSchema, FindingRecordSchema, FindingsErrorSchema } = await import("../../../../packages/contracts/src/index.ts");

export const A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
const NONCE = "0123456789abcdef0123456789abcdef";
export type Mode = { kind: "ok"; srvPct?: number; failedUnit?: boolean | string; dfBroken?: boolean } | { kind: "unreachable" };
export const HOUR = 3_600_000, MIN = 60_000;

function df(srvPct: number): string {
  const used = Math.round(51474044 * srvPct / 100);
  return `Filesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/sda5        112947452   9572756  97591144       9% /\n/dev/sdb1         51474044  ${used}  ${51474044 - used}      ${srvPct}% /srv`;
}

export class World {
  secrets: string[] = []; role: string | null = null; lastHeaders: Record<string, unknown> = {};
  t = Date.parse("2026-02-10T03:00:00Z");
  mode: Record<string, Mode> = { [A]: { kind: "ok", srvPct: 40 }, [B]: { kind: "ok", srvPct: 40 } };
  collections = 0;
  app!: Awaited<ReturnType<typeof buildServer>>; owner!: { cookie: string; csrfToken: string };
  service!: InstanceType<typeof FleetService>;
  findingStore = new SqliteFindingStore({ path: ":memory:" }); settings = new SqliteSettingsStore({ path: ":memory:" });
  async start(mode: "live" | "fixture" = "live") {
    const config = FleetConfigSchema.parse({ healthIntervalMinutes: 15, ownerTimeZone: "Asia/Jakarta", registration: {},
      hosts: [A, B].map((id, i) => ({ id, name: i ? "Fixture Bravo" : "Fixture Alpha", role: this.role, production: i === 0, importantServices: [], collect: true, writesEnabled: false, access: "ssh", address: `100.64.1.${10 + i}`, port: 22, user: "servrsit" })) }); // the product's own schema applies its defaults
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
        else if (typeof m.failedUnit === "string") sections.failed = { rc: 0, body: `${m.failedUnit} loaded failed failed Planted unit` };
        return { ok: true, observation: buildObservation({ stdout: renderOutput(sections, NONCE), nonce: NONCE, source: "ssh", startedAt: at, collectedAt: at, durationMs: 50, outputTruncated: false }) } as never;
      },
    } as never);
    const sink = setupTokenSink(); const auth = new SqliteAuthStore({ path: ":memory:" });
    this.app = await buildServer({ config: config as never, mode, startChecks: false, ownerContextPath: null, logger: false, redactSecrets: this.secrets, fleetService: mode === "live" ? this.service : undefined,
      auth: { store: auth, onSetupToken: sink.onSetupToken }, servers: { store, now: () => new Date(this.t) }, findings: { store: this.findingStore, settings: this.settings, now: () => new Date(this.t) } } as never);
    this.owner = await enrolOwner(this.app as never, sink.token());
    if (mode === "live") { this.service.start(); await new Promise((r) => setTimeout(r, 20)); } // the real interval is 15 min and unref'd; ticks are driven by check()
  }
  /** One tick of the product's scheduler: a pass runs only while the scheduler's timer exists (pause clears it). */
  async check(): Promise<void> {
    if ((this.service as any).timer !== null) await (this.service as any).refreshAll();
    // The product records health checks via its own fleet service's onPassComplete hook, which an injected service lacks;
    // it also records before every read of the activity list, so read it here (same recorder; the hook wiring itself is not exercised).
    if (this.owner) await this.call("GET", "/api/activity?limit=1");
  }
  async advance(ms: number) { this.t += ms; }
  async call(method: "GET" | "POST", url: string, body?: unknown, o: { session?: boolean; csrf?: boolean } = {}) {
    const headers: Record<string, string> = {}; if (o.session !== false) headers["cookie"] = this.owner.cookie;
    if (method === "POST") { headers["origin"] = "http://127.0.0.1:5173"; if (o.csrf !== false && o.session !== false) headers["x-csrf-token"] = this.owner.csrfToken; }
    const r = await this.app.inject({ method, url, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
    this.lastHeaders = r.headers as Record<string, unknown>;
    let data: any; try { data = r.body ? JSON.parse(r.body) : undefined; } catch { data = undefined; } return { status: r.statusCode, data, raw: r.body };
  }
  async list(): Promise<any[]> { const r = await this.call("GET", "/api/findings"); assert.equal(r.status, 200, r.raw.slice(0, 200)); const p = FindingsResponseSchema.safeParse(r.data); assert.ok(p.success, `findings response breaks the contract: ${r.raw.slice(0, 200)}`); return r.data.findings; }
  async disk(server = A): Promise<any[]> { return (await this.list()).filter((f) => f.serverId === server && f.rule.startsWith("disk")); }
  async close() { await this.app.close(); }
}
export async function world(m: "live" | "fixture" | ((w: World) => void) = "live", setup: (w: World) => void = () => undefined) {
  if (typeof m === "function") { setup = m; m = "live"; } // world(setup) is allowed; the mode defaults to live
  const w = new World(); setup(w); await w.start(m); return w;
}
/** Two successive successful checks over the line (FR-20: sustained across two checks before it is a warning). */
export async function diskFinding(w: World, pct = 97): Promise<any> {
  w.mode[A] = { kind: "ok", srvPct: pct }; await w.check(); await w.advance(15 * MIN); await w.check();
  const d = await w.disk(); assert.equal(d.length, 1, `premise: one disk finding after two checks at ${pct}%, got ${d.length}`); return d[0];
}
export const post = (w: World, id: string, what: string, body?: unknown) => w.call("POST", `/api/findings/${id}/${what}`, body);

