/**
 * T-066: auth defects from test-report-ai-auth-001 §9.3 (D-A1 .. D-A4).
 * In-process through fastify.inject(); the clock is injected and can step backwards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTH_SESSION_COOKIE, AuthErrorSchema } from "@servrsit/contracts";
import { SqliteAuthStore } from "@servrsit/store";
import { buildServer } from "../server.js";
import { FleetConfigSchema } from "../fleet/config.js";
import { FleetService } from "../fleet/service.js";
import { makeObservation } from "../fleet/observation.fixtures.js";
import { OwnerAuth } from "./owner-auth.js";
import { DEVICE_COOKIE, MFA_COOKIE } from "./routes.js";
import { enrolOwner, setupTokenSink, TEST_ORIGIN, TEST_PASSWORD, TEST_USERNAME, totpCode } from "./testing.js";

const config = FleetConfigSchema.parse({
  healthIntervalMinutes: 15,
  hosts: [{ id: "11111111-1111-4111-a111-111111111111", name: "Alpha", access: "ssh", address: "alpha", port: 22, user: "spotty", role: null, production: true, collect: true }],
});
const MIN = 60_000;
const HOUR = 60 * MIN;
const SKEW = 7 * HOUR;
const OWNER_ADDR = "100.64.0.10";
const ATTACKER = "100.64.0.66";

class Clock {
  t = Date.parse("2026-11-18T10:00:10.000Z");
  now = () => this.t;
  advance(ms: number) { this.t += ms; }
}

async function start(opts: { store?: SqliteAuthStore } = {}) {
  const clock = new Clock();
  const sink = setupTokenSink();
  const fleet = new FleetService({ config, knownHostsFile: "/x/known_hosts", pinChecker: async () => "pinned", collector: async () => ({ ok: true, observation: makeObservation() }) });
  const app = await buildServer({
    config, fleetService: fleet, startChecks: false, ownerContextPath: null, logger: false,
    auth: { now: clock.now, onSetupToken: sink.onSetupToken, ...(opts.store === undefined ? {} : { store: opts.store }) },
  });
  const post = (url: string, payload: object, o: { address?: string | undefined; cookie?: string | undefined } = {}) =>
    app.inject({
      method: "POST", url, payload, remoteAddress: o.address ?? OWNER_ADDR,
      headers: { "content-type": "application/json", origin: TEST_ORIGIN, ...(o.cookie === undefined ? {} : { cookie: o.cookie }) },
    });
  const cookieOf = (r: { cookies: Array<{ name: string; value: string }> }, name: string) => r.cookies.find((c) => c.name === name)?.value;
  /** Full sign-in from `address`, optionally with a trusted-device cookie. */
  const signIn = async (secret: string, o: { address?: string; device?: string; password?: string; code?: string } = {}) => {
    const device = o.device === undefined ? undefined : `${DEVICE_COOKIE}=${o.device}`;
    const login = await post("/api/auth/login", { username: TEST_USERNAME, password: o.password ?? TEST_PASSWORD }, { address: o.address, cookie: device });
    const ticket = cookieOf(login, MFA_COOKIE);
    if (ticket === undefined) return { login, second: null, session: undefined as string | undefined, device: undefined as string | undefined };
    const second = await post("/api/auth/totp", { code: o.code ?? totpCode(secret, clock.t) }, {
      address: o.address, cookie: [`${MFA_COOKIE}=${ticket}`, ...(device === undefined ? [] : [device])].join("; "),
    });
    return { login, second, session: cookieOf(second, AUTH_SESSION_COOKIE), device: cookieOf(second, DEVICE_COOKIE) };
  };
  const owner = await enrolOwner(app, sink.token(), { now: clock.now });
  return { app, clock, post, signIn, owner, cookieOf };
}
const errorOf = (r: { json(): unknown }) => AuthErrorSchema.parse(r.json()).error;
const wrong = (h: Awaited<ReturnType<typeof start>>, address: string, cookie?: string) =>
  h.post("/api/auth/login", { username: TEST_USERNAME, password: "wrong-password-0000" }, { address, ...(cookie === undefined ? {} : { cookie }) });

// ---- D-A1: rate limit ------------------------------------------------------------------

test("T-066 D-A1 (X-05): invalid bodies are not counted, so 10 garbage POSTs do not block the owner", async () => {
  const h = await start();
  try {
    h.clock.advance(61_000);
    for (let i = 0; i < 12; i++) {
      const g = await h.app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: OWNER_ADDR, headers: { "content-type": "application/json", origin: TEST_ORIGIN }, payload: "{}" });
      assert.equal(g.statusCode, 400);
    }
    assert.ok((await h.signIn(h.owner.totpSecret)).session, "owner signs in after 12 garbage requests from the same address");
  } finally { await h.app.close(); }
});

