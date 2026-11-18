/**
 * T-053: local owner auth with mandatory TOTP (ADR-017).
 * Every request goes through the real routes with fastify.inject(). No socket is opened.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { AUTH_SESSION_COOKIE, AuthErrorSchema, SessionInfoSchema } from "@servrsit/contracts";
import { SqliteAuthStore } from "@servrsit/store";
import { buildServer } from "../server.js";
import { FleetConfigSchema } from "../fleet/config.js";
import { FleetService } from "../fleet/service.js";
import { makeObservation } from "../fleet/observation.fixtures.js";
import { ABSOLUTE_TIMEOUT_MS, IDLE_TIMEOUT_MS, lockDurationMs, OwnerAuth } from "./owner-auth.js";
import authRoutes, { ENROL_COOKIE, MFA_COOKIE } from "./routes.js";
import { enrolOwner, setupTokenSink, TEST_ORIGIN, TEST_PASSWORD, TEST_USERNAME, totpCode } from "./testing.js";

const config = FleetConfigSchema.parse({
  healthIntervalMinutes: 15,
  hosts: [{ id: "11111111-1111-4111-a111-111111111111", name: "Alpha", access: "ssh", address: "alpha", port: 22, user: "spotty", role: null, production: true, collect: true }],
});
const JSON_HEADERS = { "content-type": "application/json", origin: TEST_ORIGIN };
const STEP = 30_000;

class Clock {
  t = Date.parse("2026-11-17T10:00:10.000Z");
  now = () => this.t;
  advance(ms: number) { this.t += ms; }
}

async function start(opts: { store?: SqliteAuthStore; logLines?: string[] } = {}) {
  const clock = new Clock();
  const sink = setupTokenSink();
  const fleet = new FleetService({ config, knownHostsFile: "/x/known_hosts", pinChecker: async () => "pinned", collector: async () => ({ ok: true, observation: makeObservation() }) });
  const app = await buildServer({
    config, fleetService: fleet, startChecks: false, ownerContextPath: null,
    ...(opts.logLines === undefined ? { logger: false } : { logStream: { write: (m: string) => { opts.logLines!.push(m); } } }),
    auth: { now: clock.now, onSetupToken: sink.onSetupToken, ...(opts.store === undefined ? {} : { store: opts.store }) },
  });
  const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url, payload, headers: { ...JSON_HEADERS, ...headers } });
  const cookieOf = (r: { cookies: Array<{ name: string; value: string }> }, name: string) => r.cookies.find((c) => c.name === name)?.value;
  /** Password step, then the TOTP step at the current clock. */
  const signIn = async (totpSecret: string, code = totpCode(totpSecret, clock.t)) => {
    const login = await post("/api/auth/login", { username: TEST_USERNAME, password: TEST_PASSWORD });
    const ticket = cookieOf(login, MFA_COOKIE);
    const second = await post("/api/auth/totp", { code }, ticket === undefined ? {} : { cookie: `${MFA_COOKIE}=${ticket}` });
    const sid = cookieOf(second, AUTH_SESSION_COOKIE);
    return { login, second, cookie: sid === undefined ? undefined : `${AUTH_SESSION_COOKIE}=${sid}` };
  };
  return { app, clock, sink, post, cookieOf, signIn };
}

const errorOf = (r: { json(): unknown }) => AuthErrorSchema.parse(r.json()).error;

// ---- every route closed ---------------------------------------------------------

function inventory(app: Awaited<ReturnType<typeof buildServer>>): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const stack: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
    const m = line.match(/^([│ ]*)[├└]── (.*)$/);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    const rest = m[2]!.trim();
    const wm = rest.match(/^(\S+)\s+\(([A-Z, ]+)\)$/);
    stack[depth] = wm ? wm[1]! : rest;
    stack.length = depth + 1;
    if (wm) for (const method of wm[2]!.split(",").map((x) => x.trim())) out.push({ method, path: stack.join("") });
  }
  return out;
}

