/**
 * Guards for T-066 (owner login: rate limit per source, trusted devices, per-source and account lockout,
 * clock-step safety, restartable setup, enrolment refused while ServrSit's clock is untrusted).
 * Written from ADR-017 "Amended by T-066" and the handoff, then run against the code.
 * Each test says which decision it holds the product to. Nothing here is copied from Coder's own tests.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthBinding, ORIGIN, PASSWORD, USERNAME } from "./binding.mts";
import { totp } from "./support/totp.mts";
import { HOUR, MIN } from "./support/contract.mts";

const HDR = { origin: ORIGIN };
const DEVICE = "servrsit_device";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const forged = () => randomBytes(32).toString("base64url");

async function enrolled(opts: Parameters<typeof AuthBinding.create>[0] = { wiring: "isolated" }) {
  const h = await AuthBinding.create(opts); const r = await h.setup({ token: await h.setupToken() }); assert.equal(r.ok, true, "premise: setup works"); return h;
}
const wrong = (h: AuthBinding, client?: string, cookies?: Record<string, string>) =>
  h.raw("POST", "/api/auth/login", { body: { username: USERNAME, password: "wrong-password-0000-xyz" }, headers: HDR, ...(client ? { client } : {}), ...(cookies ? { cookies } : {}) });
/** Two-step sign-in with full control of address and cookies. Uses a fresh TOTP code unless a recovery code is given. */
async function signIn(h: AuthBinding, o: { client?: string; cookies?: Record<string, string>; recovery?: string } = {}) {
  const l = await h.raw("POST", "/api/auth/login", { body: { username: USERNAME, password: PASSWORD }, headers: HDR, ...(o.client ? { client: o.client } : {}), ...(o.cookies ? { cookies: o.cookies } : {}) });
  if (l.status >= 300) return { ok: false, status: l.status, json: l.json, set: l.set, headers: l.headers };
  const ticket = l.set.find((c) => c.name === "servrsit_mfa")!.value;
  const t = await h.raw("POST", "/api/auth/totp", { body: o.recovery ? { recoveryCode: o.recovery } : { code: totp(h.totpSecret!, h.now()) }, cookies: { ...(o.cookies ?? {}), servrsit_mfa: ticket }, headers: HDR, ...(o.client ? { client: o.client } : {}) });
  return { ok: t.status === 200, status: t.status, json: t.json, set: t.set, headers: t.headers };
}
const deviceOf = (h: AuthBinding): string => { const c = [...h.allSetCookies].reverse().find((x) => x.name === DEVICE && x.value); assert.ok(c, "no trusted-device cookie was ever set"); return c!.value; };

// ------------------------------------------------------------------------------------ the forged-cookie question
test("T66-01 inventing a trusted-device cookie never buys a fresh allowance: rotating fake values from one address is still locked at the 5th failure", async () => {
  const h = await enrolled();
  try {
    let accepted = 0, locked = 0;
    for (let i = 0; i < 40; i++) { const r = await wrong(h, "198.51.100.5", { [DEVICE]: forged() }); if (r.status === 401) accepted++; else if (r.status === 429) locked++; else assert.fail(`status ${r.status}`); }
    assert.ok(accepted <= 6, `${accepted} guesses were processed from one address by rotating fake device cookies`); assert.ok(locked >= 34);
    const own = await signIn(h, { client: "198.51.100.5", cookies: { [DEVICE]: forged() } });
    assert.equal(own.status, 429, "a fake device cookie let a locked source sign in");
  } finally { await h.close(); }
});

test("T66-02 a fake device cookie does not exempt anyone from the account lock", async () => {
  const h = await enrolled();
  try {
    for (let i = 0; i < 25; i++) await wrong(h, `198.51.100.${i + 10}`);
    const r = await signIn(h, { client: "203.0.113.9", cookies: { [DEVICE]: forged() } });
    assert.equal(r.status, 429, `a fake device cookie got past the account lock: ${r.status}`);
  } finally { await h.close(); }
});

