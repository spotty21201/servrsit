/**
 * ZT-01 on the REAL host wiring: buildServer() with the shipped hosts.json
 * (Sentani, Nabire, Timika, Merauke), no simulated servers, the real care routes,
 * the real SshWriteTarget. Sources: ADR-014, execution-security invariants 11-12.
 *
 * Safety: nothing here can reach a machine. fastify.inject() opens no socket,
 * the fleet collector is not started, the pinned known_hosts file is empty, and a
 * guard makes ANY process spawn, socket connect, TLS connect or DNS lookup throw
 * and be counted. The final test requires that count to be zero.
 *
 *   cd apps/api && pnpm exec tsx --test --test-reporter=spec ../../tests/e2e/care-loop/zt01-real-hosts.test.mts
 */
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import dns from "node:dns";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test, { after, before } from "node:test";
import tls from "node:tls";
import { DatabaseSync } from "node:sqlite";
import { enrolOwner, setupTokenSink, type SignedInOwner } from "../../../apps/api/src/auth/testing.ts";
import { FleetConfigSchema, loadFleetConfig } from "../../../apps/api/src/fleet/config.ts";
import { buildServer } from "../../../apps/api/src/server.ts";
import { SshWriteTarget, WritesDisabledError } from "../../../apps/worker/src/index.ts";
import { PRODUCTION_ACK } from "../../../packages/domain/src/index.ts";
import { SqliteCareStore } from "../../../packages/store/src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "zt01-"));
const dbPath = join(dir, "care.db");
const emptyKnownHosts = join(dir, "known_hosts");
writeFileSync(emptyKnownHosts, "");
process.env["SERVRSIT_KNOWN_HOSTS"] = emptyKnownHosts;
process.env["SESSION_SECRET"] ??= "tester-only-session-secret-0123456789abcdef";

// ---- guard: any attempt to start a process or open a connection is recorded and refused ----
const attempts: string[] = [];
const restore: (() => void)[] = [];
function guard<T extends object>(obj: T, names: string[], label: string): void {
  for (const n of names) {
    const orig = (obj as Record<string, unknown>)[n];
    if (typeof orig !== "function") continue;
    (obj as Record<string, unknown>)[n] = (...args: unknown[]) => {
      attempts.push(`${label}.${n}(${String(args[0] ?? "").slice(0, 40)})`);
      throw new Error(`ZT-01 guard: ${label}.${n} is not allowed in this test`);
    };
    restore.push(() => { (obj as Record<string, unknown>)[n] = orig; });
  }
}

// T-053: every request is made by a signed-in owner, enrolled through the real setup flow.
const sink = setupTokenSink();
let owner: SignedInOwner;
let withCsrf: Record<string, string> = {};
const store = new SqliteCareStore({ path: dbPath });
type App = Awaited<ReturnType<typeof buildServer>>;
let app: App;
let readDb: DatabaseSync;
let hosts: { id: string; name: string; production: boolean }[] = [];

const COUNT_OPS = (): number => (readDb.prepare("SELECT count(*) AS n FROM operations").get() as { n: number }).n;
const opsFor = (id: string): number => (readDb.prepare("SELECT count(*) AS n FROM operations WHERE server_id = ?").get(id) as { n: number }).n;

before(async () => {
  const cfg = await loadFleetConfig();
  hosts = cfg.hosts.map((h) => ({ id: h.id, name: h.name, production: h.production }));
  app = await buildServer({ logger: false, startChecks: false, auth: { onSetupToken: sink.onSetupToken }, care: { store } });
  owner = await enrolOwner(app, sink.token());
  withCsrf = owner.headers(true);
  readDb = new DatabaseSync(dbPath, { readOnly: true });
  guard(childProcess, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"], "child_process");
  guard(net, ["connect", "createConnection"], "net");
  guard(tls, ["connect"], "tls");
  guard(dns, ["lookup", "resolve", "resolve4", "resolve6"], "dns");
  syncBuiltinESMExports();
});
after(async () => {
  restore.forEach((r) => r());
  syncBuiltinESMExports();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function post(url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: "POST", url, payload: body as object | undefined, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...owner.headers(true), ...headers } });
  let json: Record<string, any> = {};
  try { json = res.body ? JSON.parse(res.body) : {}; } catch { json = {}; }
  return { status: res.statusCode, body: json };
}

test("the shipped config covers the four real hosts and none can be written to", () => {
  assert.deepEqual(hosts.map((h) => h.name).sort(), ["Merauke", "Nabire", "Sentani", "Timika"]);
});

test("ZT-01: for every real host, a plan is blocked WRITES_DISABLED without contacting the server", async () => {
  for (const h of hosts) {
    const r = await post("/api/plans", { operation: "apply.packages.v1", serverId: h.id });
    assert.equal(r.status, 201, `${h.name}: plan request`);
    const codes = (r.body["blockers"] as { code: string }[]).map((b) => b.code);
    assert.ok(codes.includes("WRITES_DISABLED"), `${h.name}: expected WRITES_DISABLED, got ${codes.join(",")}`);
    assert.equal(r.body["approvable"], false, `${h.name}: must not be approvable`);
    assert.equal(r.body["preconditions"]?.previewDigest, "none", `${h.name}: no preview may be taken from a real server`);
  }
});