test("every /api route answers 401 without a session, except the session-creating auth routes; /health stays open", async () => {
  const h = await start();
  try {
    const routes = inventory(h.app).filter((r) => r.path.startsWith("/api/") && r.method !== "OPTIONS" && r.method !== "HEAD");
    assert.ok(routes.length >= 10, `only ${routes.length} routes found`);
    const PUBLIC = /^\/api\/auth\/(setup|setup\/confirm|login|totp|session|logout)$/;
    const open: string[] = [];
    for (const { method, path } of routes) {
      if (PUBLIC.test(path)) continue;
      const url = path.replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-0000000000aa");
      const r = await h.app.inject({ method: method as "GET", url, ...(method === "GET" ? {} : { payload: {}, headers: JSON_HEADERS }) });
      if (r.statusCode !== 401) open.push(`${method} ${path} -> ${r.statusCode}`);
      else {
        assert.deepEqual(r.json(), { error: "UNAUTHENTICATED" });
        assert.ok(!/Alpha|stack|node_modules/.test(r.body));
      }
    }
    assert.deepEqual(open, []);
    for (const url of ["/api/does-not-exist", "/api", "/api/fleet?x=1"]) {
      assert.equal((await h.app.inject({ method: "GET", url })).statusCode, 401, url);
    }
    assert.equal((await h.app.inject({ method: "GET", url: "/health" })).statusCode, 200);
    for (const cookie of [`${AUTH_SESSION_COOKIE}=garbage`, `${AUTH_SESSION_COOKIE}=${"A".repeat(43)}`, `${AUTH_SESSION_COOKIE}=`]) {
      assert.equal((await h.app.inject({ method: "GET", url: "/api/fleet", headers: { cookie } })).statusCode, 401, cookie);
    }
  } finally { await h.app.close(); }
});

test("an unauthenticated POST gets 401 before any CSRF or validation answer", async () => {
  const h = await start();
  try {
    const r = await h.app.inject({ method: "POST", url: "/api/plans", payload: { nonsense: true }, headers: { "content-type": "application/json", origin: "https://evil.example" } });
    assert.equal(r.statusCode, 401);
  } finally { await h.app.close(); }
});

// ---- setup ------------------------------------------------------------------------

test("setup: the token works until enrolment is confirmed; after that setup is closed and a restart issues no new token", async () => {
  const store = new SqliteAuthStore({ path: ":memory:" });
  const h = await start({ store });
  try {
    const token = h.sink.token();
    const body = { setupToken: token, username: TEST_USERNAME, password: TEST_PASSWORD };
    assert.equal((await h.post("/api/auth/setup", body)).statusCode, 200);
    // T-066 D-A4: until setup is confirmed, the same token can restart an abandoned enrolment.
    const again = await h.post("/api/auth/setup", body);
    assert.equal(again.statusCode, 200, "the token restarts enrolment until it is confirmed");
    const wrong = await h.post("/api/auth/setup", { ...body, setupToken: "x".repeat(43) });
    assert.deepEqual([wrong.statusCode, errorOf(wrong)], [403, "SETUP_UNAVAILABLE"], "a wrong token gets the same answer");

    // A restart before enrolment completes replaces the token: the new one works, the old one never did twice.
    let reissued: string | null = null;
    const restarted = new OwnerAuth({ store, now: h.clock.now, onSetupToken: (t) => { reissued = t; } });
    await restarted.init();
    assert.ok(reissued !== null && reissued !== token);
    const owner = await enrolOwner(h.app, reissued, { now: h.clock.now });
    assert.equal(owner.recoveryCodes.length, 10);

    let afterOwner: string | null = null;
    await new OwnerAuth({ store, now: h.clock.now, onSetupToken: (t) => { afterOwner = t; } }).init();
    assert.equal(afterOwner, null, "no setup token once an owner exists");
    const closed = await h.post("/api/auth/setup", { ...body, setupToken: reissued });
    assert.deepEqual([closed.statusCode, errorOf(closed)], [403, "SETUP_UNAVAILABLE"]);
  } finally { await h.app.close(); }
});