// ------------------------------------------------------------------------------------ D-A2 lockout
test("T66-03 per-source lock: 5 failures lock that address only; a fresh address still signs in (decision: no anonymous lock-out)", async () => {
  const h = await enrolled();
  try {
    for (let i = 0; i < 4; i++) assert.equal((await wrong(h, "198.51.100.5")).status, 401, `failure ${i + 1} must not lock yet`);
    assert.ok([401, 429].includes((await wrong(h, "198.51.100.5")).status), "the 5th failure may report the lock it causes");
    const same = await signIn(h, { client: "198.51.100.5" }); assert.equal(same.status, 429, "the locked source can still sign in"); assert.equal(same.json["error"], "LOCKED_OUT");
    const retry = Number(same.headers["retry-after"]); assert.ok(retry >= 1 && retry <= 31, `first lock is ${retry} s`);
    const other = await signIn(h, { client: "203.0.113.9" }); assert.equal(other.ok, true, `another address was locked by this one: ${other.status}`);
    const nocookie = await signIn(h, { client: "198.51.100.5", cookies: {} }); assert.equal(nocookie.status, 429, "dropping cookies lifted the per-source lock");
  } finally { await h.close(); }
});

test("T66-04 account lock: one failure when it expires does not re-lock the account (the old DoS); per-source relock at expiry is documented behaviour; one address's guess rate stays bounded over an hour", async () => {
  const h = await enrolled();
  try {
    // a) per-source: a failure right after the lock ends locks THAT source again with the next length. The handoff wording says otherwise; see the report.
    for (let i = 0; i < 5; i++) await wrong(h, "198.51.100.5"); await h.advance(31_000);
    const relock = (await wrong(h, "198.51.100.5")).status; console.log(`# T66-04 one failure at per-source expiry: ${relock} (429 = relocked; it affects only that address)`);
    assert.equal((await signIn(h, { client: "203.0.113.9" })).ok, true, "a per-source relock leaked to another address"); await h.advance(31_000);
    // b) account: one failure at account-lock expiry must not re-lock the account
    for (let i = 0; i < 21; i++) await wrong(h, `192.0.2.${i + 2}`);
    const locked = await signIn(h, { client: "203.0.113.10" }); assert.equal(locked.status, 429); await h.advance((Number(locked.headers["retry-after"]) + 2) * 1000);
    assert.equal((await wrong(h, "192.0.2.200")).status, 401, "the single failure at expiry was refused as locked");
    assert.equal((await signIn(h, { client: "203.0.113.11" })).ok, true, "ONE anonymous failure at expiry re-locked the owner out: the original denial of service");
    // c) one address trying whenever the door is open, for an hour
    let processed = 0; for (let t = 0; t < 3600; t += 10) { const r = await wrong(h, "198.51.100.77"); if (r.status === 401) processed++; await h.advance(10_000); }
    console.log(`# T66-04 guesses one address got processed in 1 hour: ${processed}`); assert.ok(processed <= 60, `${processed} guesses in an hour from one address`);
  } finally { await h.close(); }
});

test("T66-05 account lock: 20 failures from many addresses lock an untrusted address even with the right credentials; it lasts about 15 minutes and then ends", async () => {
  const h = await enrolled();
  try {
    for (let i = 0; i < 19; i++) await wrong(h, `198.51.100.${i + 10}`);
    assert.equal((await signIn(h, { client: "203.0.113.9" })).ok, true, "19 failures must not lock the account"); await h.advance(31_000);
    for (let i = 0; i < 20; i++) await wrong(h, `192.0.2.${i + 10}`);
    const blocked = await signIn(h, { client: "203.0.113.10" }); assert.equal(blocked.status, 429); assert.equal(blocked.json["error"], "LOCKED_OUT");
    const secs = Number(blocked.headers["retry-after"]); console.log(`# T66-05 first account lock: ${secs} s`); assert.ok(secs > 600 && secs <= 960, `first account lock is ${secs} s`);
    await h.advance((secs + 2) * 1000); assert.equal((await signIn(h, { client: "203.0.113.10" })).ok, true, "the account lock did not end");
  } finally { await h.close(); }
});