test("ZT-01: for every real host, approval is refused and creates no operation", async () => {
  for (const h of hosts) {
    const plan = (await post("/api/plans", { operation: "apply.packages.v1", serverId: h.id })).body;
    const r = await post(`/api/plans/${plan["id"]}/approvals`, {
      planVersion: plan["version"], planDigest: plan["digest"], idempotencyKey: `zt01-${h.name}-`.padEnd(24, "x"),
      acknowledgements: h.production ? [PRODUCTION_ACK] : [],
    }, withCsrf);
    assert.ok(r.status >= 400 && r.status < 500, `${h.name}: expected a 4xx refusal, got ${r.status}`);
    assert.ok(["PLAN_BLOCKED", "WRITES_DISABLED"].includes(String(r.body["error"])), `${h.name}: unexpected refusal ${JSON.stringify(r.body)}`);
    assert.equal(opsFor(h.id), 0, `${h.name}: an operation record was created`);
  }
  assert.equal(COUNT_OPS(), 0, "no operation may exist anywhere");
});

test("ZT-01: a revised plan for a real host is still blocked, and a client cannot send a writes flag", async () => {
  const h = hosts[0]!;
  const plan = (await post("/api/plans", { operation: "apply.packages.v1", serverId: h.id })).body;
  const rev = await post(`/api/plans/${plan["id"]}/revisions`);
  assert.equal(rev.status, 201);
  assert.ok((rev.body["blockers"] as { code: string }[]).some((b: { code: string }) => b.code === "WRITES_DISABLED"));
  const baseBody = { planVersion: rev.body["version"], planDigest: rev.body["digest"], idempotencyKey: "zt01-override-attempt-0001", acknowledgements: [PRODUCTION_ACK] };
  for (const extra of [{ writesEnabled: true }, { writes_enabled: true }, { force: true }, { override: { writesEnabled: true } }]) {
    const r = await post(`/api/plans/${plan["id"]}/approvals`, { ...baseBody, ...extra }, withCsrf);
    assert.ok(r.status >= 400 && r.status < 500, `override ${JSON.stringify(extra)}: ${r.status}`);
  }
  const headerSets: Record<string, string>[] = [{ "x-writes-enabled": "true" }, { "x-servrsit-force": "1" }];
  for (const headers of headerSets) {
    const r = await post(`/api/plans/${plan["id"]}/approvals`, baseBody, { ...withCsrf, ...headers });
    assert.ok(r.status >= 400 && r.status < 500, `header override ${JSON.stringify(headers)}: ${r.status}`);
  }
  assert.equal(COUNT_OPS(), 0);
});

test("ZT-01 (T-055): stop-request and reconcile on an id with no operation are refused and touch no server", async () => {
  for (const id of ["00000000-0000-4000-8000-0000000000dd", "not-an-id", "../etc/passwd", "a".repeat(200)]) {
    for (const route of ["stop-request", "reconcile"]) {
      const r = await post(`/api/operations/${encodeURIComponent(id)}/${route}`, undefined, withCsrf);
      assert.ok(r.status >= 400 && r.status < 500, `${route} on ${id.slice(0, 20)}: expected a 4xx refusal, got ${r.status}`);
    }
  }
  assert.equal(COUNT_OPS(), 0);
});

test("ZT-01: chat assent ('yes', 'do it', 'approve the plan') creates no operation for any real host", async () => {
  for (const h of hosts) {
    for (const message of ["yes", "do it", "approve the plan", "go ahead and update the packages now"]) {
      await post("/api/assistant/messages", { message, scope: h.id });
    }
  }
  assert.equal(COUNT_OPS(), 0);
});

test("ZT-01: no route can change a server's write setting (PATCH/PUT/POST/DELETE all 404 or 4xx, nothing mutates)", async () => {
  for (const h of hosts) {
    for (const url of [`/api/servers/${h.id}`, `/api/servers/${h.id}/writes`, "/api/config"]) {
      for (const method of ["PATCH", "PUT", "POST", "DELETE"] as const) {
        const res = await app.inject({ method, url, payload: { writesEnabled: true }, headers: { "content-type": "application/json", ...withCsrf } });
        assert.ok(res.statusCode === 404 || (res.statusCode >= 400 && res.statusCode < 500), `${method} ${url} -> ${res.statusCode}`);
      }
    }
  }
  const plan = (await post("/api/plans", { operation: "apply.packages.v1", serverId: hosts[0]!.id })).body;
  assert.ok((plan["blockers"] as { code: string }[]).some((b: { code: string }) => b.code === "WRITES_DISABLED"), "still gated after those attempts");
});