test("setup confirmation needs a valid TOTP code from the new secret, and gives a session plus 10 distinct recovery codes", async () => {
  const h = await start();
  try {
    const start1 = await h.post("/api/auth/setup", { setupToken: h.sink.token(), username: TEST_USERNAME, password: TEST_PASSWORD });
    const { totpSecret, otpauthUri } = start1.json() as { totpSecret: string; otpauthUri: string };
    assert.match(otpauthUri, /^otpauth:\/\/totp\/ServrSit:owner\?.*secret=/);
    const ticket = h.cookieOf(start1, ENROL_COOKIE)!;
    const bad = await h.post("/api/auth/setup/confirm", { code: "000000" === totpCode(totpSecret, h.clock.t) ? "111111" : "000000" }, { cookie: `${ENROL_COOKIE}=${ticket}` });
    assert.deepEqual([bad.statusCode, errorOf(bad)], [401, "INVALID_CODE"]);
    assert.equal(h.cookieOf(bad, AUTH_SESSION_COOKIE), undefined);
    const good = await h.post("/api/auth/setup/confirm", { code: totpCode(totpSecret, h.clock.t) }, { cookie: `${ENROL_COOKIE}=${ticket}` });
    assert.equal(good.statusCode, 200);
    const body = good.json() as { recoveryCodes: string[]; session: unknown };
    assert.equal(new Set(body.recoveryCodes).size, 10);
    SessionInfoSchema.parse(body.session);
    const sid = h.cookieOf(good, AUTH_SESSION_COOKIE)!;
    assert.equal((await h.app.inject({ method: "GET", url: "/api/fleet", headers: { cookie: `${AUTH_SESSION_COOKIE}=${sid}` } })).statusCode, 200);
  } finally { await h.app.close(); }
});

// ---- sign-in ------------------------------------------------------------------------

test("sign-in: the password alone issues no session; TOTP is required first", async () => {
  const h = await start();
  try {
    const owner = await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    h.clock.advance(STEP);
    const login = await h.post("/api/auth/login", { username: TEST_USERNAME, password: TEST_PASSWORD });
    assert.deepEqual([login.statusCode, login.json()], [200, { next: "totp" }]);
    assert.equal(h.cookieOf(login, AUTH_SESSION_COOKIE), undefined, "no session after the password step");
    const ticket = h.cookieOf(login, MFA_COOKIE)!;
    assert.equal((await h.app.inject({ method: "GET", url: "/api/fleet", headers: { cookie: `${MFA_COOKIE}=${ticket}` } })).statusCode, 401, "the MFA ticket is not a session");
    const noTicket = await h.post("/api/auth/totp", { code: totpCode(owner.totpSecret, h.clock.t) });
    assert.deepEqual([noTicket.statusCode, errorOf(noTicket)], [401, "MFA_REQUIRED"]);
    const ok = await h.post("/api/auth/totp", { code: totpCode(owner.totpSecret, h.clock.t) }, { cookie: `${MFA_COOKIE}=${ticket}` });
    assert.equal(ok.statusCode, 200);
    assert.ok(h.cookieOf(ok, AUTH_SESSION_COOKIE));
  } finally { await h.app.close(); }
});

test("a wrong TOTP code is refused and issues no session", async () => {
  const h = await start();
  try {
    const owner = await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    h.clock.advance(STEP);
    const right = totpCode(owner.totpSecret, h.clock.t);
    const wrong = right === "123456" ? "654321" : "123456";
    const r = await h.signIn(owner.totpSecret, wrong);
    assert.deepEqual([r.second.statusCode, errorOf(r.second)], [401, "INVALID_CODE"]);
    assert.equal(r.cookie, undefined);
    const stale = await h.signIn(owner.totpSecret, totpCode(owner.totpSecret, h.clock.t - 5 * STEP));
    assert.deepEqual([stale.second.statusCode, errorOf(stale.second)], [401, "INVALID_CODE"], "a code from 2.5 minutes ago");
  } finally { await h.app.close(); }
});

test("a TOTP code cannot be replayed, and an older time step is refused after a newer one", async () => {
  const h = await start();
  try {
    const owner = await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    h.clock.advance(STEP);
    const code = totpCode(owner.totpSecret, h.clock.t);
    const first = await h.signIn(owner.totpSecret, code);
    assert.equal(first.second.statusCode, 200);
    const replay = await h.signIn(owner.totpSecret, code);
    assert.deepEqual([replay.second.statusCode, errorOf(replay.second)], [401, "INVALID_CODE"], "same code, same 30 s window");
    h.clock.advance(STEP);
    const newer = await h.signIn(owner.totpSecret);
    assert.equal(newer.second.statusCode, 200);
    const older = await h.signIn(owner.totpSecret, totpCode(owner.totpSecret, h.clock.t - STEP));
    assert.deepEqual([older.second.statusCode, errorOf(older.second)], [401, "INVALID_CODE"], "previous step is inside the window but older than the last accepted");
  } finally { await h.app.close(); }
});