test("T66-06 account lock escalates and is capped at 4 hours; the owner's own sign-in on a trusted device resets it", async () => {
  const h = await enrolled(); const lengths: number[] = [];
  try {
    const dev = deviceOf(h);
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 21; i++) await wrong(h, `192.0.2.${(round * 21 + i) % 250 + 2}`);
      const r = await signIn(h, { client: "203.0.113.200" }); assert.equal(r.status, 429, `round ${round}`); const secs = Number(r.headers["retry-after"]); lengths.push(secs); await h.advance((secs + 2) * 1000);
    }
    console.log(`# T66-06 account lock lengths (s): ${lengths.join(", ")}`);
    assert.ok(lengths[1]! > lengths[0]!, "the second account lock is not longer"); assert.ok(Math.max(...lengths) <= 4 * 3600 + 60, `a lock longer than 4 h: ${Math.max(...lengths)}`);
    for (let i = 0; i < 21; i++) await wrong(h, `192.0.2.${i + 2}`);
    assert.equal((await signIn(h, { client: "203.0.113.200" })).status, 429, "premise: locked again");
    await h.advance(31_000); const own = await signIn(h, { client: "203.0.113.201", cookies: { [DEVICE]: dev } }); assert.equal(own.ok, true, `the owner's trusted device is blocked by the account lock: ${own.status}`);
    await h.advance(31_000); // the trusted sign-in used this step's code; a replay would be refused for the wrong reason
    assert.equal((await signIn(h, { client: "203.0.113.250" })).ok, true, "the owner's sign-in did not reset the account lock");
  } finally { await h.close(); }
});

test("T66-07 a trusted device is exempt from the ACCOUNT lock but not from its own per-source lock", async () => {
  const h = await enrolled();
  try {
    const dev = deviceOf(h);
    let processed = 0; for (let i = 0; i < 30; i++) { const r = await wrong(h, "203.0.113.77", { [DEVICE]: dev }); if (r.status === 401) processed++; }
    assert.ok(processed <= 6, `a trusted device could guess ${processed} times in a row: it must still be rate-locked itself`);
    await h.advance(HOUR); assert.equal((await signIn(h, { client: "203.0.113.77", cookies: { [DEVICE]: dev } })).ok, true, "the device is still locked an hour later");
  } finally { await h.close(); }
});

// ------------------------------------------------------------------------------------ trusted device cookie
test("T66-08 the trusted-device cookie: only after a full sign-in, HttpOnly, SameSite=Strict, path /api/auth, about 90 days, opaque; stored only as a hash; never logged; at most 20 kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tester-auth-")); const path = join(dir, "auth.db");
  const h = await enrolled({ wiring: "isolated", storePath: path });
  try {
    const setBefore = h.allSetCookies.filter((c) => c.name === DEVICE && c.value).length;
    await wrong(h, "198.51.100.9"); await h.raw("POST", "/api/auth/login", { body: { username: USERNAME, password: PASSWORD }, headers: HDR, client: "198.51.100.9" });
    assert.equal(h.allSetCookies.filter((c) => c.name === DEVICE && c.value).length, setBefore, "a device cookie was set before the second factor was passed");
    await h.advance(31_000); const ok = await signIn(h, { client: "198.51.100.9" }); assert.equal(ok.ok, true);
    const c = ok.set.find((x) => x.name === DEVICE)!; assert.ok(c, "no device cookie after a full sign-in");
    assert.equal(c.attrs["httponly"], true); assert.match(String(c.attrs["samesite"]), /strict/i); assert.equal(c.attrs["path"], "/api/auth");
    const days = Number(c.attrs["max-age"]) / 86400; assert.ok(days >= 80 && days <= 95, `device cookie lives ${days} days`); assert.ok(c.value.length >= 32, "device cookie is short");
    const blob = readdirSync(dir).filter((f) => f.startsWith("auth.db")).map((f) => readFileSync(join(dir, f)).toString("latin1")).join("\n");
    assert.ok(!blob.includes(c.value), "the device cookie is stored in plaintext"); assert.ok(!h.logText().includes(c.value), "the device cookie was logged");
    const first = deviceOf(h); assert.equal(h.authStore.isTrustedDevice(sha256(first)), true);
    for (let i = 0; i < 24; i++) { await h.advance(31_000); const r = await signIn(h, { client: `203.0.113.${i + 20}` }); assert.equal(r.ok, true, `sign-in ${i}`); }
    const kept = h.allSetCookies.filter((x) => x.name === DEVICE && x.value).map((x) => x.value).filter((v, i, a) => a.indexOf(v) === i).filter((v) => h.authStore.isTrustedDevice(sha256(v))).length;
    assert.ok(kept <= 20, `${kept} trusted devices kept`); assert.equal(h.authStore.isTrustedDevice(sha256(first)), false, "the oldest device was not the one dropped");
  } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------ D-A3 clock