test("T-066 D-A1: the limit is per source: an attacker's address runs out, the owner's address does not", async () => {
  const h = await start();
  try {
    h.clock.advance(61_000);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await h.post("/api/auth/login", { username: `x${i}`, password: "y" }, { address: ATTACKER })).statusCode);
    assert.equal(codes.includes(429), true, "the attacker's own address is limited");
    h.clock.advance(31 * MIN); // past the attacker's address lock too
    assert.ok((await h.signIn(h.owner.totpSecret)).session, "owner from another address is not affected");
  } finally { await h.app.close(); }
});

// ---- D-A2: lockout ------------------------------------------------------------------

test("T-066 D-A2: failures lock the failing address, not the owner's address or trusted device", async () => {
  const h = await start();
  try {
    h.clock.advance(31_000);
    const first = await h.signIn(h.owner.totpSecret); // establishes a trusted device for the owner
    assert.ok(first.device, "a full sign-in issues a trusted-device cookie");
    for (let i = 0; i < 6; i++) await wrong(h, ATTACKER);
    assert.equal(errorOf(await wrong(h, ATTACKER)), "LOCKED_OUT", "the attacker's address is locked");
    h.clock.advance(31_000);
    assert.ok((await h.signIn(h.owner.totpSecret, { address: OWNER_ADDR })).session, "owner's address is not locked");
    // Same address as the attacker, but with the owner's trusted device: its own allowance.
    h.clock.advance(31_000);
    assert.ok((await h.signIn(h.owner.totpSecret, { address: ATTACKER, device: first.device })).session, "trusted device signs in from the attacker's address");
  } finally { await h.app.close(); }
});

test("T-066 D-A2: the account locks only on sustained failures (20 in 15 min), for a fixed 15 min, and trusted devices are exempt", async () => {
  const h = await start();
  try {
    h.clock.advance(31_000);
    const device = (await h.signIn(h.owner.totpSecret)).device!;
    for (let i = 0; i < 20; i++) await wrong(h, `100.64.1.${i}`);
    const fresh = await h.post("/api/auth/login", { username: TEST_USERNAME, password: TEST_PASSWORD }, { address: "100.64.2.1" });
    assert.deepEqual([fresh.statusCode, errorOf(fresh)], [429, "LOCKED_OUT"], "an untrusted fresh address is held by the account lock");
    assert.ok(Number(fresh.headers["retry-after"]) <= 15 * 60);
    h.clock.advance(31_000);
    assert.ok((await h.signIn(h.owner.totpSecret, { device })).session, "the owner's trusted device is exempt from the account lock");
    // At expiry, one more failure does not re-lock the account (no doubling or holding at the cap).
    h.clock.advance(15 * MIN);
    await wrong(h, "100.64.3.1");
    h.clock.advance(31_000);
    assert.ok((await h.signIn(h.owner.totpSecret, { address: "100.64.2.2" })).session, "account lock ended and was not extended by one failure");
  } finally { await h.app.close(); }
});

// ---- D-A3 / D-A3b: clock steps and an untrusted clock --------------------------------------

test("T-066 D-A3 (X-17): after the clock is corrected back by 7 h, a current TOTP code still works", async () => {
  const h = await start();
  try {
    h.clock.advance(31_000);
    assert.ok((await h.signIn(h.owner.totpSecret)).session, "premise: sign-in while the clock is fast");
    h.clock.advance(-SKEW);
    h.clock.advance(31_000);
    assert.ok((await h.signIn(h.owner.totpSecret)).session, "the owner is not locked out of TOTP by the step back");
    // Replay protection still holds for the new step.
    const code = totpCode(h.owner.totpSecret, h.clock.t);
    h.clock.advance(1_000);
    assert.equal((await h.signIn(h.owner.totpSecret, { code })).session, undefined, "the same code cannot be used twice");
  } finally { await h.app.close(); }
});

test("T-066 D-A3b (X-18): a 30 s lock set before a 7 h step back ends 30 s later, not 7 h later", async () => {
  const h = await start();
  try {
    for (let i = 0; i < 5; i++) await wrong(h, OWNER_ADDR);
    assert.equal(errorOf(await wrong(h, OWNER_ADDR)), "LOCKED_OUT");
    h.clock.advance(-SKEW);
    h.clock.advance(2 * MIN);
    assert.ok((await h.signIn(h.owner.totpSecret)).session, "lock ended after its real length");
  } finally { await h.app.close(); }
});