test("no disclosure: unknown user, wrong password and no account at all get the same answer", async () => {
  const h = await start();
  try {
    const before = await h.post("/api/auth/login", { username: TEST_USERNAME, password: TEST_PASSWORD });
    const sessionBefore = (await h.app.inject({ method: "GET", url: "/api/auth/session" })).json();
    await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    h.clock.advance(STEP);
    const unknownUser = await h.post("/api/auth/login", { username: "someone-else", password: TEST_PASSWORD });
    const wrongPassword = await h.post("/api/auth/login", { username: TEST_USERNAME, password: "not-the-password-000" });
    for (const r of [before, unknownUser, wrongPassword]) {
      assert.equal(r.statusCode, 401);
      assert.equal(r.body, JSON.stringify({ error: "INVALID_CREDENTIALS" }));
      assert.equal(h.cookieOf(r, MFA_COOKIE), undefined);
    }
    assert.deepEqual(sessionBefore, { authenticated: false });
    assert.deepEqual((await h.app.inject({ method: "GET", url: "/api/auth/session" })).json(), { authenticated: false });
  } finally { await h.app.close(); }
});

test("lockout: 5 failures lock sign-in (even with the right password), the lock doubles, and a full sign-in resets it", async () => {
  const h = await start();
  try {
    const owner = await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    const bad = () => h.post("/api/auth/login", { username: TEST_USERNAME, password: "wrong-password-attempt" });
    for (let i = 1; i <= 4; i++) assert.equal(errorOf(await bad()), "INVALID_CREDENTIALS", `attempt ${i}`);
    const fifth = await bad();
    assert.deepEqual([fifth.statusCode, errorOf(fifth)], [429, "LOCKED_OUT"]);
    assert.equal(fifth.headers["retry-after"], "30");
    const rightDuringLock = await h.post("/api/auth/login", { username: TEST_USERNAME, password: TEST_PASSWORD });
    assert.deepEqual([rightDuringLock.statusCode, errorOf(rightDuringLock)], [429, "LOCKED_OUT"], "the right password does not get through a lock");

    h.clock.advance(31_000);
    const sixth = await bad();
    assert.deepEqual([sixth.statusCode, errorOf(sixth), sixth.headers["retry-after"]], [429, "LOCKED_OUT", "60"], "the next failure doubles the lock");
    assert.equal(lockDurationMs(30), 15 * 60_000, "capped at 15 minutes");

    h.clock.advance(61_000);
    assert.equal((await h.signIn(owner.totpSecret)).second.statusCode, 200);
    assert.equal(errorOf(await bad()), "INVALID_CREDENTIALS", "a successful sign-in reset the counter");
  } finally { await h.app.close(); }
});

test("wrong second-factor codes count toward the lockout and burn the ticket after 5 tries", async () => {
  const h = await start();
  try {
    const owner = await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    h.clock.advance(STEP);
    const login = await h.post("/api/auth/login", { username: TEST_USERNAME, password: TEST_PASSWORD });
    const cookie = `${MFA_COOKIE}=${h.cookieOf(login, MFA_COOKIE)!}`;
    const right = totpCode(owner.totpSecret, h.clock.t);
    const wrong = right === "000001" ? "000002" : "000001";
    const answers: string[] = [];
    for (let i = 0; i < 5; i++) answers.push(errorOf(await h.post("/api/auth/totp", { code: wrong }, { cookie })));
    assert.deepEqual(answers, ["INVALID_CODE", "INVALID_CODE", "INVALID_CODE", "INVALID_CODE", "LOCKED_OUT"]);
    h.clock.advance(31_000);
    assert.equal(errorOf(await h.post("/api/auth/totp", { code: totpCode(owner.totpSecret, h.clock.t) }, { cookie })), "MFA_REQUIRED", "the ticket is spent");
  } finally { await h.app.close(); }
});

test("the login endpoints are rate limited: 10 per minute", async () => {
  const h = await start();
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await h.post("/api/auth/login", { username: `u${i}`, password: "x" })).statusCode);
    assert.equal(statuses[10], 429);
    h.clock.advance(61_000);
    const r = await h.post("/api/auth/login", { username: "u", password: "x" });
    assert.notEqual(errorOf(r), "RATE_LIMITED");
  } finally { await h.app.close(); }
});