test("ZT-01: route inventory. Every mutating route is known and reviewed (a new one fails this test on purpose)", () => {
  const text = app.printRoutes({ commonPrefix: false });
  const found = new Set<string>();
  const stack: string[] = [];
  for (const line of text.split("\n")) {
    // Fastify prints a nested tree: rebuild each full path from the indentation depth.
    const m = line.match(/^([│ ]*)[├└]── (.*)$/);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    const rest = m[2]!.trim();
    const withMethods = rest.match(/^(\S+)\s+\(([A-Z, ]+)\)$/);
    stack[depth] = withMethods ? withMethods[1]! : rest;
    stack.length = depth + 1;
    if (!withMethods) continue;
    const full = stack.join("");
    for (const method of withMethods[2]!.split(",").map((x) => x.trim())) {
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) found.add(`${method} ${full}`);
    }
  }
  const expected = [
    "POST /api/assistant/messages",
    // T-053: create or end the owner's session; they touch no server and no care record.
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "POST /api/auth/setup",
    "POST /api/auth/setup/confirm",
    "POST /api/auth/totp",
    // T-055: flag a stop, and read the remote ledger. Reviewed: both act only on an existing operation, and no operation can exist for a real host (the tests above), so on a real host they can only answer 404.
    "POST /api/operations/:id/reconcile",
    "POST /api/operations/:id/stop-request",
    "POST /api/plans",
    "POST /api/plans/:id/approvals",
    "POST /api/plans/:id/revisions",
  ];
  assert.deepEqual([...found].sort(), expected, `mutating routes changed. Review each for the real-host gate.\n${text}`);
});

test("ZT-01: the real SSH write target refuses every write and cannot reach anything", async () => {
  const t = new SshWriteTarget(hosts[0]!.id);
  assert.equal(t.kind, "ssh");
  assert.equal(await t.previewPackages(), null);
  const rejected = await t.submit({} as never);
  assert.deepEqual(rejected, { status: "rejected", code: "WRITES_DISABLED" });
  await assert.rejects(() => t.query("00000000-0000-4000-8000-000000000001"), WritesDisabledError);
  await assert.rejects(() => t.inspectInstalled(["openssl:amd64"]), WritesDisabledError);
});

test("ZT-01: the SSH write target's source imports nothing that can start a process or open a connection", () => {
  const src = readFileSync(new URL("../../../apps/worker/src/ssh-write-target.ts", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
  for (const spec of imports) {
    assert.ok(/^(\.\/|@servrsit\/domain$)/.test(spec), `unexpected import in the real write target: ${spec}`);
    assert.ok(!/child_process|net|tls|dgram|dns|http|ssh|worker_threads|cluster/.test(spec.replace(/^\.\/target\.js$/, "")), `forbidden import: ${spec}`);
  }
  assert.ok(!/\b(require|import)\s*\(/.test(src), "dynamic import or require found");
});

test("ZT-01: configuration cannot enable writes: 'true' is rejected at load, absent means false", async () => {
  const raw = JSON.parse(readFileSync(new URL("../../../apps/api/config/hosts.json", import.meta.url), "utf8"));
  const enabled = structuredClone(raw);
  enabled.hosts[0].writesEnabled = true;
  assert.equal(FleetConfigSchema.safeParse(enabled).success, false, "writesEnabled:true must fail to load");
  for (const bad of ["true", 1, null, "false"]) {
    const c = structuredClone(raw); c.hosts[0].writesEnabled = bad;
    assert.equal(FleetConfigSchema.safeParse(c).success, false, `writesEnabled:${JSON.stringify(bad)} must fail to load`);
  }
  const absent = structuredClone(raw);
  for (const h of absent.hosts) delete h.writesEnabled;
  const parsed = FleetConfigSchema.parse(absent);
  assert.ok(parsed.hosts.every((h) => h.writesEnabled === false), "absent must default to false");
});

test("ZT-01: the store itself refuses an approval for a real target even when the route is bypassed", async () => {
  const h = hosts[0]!;
  const plan = (await post("/api/plans", { operation: "apply.packages.v1", serverId: h.id })).body;
  const stored = store.getPlan(plan["id"] as string);
  assert.ok(stored);
  const r = store.approve({
    planId: stored.id, planVersion: stored.version, planDigest: stored.digest, idempotencyKey: "zt01-store-direct-0001",
    owner: "tester", acknowledgements: [PRODUCTION_ACK], writesEnabled: true /* a lying caller */, targetKind: "ssh",
    now: new Date(), newId: () => "00000000-0000-4000-8000-0000000000aa",
  });
  assert.equal(r.kind, "rejected", `the store must refuse a real-target operation: ${JSON.stringify(r)}`);
  assert.equal(opsFor(h.id), 0);
});

test("ZT-01: nothing started a process, opened a socket, or resolved a name during any of the above", () => {
  assert.deepEqual(attempts, [], `forbidden I/O attempts: ${attempts.join(", ")}`);
});