test("T-066 D-A3b (X-19): an idle session ends 60 min after its last use even if the clock steps back", async () => {
  const h = await start();
  try {
    const get = () => h.app.inject({ method: "GET", url: "/api/fleet", headers: { cookie: h.owner.cookie } });
    assert.equal((await get()).statusCode, 200);
    h.clock.advance(-SKEW);
    h.clock.advance(2 * HOUR);
    assert.equal((await get()).statusCode, 401, "idle for 2 h of real time");
  } finally { await h.app.close(); }
});

test("T-066 D-A3b: after a restart on a corrected clock, sessions and locks stamped in the future do not survive", async () => {
  const store = new SqliteAuthStore({ path: ":memory:" });
  const h = await start({ store });
  try {
    for (let i = 0; i < 5; i++) await wrong(h, ATTACKER);
    // Restart: a new OwnerAuth on the same store, its clock 7 h earlier (the fix), no steady-clock memory.
    const auth = new OwnerAuth({ store, now: () => h.clock.t - SKEW + MIN });
    await auth.init();
    assert.equal(auth.resolve(h.owner.cookie.split("=")[1]), null, "a session last seen 7 h in the future ends");
    const r = await auth.login(TEST_USERNAME, TEST_PASSWORD, { address: ATTACKER });
    assert.equal(r.ok, true, "a lock 7 h in the future is ignored, not held for 7 h");
  } finally { await h.app.close(); }
});

test("T-066 D-A3: enrolment is refused while ServrSit's own clock is untrusted", async () => {
  let token = "";
  const auth = new OwnerAuth({ store: new SqliteAuthStore({ path: ":memory:" }), onSetupToken: (t) => { token = t; }, clockTrusted: () => false });
  await auth.init();
  const r = await auth.startSetup({ setupToken: token, username: TEST_USERNAME, password: TEST_PASSWORD });
  assert.deepEqual(r, { ok: false, error: "CLOCK_UNTRUSTED" });
  assert.deepEqual(auth.confirmSetup("A".repeat(43), "123456"), { ok: false, error: "CLOCK_UNTRUSTED" });
});

// ---- D-A4: abandoned enrolment ------------------------------------------------------------

test("T-066 D-A4 (X-14): an abandoned enrolment can be restarted with the same token; once confirmed the token is gone", async () => {
  let token = "";
  let t = Date.parse("2026-11-18T10:00:10.000Z");
  const auth = new OwnerAuth({ store: new SqliteAuthStore({ path: ":memory:" }), now: () => t, onSetupToken: (x) => { token = x; } });
  await auth.init();
  const req = { setupToken: token, username: TEST_USERNAME, password: TEST_PASSWORD };
  assert.equal((await auth.startSetup(req)).ok, true);
  t += 16 * MIN; // the enrolment ticket (15 min) expired: the owner closed the tab
  const retry = await auth.startSetup(req);
  assert.equal(retry.ok, true, "the same token restarts enrolment");
  if (!retry.ok) return;
  const done = auth.confirmSetup(retry.value.ticket, totpCode(retry.value.totpSecret, t));
  assert.equal(done.ok, true);
  assert.deepEqual(await auth.startSetup(req), { ok: false, error: "SETUP_UNAVAILABLE" }, "after confirmation the token no longer works");
});

test("T-066 D-A2: repeated account locks escalate (15, 30 min ...) until the owner signs in, which resets them", async () => {
  const h = await start();
  try {
    h.clock.advance(31_000);
    const device = (await h.signIn(h.owner.totpSecret)).device!;
    const burst = async (base: number) => { for (let i = 0; i < 20; i++) await wrong(h, `100.65.${base}.${i}`); };
    const retryAfter = async () => Number((await h.post("/api/auth/login", { username: TEST_USERNAME, password: TEST_PASSWORD }, { address: "100.66.0.1" })).headers["retry-after"]);
    await burst(1);
    assert.ok(Math.abs((await retryAfter()) - 15 * 60) <= 1, "first account lock: 15 min");
    h.clock.advance(15 * MIN + 1000);
    await burst(2);
    assert.ok(Math.abs((await retryAfter()) - 30 * 60) <= 1, "second account lock: 30 min");
    h.clock.advance(31_000);
    assert.ok((await h.signIn(h.owner.totpSecret, { device })).session, "trusted device still signs in");
    h.clock.advance(30 * MIN);
    await burst(3);
    assert.ok(Math.abs((await retryAfter()) - 15 * 60) <= 1, "after the owner's sign-in, the escalation starts again at 15 min");
  } finally { await h.app.close(); }
});