test("recovery codes: each works once in place of a TOTP code", async () => {
  const h = await start();
  try {
    const owner = await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    const use = async (recoveryCode: string) => {
      const login = await h.post("/api/auth/login", { username: TEST_USERNAME, password: TEST_PASSWORD });
      return h.post("/api/auth/totp", { recoveryCode }, { cookie: `${MFA_COOKIE}=${h.cookieOf(login, MFA_COOKIE)!}` });
    };
    const code = owner.recoveryCodes[3]!;
    assert.equal((await use(code.toLowerCase().replace(/-/g, " "))).statusCode, 200, "case and separators do not matter");
    assert.equal(errorOf(await use(code)), "INVALID_CODE", "second use refused");
    assert.equal((await use(owner.recoveryCodes[4]!)).statusCode, 200);
  } finally { await h.app.close(); }
});

// ---- sessions -----------------------------------------------------------------------

test("session cookie: HttpOnly, SameSite=Strict, Path=/; not Secure over plain HTTP in development", async () => {
  const h = await start();
  try {
    const owner = await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    h.clock.advance(STEP);
    const r = await h.signIn(owner.totpSecret);
    const c = r.second.cookies.find((x) => x.name === AUTH_SESSION_COOKIE)! as { httpOnly?: boolean; sameSite?: string; path?: string; secure?: boolean };
    assert.equal(c.httpOnly, true);
    assert.equal(c.sameSite, "Strict");
    assert.equal(c.path, "/");
    assert.notEqual(c.secure, true);
  } finally { await h.app.close(); }
});

test("session cookie is Secure when the server is configured for HTTPS", async () => {
  const store = new SqliteAuthStore({ path: ":memory:" });
  let token = "";
  const auth = new OwnerAuth({ store, onSetupToken: (t) => { token = t; } });
  await auth.init();
  const app = Fastify();
  await app.register(fastifyCookie);
  await app.register(authRoutes, { auth, secureCookies: true });
  try {
    const owner = await enrolOwner(app, token);
    assert.ok(owner.cookie.length > 0);
    const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { setupToken: "y".repeat(43), username: "o", password: TEST_PASSWORD }, headers: JSON_HEADERS });
    assert.equal(r.statusCode, 403);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: TEST_USERNAME, password: TEST_PASSWORD }, headers: JSON_HEADERS });
    const c = login.cookies.find((x) => x.name === MFA_COOKIE) as { secure?: boolean } | undefined;
    assert.equal(c?.secure, true);
  } finally { await app.close(); }
});

test("session expiry: 60 minutes idle ends it; activity keeps it alive but never past 8 hours", async () => {
  const h = await start();
  try {
    const owner = await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    const get = (cookie: string) => h.app.inject({ method: "GET", url: "/api/fleet", headers: { cookie } });
    h.clock.advance(IDLE_TIMEOUT_MS - 1000);
    assert.equal((await get(owner.cookie)).statusCode, 200, "59 min 59 s idle: still valid");
    h.clock.advance(IDLE_TIMEOUT_MS);
    assert.equal((await get(owner.cookie)).statusCode, 401, "60 min idle: expired");
    assert.equal((await get(owner.cookie)).statusCode, 401, "and it stays expired");

    const fresh = await h.signIn(owner.totpSecret);
    assert.ok(fresh.cookie);
    let elapsed = 0;
    while (elapsed + 50 * 60_000 < ABSOLUTE_TIMEOUT_MS) {
      h.clock.advance(50 * 60_000);
      elapsed += 50 * 60_000;
      assert.equal((await get(fresh.cookie)).statusCode, 200, `active at ${elapsed / 60_000} min`);
    }
    h.clock.advance(ABSOLUTE_TIMEOUT_MS - elapsed);
    assert.equal((await get(fresh.cookie)).statusCode, 401, "8 hours after sign-in, whatever the activity");
  } finally { await h.app.close(); }
});

test("logout needs the CSRF token, ends the session, and the cookie stops working", async () => {
  const h = await start();
  try {
    const owner = await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    const noCsrf = await h.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: owner.cookie, origin: TEST_ORIGIN } });
    assert.equal(noCsrf.statusCode, 403);
    assert.equal((await h.app.inject({ method: "GET", url: "/api/fleet", headers: { cookie: owner.cookie } })).statusCode, 200);
    const out = await h.app.inject({ method: "POST", url: "/api/auth/logout", headers: owner.headers(true) });
    assert.equal(out.statusCode, 204);
    assert.equal((await h.app.inject({ method: "GET", url: "/api/fleet", headers: { cookie: owner.cookie } })).statusCode, 401);
  } finally { await h.app.close(); }
});