test("T66-09 after a clock step back of 7 h: a ticket from before the step is dead, the recovery codes still work, and the TOTP code for the new time works", async () => {
  const h = await enrolled();
  try {
    const l = await h.raw("POST", "/api/auth/login", { body: { username: USERNAME, password: PASSWORD }, headers: HDR }); const ticket = l.set.find((c) => c.name === "servrsit_mfa")!.value;
    await h.advance(-7 * HOUR); await h.advance(31_000);
    const dead = await h.raw("POST", "/api/auth/totp", { body: { code: totp(h.totpSecret!, h.now()) }, cookies: { servrsit_mfa: ticket }, headers: HDR }); assert.equal(dead.status, 401, "a ticket created 7 h in the future of the corrected clock is still alive");
    assert.equal((await signIn(h, { recovery: h.recoveryCodes[0]! })).ok, true, "a recovery code failed after the step"); await h.advance(31_000);
    assert.equal((await signIn(h)).ok, true, "a TOTP code for the corrected time failed");
  } finally { await h.close(); }
});

test("T66-10 a small step back (10 minutes) costs at most that long on a lock (documented limit), not hours", async () => {
  const h = await enrolled();
  try {
    for (let i = 0; i < 5; i++) await wrong(h, "198.51.100.5");
    await h.advance(-10 * MIN); await h.advance(11 * MIN); const r = await signIn(h, { client: "198.51.100.5" });
    assert.equal(r.ok, true, `still locked after the 10-minute step plus 11 minutes: ${r.status}`);
  } finally { await h.close(); }
});

test("T66-11 enrolment is refused with CLOCK_UNTRUSTED (409) while ServrSit's clock is untrusted, the setup token survives, and it works once the clock is trusted", async () => {
  let trusted = false; const h = await AuthBinding.create({ wiring: "isolated", clockTrusted: () => trusted });
  try {
    const token = await h.setupToken();
    const r = await h.raw("POST", "/api/auth/setup", { body: { setupToken: token, username: USERNAME, password: PASSWORD }, headers: HDR });
    assert.equal(r.status, 409, `${r.status} ${r.text.slice(0, 80)}`); assert.equal(r.json["error"], "CLOCK_UNTRUSTED"); assert.ok(!r.text.includes(token), "the refusal echoed the setup token");
    const again = await h.raw("POST", "/api/auth/setup", { body: { setupToken: token, username: USERNAME, password: PASSWORD }, headers: HDR }); assert.equal(again.status, 409, "the refusal used up the token");
    trusted = true; const ok = await h.setup({ token }); assert.equal(ok.ok, true, `setup after the clock is trusted: ${ok.status} ${ok.code}`);
  } finally { await h.close(); }
});

test("T66-12 observation: addresses inside one IPv6 /64 are separate sources, so only the account lock bounds a rotating attacker", async () => {
  const h = await enrolled();
  try {
    let processed = 0; for (let i = 0; i < 30; i++) { const r = await wrong(h, `2001:db8:0:1::${(i + 1).toString(16)}`); if (r.status === 401) processed++; }
    console.log(`# T66-12 guesses processed from 30 addresses in one /64 before the account lock: ${processed} (the account lock is the backstop)`);
    assert.ok(processed <= 22, `${processed} processed: the account lock did not engage`);
  } finally { await h.close(); }
});
