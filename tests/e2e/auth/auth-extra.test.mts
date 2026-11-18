/**
 * T-053 checks beyond the 27 scenarios: things only visible once the real flow exists.
 * Tests marked `todo` assert the behaviour I believe is required and FAIL today; they are
 * reported as defects (see docs/team/test-report-ai-auth-001.md), not hidden.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthBinding, ORIGIN, PASSWORD, USERNAME } from "./binding.mts";
import { totp } from "./support/totp.mts";
import { HOUR, MIN } from "./support/contract.mts";

const HDR = { origin: ORIGIN };
const wrongPassword = (h: AuthBinding, client?: string) =>
  h.raw("POST", "/api/auth/login", { body: { username: USERNAME, password: "wrong-password-0000-xyz" }, headers: HDR, ...(client ? { client } : {}) });
const garbage = (h: AuthBinding) => h.raw("POST", "/api/auth/login", { body: {}, headers: HDR });

async function enrolled(opts: Parameters<typeof AuthBinding.create>[0]) {
  const h = await AuthBinding.create(opts);
  const r = await h.setup({ token: await h.setupToken() });
  assert.equal(r.ok, true, "premise: setup works");
  return h;
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

// ------------------------------------------------------------------ setup token delivery
test("X-01 by default the setup token goes to stderr, once, and never into the structured log", async () => {
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = (c: unknown, ...rest: unknown[]) => { chunks.push(String(c)); return (orig as any)(c, ...rest); };
  let h: AuthBinding;
  try { h = await AuthBinding.create({ wiring: "isolated", defaultTokenSink: true }); } finally { (process.stderr as any).write = orig; }
  try {
    const text = chunks.join("");
    const m = /^\s{2}(\S{16,})\s*$/m.exec(text);
    assert.ok(m, "no setup token was printed to stderr");
    const token = m![1]!;
    const r = await h.raw("POST", "/api/auth/setup", { body: { setupToken: token, username: USERNAME, password: PASSWORD }, headers: HDR });
    assert.equal(r.status, 200, "the printed token must be the real one");
    assert.ok(!h.logText().includes(token), "setup token appears in the structured log");
    assert.equal(text.split(token).length - 1, 1, "token printed more than once");
  } finally { await h.close(); }
});

// ------------------------------------------------------------------ what is stored
test("X-02 the database holds no plaintext password, setup token, session id, ticket or recovery code; file is 0600", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tester-auth-"));
  const path = join(dir, "auth.db");
  const h = await enrolled({ wiring: "isolated", storePath: path });
  try {
    const token = await h.setupToken();
    await h.advance(0);
    const s = (await h.login({ code: totp(h.totpSecret!, h.now()) })).data!;
    const secrets: [string, string][] = [["password", PASSWORD], ["setup token", token], ["session id", s.cookie],
      ...h.recoveryCodes.map((c, i): [string, string] => [`recovery code ${i}`, c]),
      ...h.allSetCookies.filter((c) => c.value && c.name !== "").map((c): [string, string] => [`cookie ${c.name}`, c.value])];
    const files = readdirSync(dir).filter((f) => f.startsWith("auth.db"));
    const blob = files.map((f) => readFileSync(join(dir, f)).toString("latin1")).join("\n");
    const found = secrets.filter(([, v]) => v.length >= 8 && blob.includes(v)).map(([n]) => n);
    assert.deepEqual(found, [], `plaintext secrets in the database files: ${found.join(", ")}`);
    assert.equal(statSync(path).mode & 0o777, 0o600, "database file mode");
    // Characterisation, not an assertion about desired behaviour: ADR-017 says the TOTP secret is stored readable.
    // CSRF tokens are stored as given. No spec says otherwise and one is useless without the session id, so this is an observation, not a failure.
    console.log(`# X-02 observation: CSRF token readable in the database file = ${blob.includes(s.csrf)}`);
    console.log(`# X-02 observation: TOTP secret readable in the database file = ${blob.includes(h.totpSecret!)}`);
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ lockout and rate limit as denial of service
test("X-03 lock durations: none below 5 failures, then escalating; correct login resets the count (durations printed)", async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) assert.equal((await wrongPassword(h)).status, 401, `failure ${i + 1} must not lock`);
    for (let round = 0; round < 9; round++) {
      let locked = null as null | { retry: number };
      for (let i = 0; i < 8 && !locked; i++) { const r = await wrongPassword(h); if (r.status === 429) locked = { retry: Number(r.json["retryAfterSeconds"]) }; }
      assert.ok(locked, "never locked");
      seen.push(locked.retry);
      const own = await h.login({ code: totp(h.totpSecret!, h.now()) });
      assert.equal(own.status, 429, "the owner's CORRECT credentials must be refused while locked");
      await h.advance((locked.retry + 1) * 1000);
    }
    console.log(`# X-03 observed lock lengths (seconds, each after one more failure at expiry): ${seen.join(", ")}`);
    assert.ok(seen[0]! >= 1);
    assert.ok(seen.at(-1)! >= seen[0]!, "lock does not grow");
    // After the lock the owner gets in and the count resets.
    await h.advance(31_000);
    const ok = await h.login({ code: totp(h.totpSecret!, h.now()) });
    assert.equal(ok.ok, true, `owner could not log in after the last lock (${ok.status} ${ok.code})`);
    for (let i = 0; i < 4; i++) assert.equal((await wrongPassword(h)).status, 401, "after a successful login the failure count must restart");
  } finally { await h.close(); }
});

test("X-04 DoS: an anonymous caller with NO credentials can lock the owner out (5 wrong passwords), from several addresses", async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    for (let i = 0; i < 6; i++) await wrongPassword(h, `198.51.100.${i + 1}`);
    const own = await h.login({ code: totp(h.totpSecret!, h.now()) });
    console.log(`# X-04 owner login after 6 anonymous failures from 6 addresses: ${own.status} ${own.code}`);
    assert.equal(own.status, 429);
  } finally { await h.close(); }
});

test("X-14b restarting the API (new setup token on the same database) recovers an abandoned enrolment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tester-auth-"));
  const path = join(dir, "auth.db");
  try {
    const a = await AuthBinding.create({ wiring: "isolated", storePath: path });
    const t1 = await a.setupToken();
    assert.equal((await a.raw("POST", "/api/auth/setup", { body: { setupToken: t1, username: USERNAME, password: PASSWORD }, headers: HDR })).status, 200);
    await a.close();
    const b = await AuthBinding.create({ wiring: "isolated", storePath: path });
    try {
      const t2 = await b.setupToken();
      assert.notEqual(t1, t2, "a restart must issue a new token");
      assert.equal((await b.setup({ token: t2 })).ok, true, "enrolment must work after a restart");
    } finally { await b.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("X-05 DoS: the global auth rate limit (10 POSTs/min, before validation) lets an anonymous caller block the owner's login", { todo: "reported: D-A1" }, async () => {
  const h = await AuthBinding.create({ wiring: "full" });
  try {
    const r = await h.setup({ token: await h.setupToken() });
    assert.equal(r.ok, true);
    await h.advance(61_000); // fresh window
    for (let i = 0; i < 10; i++) await garbage(h); // no credentials, empty body
    const own = await h.login({ code: totp(h.totpSecret!, h.now()) });
    assert.equal(own.ok, true, `owner blocked by anonymous garbage: ${own.status} ${own.code}`);
  } finally { await h.close(); }
});

test("X-05b the 11th auth POST in a minute is RATE_LIMITED with Retry-After, and the window then recovers", async () => {
  const h = await AuthBinding.create({ wiring: "full" });
  try {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await garbage(h)).status);
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(400));
    assert.equal(codes[10], 429);
    const r = await garbage(h);
    assert.equal(r.json["error"], "RATE_LIMITED");
    assert.ok(Number(r.headers["retry-after"]) >= 1, "Retry-After missing");
    await h.advance(61_000);
    assert.equal((await garbage(h)).status, 400, "limiter did not recover after the window");
  } finally { await h.close(); }
});

// ------------------------------------------------------------------ recovery codes
test("X-06 recovery codes: ten, single use, need the password step, refused while locked, never logged", async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    assert.equal(h.recoveryCodes.length, 10);
    assert.equal(new Set(h.recoveryCodes).size, 10, "recovery codes repeat");
    assert.ok(h.recoveryCodes.every((c) => c.length >= 10), "a recovery code is shorter than 10 characters");
    const [a, b, c] = h.recoveryCodes as [string, string, string];
    assert.equal((await h.loginWithRecoveryCode(a)).ok, true, "first use");
    const again = await h.loginWithRecoveryCode(a);
    assert.equal(again.ok, false, "second use of the same recovery code must be refused");
    const noTicket = await h.raw("POST", "/api/auth/totp", { body: { recoveryCode: b }, headers: HDR });
    assert.equal(noTicket.status, 401, "a recovery code without the password step must not work");
    for (let i = 0; i < 6; i++) await wrongPassword(h);
    assert.equal((await h.loginWithRecoveryCode(c)).status, 429, "recovery code must be refused while locked");
    const log = h.logText();
    assert.deepEqual(h.recoveryCodes.filter((x) => log.includes(x)), [], "a recovery code reached the log");
  } finally { await h.close(); }
});

// ------------------------------------------------------------------ enumeration
test("X-07 wrong username and wrong password: same answer and similar time", async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    const a: number[] = [], b: number[] = [];
    let bodyA = "", bodyB = "", stA = 0, stB = 0;
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 3; i++) {
        let t0 = performance.now();
        const u = await h.raw("POST", "/api/auth/login", { body: { username: "someone-else", password: PASSWORD }, headers: HDR });
        a.push(performance.now() - t0); bodyA = u.text; stA = u.status;
        t0 = performance.now();
        const p = await wrongPassword(h);
        b.push(performance.now() - t0); bodyB = p.text; stB = p.status;
      }
      await h.advance(31_000);
      assert.equal((await h.login({ code: totp(h.totpSecret!, h.now()) })).ok, true, "reset by a good login");
    }
    assert.equal(stA, stB); assert.equal(bodyA, bodyB, "wrong username and wrong password answer differently");
    const ma = median(a), mb = median(b);
    console.log(`# X-07 median ms: wrong username ${ma.toFixed(1)}, wrong password ${mb.toFixed(1)}`);
    assert.ok(Math.max(ma, mb) / Math.min(ma, mb) < 1.5, `timing differs (${ma.toFixed(1)} vs ${mb.toFixed(1)} ms)`);
  } finally { await h.close(); }
});

// ------------------------------------------------------------------ tickets and races
test("X-08 five concurrent logins presenting the same valid code: exactly one succeeds", async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    const tickets: string[] = [];
    for (let i = 0; i < 5; i++) { const r = await h.raw("POST", "/api/auth/login", { body: { username: USERNAME, password: PASSWORD }, headers: HDR }); tickets.push(r.set.find((c) => c.name === "servrsit_mfa")!.value); }
    const code = totp(h.totpSecret!, h.now());
    const rs = await Promise.all(tickets.map((t) => h.raw("POST", "/api/auth/totp", { body: { code }, cookies: { servrsit_mfa: t }, headers: HDR })));
    assert.equal(rs.filter((r) => r.status === 200).length, 1, `${rs.filter((r) => r.status === 200).length} of 5 accepted the same code`);
  } finally { await h.close(); }
});

test("X-09 a second-factor ticket is single use, and a ticket from one login cannot be used after the code step succeeded", async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    const l = await h.raw("POST", "/api/auth/login", { body: { username: USERNAME, password: PASSWORD }, headers: HDR });
    const t = l.set.find((c) => c.name === "servrsit_mfa")!.value;
    assert.equal((await h.raw("POST", "/api/auth/totp", { body: { code: totp(h.totpSecret!, h.now()) }, cookies: { servrsit_mfa: t }, headers: HDR })).status, 200);
    await h.advance(31_000);
    const second = await h.raw("POST", "/api/auth/totp", { body: { code: totp(h.totpSecret!, h.now()) }, cookies: { servrsit_mfa: t }, headers: HDR });
    assert.equal(second.status, 401, "the used ticket produced another session");
    const expired = await h.raw("POST", "/api/auth/login", { body: { username: USERNAME, password: PASSWORD }, headers: HDR });
    const t2 = expired.set.find((c) => c.name === "servrsit_mfa")!.value;
    await h.advance(5 * MIN + 1000);
    assert.equal((await h.raw("POST", "/api/auth/totp", { body: { code: totp(h.totpSecret!, h.now()) }, cookies: { servrsit_mfa: t2 }, headers: HDR })).status, 401, "ticket must expire after 5 minutes");
  } finally { await h.close(); }
});

// ------------------------------------------------------------------ the guard
test("X-10 no session: path variants, HEAD and OPTIONS never return fleet or care data", async () => {
  const h = await AuthBinding.create({ wiring: "full" });
  try {
    const paths = ["/api/fleet", "/api/fleet/", "/api/fleet?x=1", "/api//fleet", "/api/%66leet", "/api/./fleet", "/api/auth/../fleet", "/api/auth/login/../../fleet", "/api/fleet;x", "/api/fleet%2f", "/api/FLEET", "/api/plans", "/api/servers", "/api/csrf", "/api/assistant/messages"];
    const leaks: string[] = [];
    for (const m of ["GET", "HEAD", "OPTIONS"]) for (const p of paths) {
      const r = await h.injectRaw({ method: m, url: p });
      if (r.statusCode === 200 && r.body.length > 0 && /"(servers|id|name|plans)"/.test(r.body)) leaks.push(`${m} ${p} -> ${r.statusCode}`);
      if (r.statusCode >= 500) leaks.push(`${m} ${p} -> ${r.statusCode} (server error)`);
    }
    assert.deepEqual(leaks, []);
    const s = await h.raw("GET", "/api/auth/session");
    assert.deepEqual(s.json, { authenticated: false }, "session probe without a cookie must say only authenticated:false");
    assert.equal((await h.raw("GET", "/api/csrf")).status, 401);
  } finally { await h.close(); }
});

test("X-11 malformed input: bad JSON, wrong content type, oversized body, odd types. Always a plain 4xx, never a stack trace or 5xx", async () => {
  const h = await AuthBinding.create({ wiring: "isolated" });
  try {
    const cases: Record<string, unknown>[] = [
      { payload: '{"username":', headers: { "content-type": "application/json", ...HDR } },
      { payload: "username=a&password=b", headers: { "content-type": "application/x-www-form-urlencoded", ...HDR } },
      { payload: "x".repeat(5000), headers: { "content-type": "application/json", ...HDR } },
      { payload: JSON.stringify({ username: "a".repeat(5000), password: "b" }), headers: { "content-type": "application/json", ...HDR } },
      { payload: "null", headers: { "content-type": "application/json", ...HDR } },
      { payload: "[]", headers: { "content-type": "application/json", ...HDR } },
      { payload: JSON.stringify({ username: ["a"], password: { $gt: "" } }), headers: { "content-type": "application/json", ...HDR } },
    ];
    for (const route of ["/api/auth/login", "/api/auth/setup", "/api/auth/totp", "/api/auth/setup/confirm"]) for (const c of cases) {
      const r = await h.injectRaw({ method: "POST", url: route, ...c });
      assert.ok(r.statusCode >= 400 && r.statusCode < 500, `${route}: got ${r.statusCode}`);
      assert.ok(!/\bat .*\(.*:\d+:\d+\)|node_modules|stack/i.test(r.body), `${route}: body looks like a stack trace`);
    }
  } finally { await h.close(); }
});

// ------------------------------------------------------------------ cookies
test("X-12 cookies: enrolment and second-factor cookies are HttpOnly, Strict, narrowly scoped; Secure follows configuration", async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    await h.login({ code: totp(h.totpSecret!, h.now()) });
    const by = (n: string) => h.allSetCookies.filter((c) => c.name === n && c.value);
    for (const n of ["servrsit_enrol", "servrsit_mfa", "servrsit_session"]) {
      const c = by(n)[0]!;
      assert.ok(c, `no ${n} cookie was set`);
      assert.equal(c.attrs["httponly"], true, `${n} HttpOnly`);
      assert.match(String(c.attrs["samesite"]), /strict/i, `${n} SameSite`);
      assert.ok(c.attrs["max-age"] !== undefined, `${n} has no Max-Age`);
    }
    assert.equal(by("servrsit_enrol")[0]!.attrs["path"], "/api/auth/setup");
    assert.equal(by("servrsit_mfa")[0]!.attrs["path"], "/api/auth");
    assert.equal(by("servrsit_session")[0]!.attrs["secure"], undefined, "over plain HTTP in dev Secure is off (observation)");
  } finally { await h.close(); }
  const s = await enrolled({ wiring: "isolated", secureCookies: true });
  try {
    await s.login({ code: totp(s.totpSecret!, s.now()) });
    assert.equal(s.allSetCookies.filter((c) => c.name === "servrsit_session" && c.value).every((c) => c.attrs["secure"] === true), true, "secureCookies:true must set Secure");
  } finally { await s.close(); }
});

// ------------------------------------------------------------------ setup edge cases
test("X-13 a too-short password is refused without using up the setup token", async () => {
  const h = await AuthBinding.create({ wiring: "isolated" });
  try {
    const token = await h.setupToken();
    const r = await h.raw("POST", "/api/auth/setup", { body: { setupToken: token, username: USERNAME, password: "short" }, headers: HDR });
    assert.equal(r.status, 400);
    assert.equal((await h.setup({ token })).ok, true, "the token was consumed by a request that failed validation");
  } finally { await h.close(); }
});

test("X-14 an abandoned enrolment (closed the tab at the QR code) can be retried without restarting the API", { todo: "reported: D-A4" }, async () => {
  const h = await AuthBinding.create({ wiring: "isolated" });
  try {
    const token = await h.setupToken();
    const a = await h.raw("POST", "/api/auth/setup", { body: { setupToken: token, username: USERNAME, password: PASSWORD }, headers: HDR });
    assert.equal(a.status, 200, "premise");
    await h.advance(16 * MIN); // enrolment ticket (15 min) expired
    const retry = await h.raw("POST", "/api/auth/setup", { body: { setupToken: token, username: USERNAME, password: PASSWORD }, headers: HDR });
    console.log(`# X-14 retry after the 15-minute enrolment window: ${retry.status} ${retry.json["error"] ?? ""}`);
    assert.equal(retry.status, 200, `owner is stuck: ${retry.status} ${retry.json["error"]}`);
  } finally { await h.close(); }
});

// ------------------------------------------------------------------ clock skew (Merauke is +7 h, unsynced)
const SKEW = 7 * HOUR;

test("X-15 CLOCK: a code from a clock 7 h behind or ahead of the server is refused (the owner's phone vs Merauke)", async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    const secret = h.totpSecret!;
    const behind = await h.login({ code: totp(secret, h.now() - SKEW) });
    assert.equal(behind.ok, false, "server accepted a code from a clock 7 h behind");
    const ahead = await h.login({ code: totp(secret, h.now() + SKEW) });
    assert.equal(ahead.ok, false);
    assert.equal((await h.login({ code: totp(secret, h.now()) })).ok, true, "control: a code at the server's own time works");
  } finally { await h.close(); }
});

test("X-16 CLOCK: enrolment itself cannot be confirmed with a correct phone while the server clock is 7 h fast", async () => {
  const h = await AuthBinding.create({ wiring: "isolated" });
  try {
    const start = await h.raw("POST", "/api/auth/setup", { body: { setupToken: await h.setupToken(), username: USERNAME, password: PASSWORD }, headers: HDR });
    const secret = String(start.json["totpSecret"]);
    const ticket = start.set.find((c) => c.name === "servrsit_enrol")!.value;
    const trueTime = h.now() - SKEW; // the phone is right, the server is fast
    const r = await h.raw("POST", "/api/auth/setup/confirm", { body: { code: totp(secret, trueTime) }, cookies: { servrsit_enrol: ticket }, headers: HDR });
    console.log(`# X-16 confirm with the phone's (correct) code on a server 7 h fast: ${r.status} ${r.json["error"] ?? ""}`);
    assert.equal(r.status, 401, "expected refusal: this documents that the owner cannot enrol on Merauke until its clock is fixed");
  } finally { await h.close(); }
});

test("X-17 CLOCK: after the server clock is corrected backwards by 7 h, the owner can still log in with a current code", { todo: "reported: D-A5" }, async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    assert.equal((await h.login({ code: totp(h.totpSecret!, h.now()) })).ok, true, "premise: login while the clock is fast");
    await h.advance(-SKEW); // NTP fixes the clock
    await h.advance(31_000);
    const r = await h.login({ code: totp(h.totpSecret!, h.now()) });
    assert.equal(r.ok, true, `owner refused after the clock was corrected: ${r.status} ${r.code} (last accepted step is 7 h in the future)`);
  } finally { await h.close(); }
});

test("X-17b CLOCK: how long the step-back lock-out lasts, and what gets the owner in (measured)", async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    await h.login({ code: totp(h.totpSecret!, h.now()) });
    await h.advance(-SKEW); await h.advance(31_000);
    assert.equal((await h.login({ code: totp(h.totpSecret!, h.now()) })).ok, false, "premise: stuck right after the step back");
    const viaRecovery = await h.loginWithRecoveryCode(h.recoveryCodes[0]!);
    console.log(`# X-17b recovery code while stuck: ${viaRecovery.status} ${viaRecovery.ok ? "ok" : viaRecovery.code}`);
    assert.equal(viaRecovery.ok, true, "a recovery code must still work");
    let minutes = 0;
    while (minutes < 8 * 60) { await h.advance(MIN); minutes++; const r = await h.login({ code: totp(h.totpSecret!, h.now()) }); if (r.ok) break; }
    console.log(`# X-17b TOTP logins stayed refused for about ${(minutes / 60).toFixed(1)} h after the clock was corrected`);
    assert.ok(minutes < 8 * 60, "never recovered inside 8 h");
  } finally { await h.close(); }
});

test("X-18 CLOCK: a lock set while the clock was fast does not outlast the real lock after the clock is corrected", { todo: "reported: D-A5" }, async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    for (let i = 0; i < 6; i++) await wrongPassword(h);
    await h.advance(-SKEW);
    await h.advance(2 * MIN); // far longer than the 30 s lock
    const r = await h.login({ code: totp(h.totpSecret!, h.now()) });
    assert.equal(r.ok, true, `still locked 2 min after a 30 s lock: ${r.status} ${r.code}`);
  } finally { await h.close(); }
});

test("X-19 CLOCK: an idle session still ends 60 minutes after its last use even if the clock is corrected backwards", { todo: "reported: D-A5" }, async () => {
  const h = await enrolled({ wiring: "isolated" });
  try {
    const s = (await h.login({ code: totp(h.totpSecret!, h.now()) })).data!;
    await h.advance(-SKEW);
    await h.advance(2 * HOUR);
    const r = await h.call({ method: "GET", path: h.protectedGet, session: s });
    assert.equal(r.status, 401, "a session idle for 2 hours is still valid after a clock step back");
  } finally { await h.close(); }
});