// ---- CSRF and Origin --------------------------------------------------------------

test("CSRF: every state-changing request needs the session's token and an allowed Origin", async () => {
  const h = await start();
  try {
    const owner = await enrolOwner(h.app, h.sink.token(), { now: h.clock.now });
    h.clock.advance(STEP);
    const other = await h.signIn(owner.totpSecret);
    const otherCsrf = (await h.app.inject({ method: "GET", url: "/api/csrf", headers: { cookie: other.cookie! } })).json() as { token: string };
    assert.notEqual(otherCsrf.token, owner.csrfToken, "each session has its own token");
    const body = { message: "How is Alpha?", scope: "all" };
    const cases: Array<[string, Record<string, string>]> = [
      ["no token", { cookie: owner.cookie, origin: TEST_ORIGIN }],
      ["wrong token", { cookie: owner.cookie, origin: TEST_ORIGIN, "x-csrf-token": "x".repeat(43) }],
      ["another session's token", { cookie: owner.cookie, origin: TEST_ORIGIN, "x-csrf-token": otherCsrf.token }],
      ["foreign origin", { ...owner.headers(true), origin: "https://evil.example" }],
      ["cross-site fetch", { ...owner.headers(true), "sec-fetch-site": "cross-site" }],
    ];
    for (const url of ["/api/assistant/messages", "/api/plans"]) {
      for (const [label, headers] of cases) {
        const r = await h.app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json", ...headers } });
        assert.deepEqual([r.statusCode, r.json()], [403, { error: "CSRF_INVALID" }], `${url}: ${label}`);
      }
    }
    const ok = await h.app.inject({ method: "POST", url: "/api/assistant/messages", payload: body, headers: { "content-type": "application/json", ...owner.headers(true) } });
    assert.equal(ok.statusCode, 200);
    const foreignLogin = await h.post("/api/auth/login", { username: TEST_USERNAME, password: TEST_PASSWORD }, { origin: "https://evil.example" });
    assert.deepEqual([foreignLogin.statusCode, errorOf(foreignLogin)], [403, "CSRF_INVALID"], "login from a foreign origin");
  } finally { await h.app.close(); }
});

// ---- secrets ------------------------------------------------------------------------

test("no secret reaches the logs or the database in readable form", async () => {
  const lines: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "servrsit-auth-"));
  const dbPath = join(dir, "auth.db");
  const store = new SqliteAuthStore({ path: dbPath });
  const h = await start({ store, logLines: lines });
  try {
    const setupToken = h.sink.token();
    const owner = await enrolOwner(h.app, setupToken, { now: h.clock.now });
    h.clock.advance(STEP);
    const code = totpCode(owner.totpSecret, h.clock.t);
    const ok = await h.signIn(owner.totpSecret, code);
    await h.signIn(owner.totpSecret, code);
    await h.post("/api/auth/login", { username: TEST_USERNAME, password: "wrong-password-in-log-test" });
    const mfaTicket = h.cookieOf(ok.login, MFA_COOKIE)!;
    const sessionId = owner.cookie.split("=")[1]!;
    const log = lines.join("");
    assert.ok(log.includes('"step":"totp"'), "attempts are logged, by outcome");
    const secrets: Record<string, string> = {
      password: TEST_PASSWORD, "wrong password": "wrong-password-in-log-test", "setup token": setupToken,
      "TOTP secret": owner.totpSecret, "TOTP code": `"${code}"`, "session id": sessionId, "CSRF token": owner.csrfToken,
      "MFA ticket": mfaTicket, ...Object.fromEntries(owner.recoveryCodes.map((c, i) => [`recovery code ${i}`, c])),
    };
    for (const [label, value] of Object.entries(secrets)) assert.equal(log.includes(value), false, `log contains the ${label}`);

    store.close();
    assert.equal(statSync(dbPath).mode & 0o777, 0o600, "auth database is owner-only");
    const db = readFileSync(dbPath).toString("latin1");
    for (const label of ["password", "setup token", "session id", "MFA ticket", "recovery code 0", "recovery code 9"]) {
      assert.equal(db.includes(secrets[label]!), false, `database contains the ${label}`);
    }
    assert.ok(db.includes("$argon2id$v=19$m=19456,t=2,p=1$"), "the password is stored as an argon2id hash");
  } finally { await h.app.close(); }
});
