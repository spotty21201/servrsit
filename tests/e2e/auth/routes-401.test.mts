/**
 * Every /api route is closed without a session. Flow-agnostic: it enumerates the
 * routes the app actually registers, then calls each one with every method and
 * no credentials. Source: PRD FR-01 ("An unauthenticated request cannot read
 * fleet data or run work. A signed-out session cannot approve an operation"),
 * Tech Spec §5, UX §7.1 and the T-053 task list ("every /api route 401 without
 * a session").
 *
 * The only routes allowed to answer without a session are those that CREATE a
 * session (log in, first-run setup). Anything else that answers is a defect.
 * That allowlist is deliberately narrow and written down here, not derived
 * from the product.
 *
 *   cd apps/api && pnpm exec tsx --test --test-reporter=spec ../../tests/e2e/auth/routes-401.test.mts
 */
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { buildServer } from "../../../apps/api/src/server.ts";

type App = Awaited<ReturnType<typeof buildServer>>;
let app: App;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const UUID = "00000000-0000-4000-8000-0000000000aa";

/** Routes that may legitimately answer before a session exists: they establish one. Narrow on purpose. */
export const PUBLIC_ALLOWED = [/^\/api\/auth\/(login|setup|totp|session|logout)(\/|$)/, /^\/api\/(login|setup)(\/|$)/];

before(async () => { app = await buildServer({ logger: false, startChecks: false }); });
after(async () => { await app.close(); });

function inventory(): { method: string; path: string }[] {
  const text = app.printRoutes({ commonPrefix: false });
  const out: { method: string; path: string }[] = [];
  const stack: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^([│ ]*)[├└]── (.*)$/);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    const rest = m[2]!.trim();
    const wm = rest.match(/^(\S+)\s+\(([A-Z, ]+)\)$/);
    stack[depth] = wm ? wm[1]! : rest;
    stack.length = depth + 1;
    if (!wm) continue;
    for (const method of wm[2]!.split(",").map((x) => x.trim())) out.push({ method, path: stack.join("") });
  }
  return out;
}
const concrete = (p: string) => p.replace(/:[A-Za-z]+/g, UUID);
const isApi = (p: string) => p.startsWith("/api/");

test("the inventory is real: the app registers /api routes, so the sweep below is not vacuous", () => {
  const api = inventory().filter((r) => isApi(r.path));
  assert.ok(api.length >= 6, `only ${api.length} /api routes found`);
});

test("every REGISTERED /api route (each method it answers to), with no credentials, is refused with 401 (except session-creating routes)", async () => {
  const pairs = inventory().filter((r) => isApi(r.path) && r.method !== "OPTIONS");
  const open: string[] = [];
  const publicSeen: string[] = [];
  for (const { method, path } of pairs) {
    const res = await app.inject({
      method: method as "GET", url: concrete(path),
      payload: method === "GET" || method === "HEAD" ? undefined : ({} as object),
      headers: method === "GET" || method === "HEAD" ? {} : { "content-type": "application/json" },
    });
    if (res.statusCode === 401) continue;
    if (PUBLIC_ALLOWED.some((re) => re.test(path))) { publicSeen.push(`${method} ${path} -> ${res.statusCode}`); continue; }
    open.push(`${method} ${path} -> ${res.statusCode}`);
  }
  console.log(`[routes] ${pairs.length} registered /api method+path pairs swept; session-creating routes seen: ${publicSeen.length}`);
  assert.deepEqual(open, [], `registered routes that answered WITHOUT a session (${open.length}):\n${open.join("\n")}`);
});

test("unregistered methods and paths under /api never answer 2xx without a session", async () => {
  const registered = new Set(inventory().map((r) => `${r.method} ${r.path}`));
  const paths = [...new Set(inventory().map((r) => r.path).filter(isApi)), "/api/does-not-exist", "/api/admin", "/api/servers", "/api/config"];
  const bad: string[] = [];
  const answers = new Map<number, number>();
  for (const path of paths) for (const method of METHODS) {
    if (registered.has(`${method} ${path}`)) continue;
    const res = await app.inject({ method, url: concrete(path), payload: method === "GET" ? undefined : ({} as object), headers: method === "GET" ? {} : { "content-type": "application/json" } });
    answers.set(res.statusCode, (answers.get(res.statusCode) ?? 0) + 1);
    if (res.statusCode >= 200 && res.statusCode < 300) bad.push(`${method} ${path} -> ${res.statusCode}`);
  }
  console.log("[routes] unregistered combinations by status:", JSON.stringify([...answers.entries()]));
  assert.deepEqual(bad, []);
});

test("an unauthenticated refusal reveals nothing: tiny body, no stack, no server names, no data", async () => {
  for (const path of ["/api/fleet", "/api/operations/" + UUID, "/api/plans/" + UUID]) {
    const res = await app.inject({ method: "GET", url: path });
    assert.equal(res.statusCode, 401, path);
    assert.ok(res.body.length < 300, `${path}: body is ${res.body.length} bytes`);
    for (const leak of ["Timika", "Nabire", "Sentani", "Merauke", "stack", "at /", "node_modules", "hosts.json", "ssh"]) {
      assert.ok(!res.body.includes(leak), `${path}: refusal leaks "${leak}"`);
    }
  }
});

test("a garbage session cookie is treated exactly like no cookie", async () => {
  for (const cookie of ["servrsit_session=not-a-real-session", "servrsit_session=", "servrsit_session=" + "A".repeat(500), "sid=1; servrsit_session=../../etc/passwd"]) {
    const res = await app.inject({ method: "GET", url: "/api/fleet", headers: { cookie } });
    assert.equal(res.statusCode, 401, cookie.slice(0, 40));
  }
});

test("a state-changing request with no session is refused with 401, not with a CSRF or validation error that confirms the route", async () => {
  const res = await app.inject({ method: "POST", url: "/api/plans", payload: { operation: "apply.packages.v1", serverId: UUID }, headers: { "content-type": "application/json" } });
  assert.equal(res.statusCode, 401);
});

test("the health check stays open (it is not under /api and carries no data)", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.ok(!/Timika|Nabire|Sentani|Merauke/.test(res.body));
});
