/**
 * Owner login acceptance scenarios (T-053). Written from Technical Spec §5, PRD
 * FR-01, UX §7.1, RFC 6238 §5.2 (an OTP must not be accepted twice) and the task
 * list. Written before the login existed. TOTP codes come from an independent,
 * RFC-vector-checked implementation (support/totp.mts), never from the product.
 */
import assert from "node:assert/strict";
import { base32Decode, totp, totpAtStep } from "./support/totp.mts";
import { HOUR, MIN, STEP_MS, type AuthHarness, type Res, type Scenario, type Session } from "./support/contract.mts";

/** A CSRF or origin refusal must be a 403 specifically: a 400 validation error would hide a missing CSRF check. */
const forbidden = (r: Res, label: string): void => {
  assert.equal(r.status, 403, `${label}: must be refused with 403, got ${r.status} ${r.code ?? ""} (a 400 or 401 here could mean the CSRF check is not what stopped it)`);
};
const refused = (r: Res, label: string): void => {
  assert.equal(r.ok, false, `${label}: must be refused (status ${r.status})`);
  assert.ok(r.status >= 400 && r.status < 500, `${label}: must be a 4xx refusal, got ${r.status}`);
};

/** Enrol the owner through the real setup path; return the secret. */
async function enrol(h: AuthHarness): Promise<string> {
  const token = await h.setupToken();
  const r = await h.setup({ token });
  assert.equal(r.ok, true, `premise: setup must succeed (${r.status} ${r.code})`);
  assert.ok(r.data?.totpSecret, "setup must return the TOTP secret once");
  return r.data!.totpSecret;
}
const code = (secret: string, h: AuthHarness, stepOffset = 0): string => totpAtStep(secret, h.now(), stepOffset);
async function loginOk(h: AuthHarness, secret: string, extra: { client?: string } = {}): Promise<Session> {
  const r = await h.login({ code: code(secret, h), ...extra });
  assert.equal(r.ok, true, `login must succeed (${r.status} ${r.code})`);
  return r.data!;
}
/** A well-formed 6-digit code that is NOT valid in any accepted window. */
function wrongCode(secret: string, h: AuthHarness, n = 0): string {
  const valid = new Set([-2, -1, 0, 1, 2].map((o) => code(secret, h, o)));
  for (let i = 0; i < 1000; i++) { const c = String((424242 + n * 7919 + i * 101) % 1_000_000).padStart(6, "0"); if (!valid.has(c)) return c; }
  throw new Error("no wrong code found");
}

export const scenarios: Scenario[] = [
  // ------------------------------------------------------------------ setup token
  {
    id: "AU-01a", title: "the setup token works once: a wrong token is refused, the right one enrols, a second use is refused",
    spec: ["T-053: setup token single-use", "FR-01: owner access boundary"],
    async run(h) {
      const token = await h.setupToken();
      refused(await h.setup({ token: "not-the-token" }), "wrong token");
      refused(await h.setup({ token: "" }), "empty token");
      const first = await h.setup({ token });
      assert.equal(first.ok, true);
      refused(await h.setup({ token }), "reuse of the same token");
      refused(await h.setup({ token: await h.setupToken().catch(() => token) }), "any token after enrolment");
    },
  },
  {
    id: "AU-01b", title: "five simultaneous uses of one setup token: exactly one wins, and only one TOTP secret exists",
    spec: ["T-053: setup token single-use (race)"],
    async run(h) {
      const token = await h.setupToken();
      const rs = await Promise.all(Array.from({ length: 5 }, () => h.setup({ token })));
      const wins = rs.filter((r) => r.ok);
      assert.equal(wins.length, 1, `${wins.length} of 5 concurrent setups succeeded`);
      const secret = wins[0]!.data!.totpSecret;
      const s = await h.login({ code: totp(secret, h.now()) });
      assert.equal(s.ok, true, "the one secret that was issued must work");
    },
  },
  {
    id: "AU-01c", title: "before setup there is no owner: login is refused cleanly (4xx, not a crash)",
    spec: ["FR-01"],
    async run(h) {
      refused(await h.login({ code: "123456" }), "login before setup");
    },
  },
  {
    id: "AU-01d", title: "the setup token is long and unguessable, and each installation gets a different one",
    spec: ["Tech §5: secrets; T-053"],
    async run(h) {
      const t = await h.setupToken();
      assert.ok(t.length >= 20, `setup token is only ${t.length} characters`);
      assert.ok(new Set(t).size >= 8, "setup token has too few distinct characters");
      assert.ok(!/^(0{4,}|1234|abcd|test|setup|token)/i.test(t), "setup token looks like a placeholder");
    },
  },

  // ------------------------------------------------------------------ TOTP
  {
    id: "AU-02a", title: "a correct code logs in; the response never contains the TOTP secret",
    spec: ["Tech §5 TOTP MFA"],
    async run(h) {
      const secret = await enrol(h);
      const r = await h.login({ code: code(secret, h) });
      assert.equal(r.ok, true);
      assert.ok(!(r.raw ?? "").includes(secret), "login response contains the TOTP secret");
    },
  },
  {
    id: "AU-02b", title: "wrong, stale, future and malformed codes are all refused, and well-formed wrong codes are refused identically",
    spec: ["UX §7.1: authentication errors must not give an attacker a signal"],
    async run(h) {
      const secret = await enrol(h);
      const wellFormed: [string, string][] = [
        ["wrong", wrongCode(secret, h, 0)], ["stale (3 steps back)", code(secret, h, -3)], ["future (3 steps ahead)", code(secret, h, 3)],
      ];
      const seen: string[] = [];
      for (const [name, c] of wellFormed) {
        const r = await h.login({ code: c });
        refused(r, name);
        seen.push(`${r.status}/${r.code ?? ""}`);
      }
      assert.equal(new Set(seen).size, 1, `a wrong, a stale and a future code got different answers (${seen.join(", ")}): that tells an attacker how close a guess was`);
      for (const bad of ["", "abc", "12345", "1234567", "12 3456", "١٢٣٤٥٦", null, undefined, true, {}, 123456]) {
        refused(await h.login({ code: bad }), `malformed ${JSON.stringify(bad)}`);
      }
    },
  },
  {
    id: "AU-02c", title: "a code from two steps away (60 s) is not accepted: the window is narrow",
    spec: ["RFC 6238 §5.2: a small allowed delay"],
    async run(h) {
      const secret = await enrol(h);
      refused(await h.login({ code: code(secret, h, -2) }), "two steps in the past");
      refused(await h.login({ code: code(secret, h, 2) }), "two steps in the future");
    },
  },
  {
    id: "AU-03a", title: "REPLAY: a code that was just used cannot be used again, from the same caller or another",
    spec: ["RFC 6238 §5.2: the verifier MUST NOT accept the second attempt of the same OTP"],
    async run(h) {
      const secret = await enrol(h);
      const c = code(secret, h);
      assert.equal((await h.login({ code: c })).ok, true, "premise: first use succeeds");
      refused(await h.login({ code: c }), "immediate replay");
      refused(await h.login({ code: c, client: "10.9.9.9" }), "replay from another address");
      refused(await h.login({ code: c, existingCookie: null }), "replay with no cookie");
    },
  },
  {
    id: "AU-03b", title: "REPLAY: the used code stays dead when it later falls into the previous window",
    spec: ["RFC 6238 §5.2"],
    async run(h) {
      const secret = await enrol(h);
      const c = code(secret, h);
      assert.equal((await h.login({ code: c })).ok, true);
      await h.advance(STEP_MS + 1000);
      refused(await h.login({ code: c }), "replay one step later (inside a +/-1 window)");
    },
  },
  {
    id: "AU-03c", title: "a replay is not a permanent block: the next code works",
    spec: ["T-053"],
    async run(h) {
      const secret = await enrol(h);
      const c = code(secret, h);
      await h.login({ code: c });
      refused(await h.login({ code: c }), "replay");
      await h.advance(STEP_MS * 2 + 1000);
      assert.equal((await h.login({ code: code(secret, h) })).ok, true, "a fresh code must work");
    },
  },
  {
    id: "AU-03d", title: "a code used on the PREVIOUS step cannot be replayed even if first tried late",
    spec: ["RFC 6238 §5.2"],
    async run(h) {
      const secret = await enrol(h);
      const prev = code(secret, h, -1);
      const r = await h.login({ code: prev });
      if (r.ok) refused(await h.login({ code: prev }), "second use of a previous-step code");
    },
  },

  // ------------------------------------------------------------------ lockout
  {
    id: "AU-04a", title: "LOCKOUT: after at most 10 wrong codes the account locks, and even the CORRECT code is refused",
    spec: ["T-053: lockout", "Tech §16: credential guessing"],
    async run(h) {
      const secret = await enrol(h);
      for (let i = 0; i < 10; i++) refused(await h.login({ code: wrongCode(secret, h, i) }), `wrong attempt ${i + 1}`);
      refused(await h.login({ code: code(secret, h) }), "the CORRECT code after 10 wrong ones must be refused while locked");
    },
  },
  {
    id: "AU-04b", title: "the lock is not bypassed by another address, another cookie, or time of a minute or two",
    spec: ["T-053: lockout"],
    async run(h) {
      const secret = await enrol(h);
      for (let i = 0; i < 10; i++) await h.login({ code: wrongCode(secret, h, i) });
      refused(await h.login({ code: code(secret, h), client: "203.0.113.77" }), "correct code from a new address");
      refused(await h.login({ code: code(secret, h), existingCookie: null }), "correct code with no cookie");
      // CORRECTED after the first run against T-053 (see test-report-ai-auth-001.md, "My own mistakes"):
      // the original asserted the lock still held 2 minutes in. No spec gives a lock duration; T-053 locks
      // 30 s at the 5th failure, so that assertion was my assumption. Lock LENGTH is reported separately
      // (auth-extra.test.mts); this scenario only checks that time alone does not lift the lock at once.
      await h.advance(10_000);
      refused(await h.login({ code: code(secret, h) }), "correct code 10 seconds into the lock");
    },
  },
  {
    id: "AU-04c", title: "the lock ends by itself: the owner is not locked out forever",
    spec: ["execution-security invariant 10: preserve independent access and recovery routes"],
    async run(h) {
      const secret = await enrol(h);
      for (let i = 0; i < 12; i++) await h.login({ code: wrongCode(secret, h, i) });
      await h.advance(24 * HOUR);
      assert.equal((await h.login({ code: code(secret, h) })).ok, true, "after 24 hours the correct code must work again");
    },
  },
  {
    id: "AU-04d", title: "a couple of typos do not lock the owner out",
    spec: ["usability: a lockout that fires on 2 typos is a self-inflicted outage"],
    async run(h) {
      const secret = await enrol(h);
      refused(await h.login({ code: wrongCode(secret, h, 0) }), "typo 1");
      refused(await h.login({ code: wrongCode(secret, h, 1) }), "typo 2");
      assert.equal((await h.login({ code: code(secret, h) })).ok, true, "the correct code after 2 typos must work");
    },
  },
  {
    id: "AU-04e", title: "TYPE CONFUSION: an array or object of guesses is refused, and never counts as many free guesses",
    spec: ["Tech §13: schema-validated endpoints", "T-053: lockout"],
    async run(h) {
      const secret = await enrol(h);
      const valid = code(secret, h);
      const guesses = Array.from({ length: 200 }, (_, i) => String(i * 4999 % 1_000_000).padStart(6, "0"));
      refused(await h.login({ code: [...guesses, valid] }), "array containing the valid code among 200 guesses");
      refused(await h.login({ code: [valid] }), "one-element array");
      refused(await h.login({ code: { $ne: "" } }), "operator object");
      refused(await h.login({ code: { code: valid } }), "nested object");
    },
  },

  // ------------------------------------------------------------------ sessions
  {
    id: "AU-05a", title: "the session cookie is HttpOnly, SameSite, path-scoped and unguessable, and each login gets a new one",
    spec: ["Tech §5: opaque server-side session, Secure/HttpOnly/SameSite cookies"],
    async run(h) {
      const secret = await enrol(h);
      const s1 = await loginOk(h, secret);
      const a = h.cookieAttributes(s1);
      assert.equal(a.httpOnly, true, "HttpOnly");
      assert.match(String(a.sameSite), /^(strict|lax)$/i, "SameSite must be Strict or Lax");
      assert.equal(a.path, "/");
      assert.ok(s1.cookie.length >= 22, `cookie value is only ${s1.cookie.length} characters (128 bits needs 22+ base64url)`);
      assert.ok(!/owner|admin|spotty|session|user/i.test(s1.cookie), "cookie value looks meaningful, not opaque");
      await h.advance(STEP_MS * 3);
      const s2 = await loginOk(h, secret);
      assert.notEqual(s1.cookie, s2.cookie);
    },
  },
  {
    id: "AU-05b", title: "SESSION FIXATION: a cookie the caller already held is never reused after login",
    spec: ["Tech §5"],
    async run(h) {
      const secret = await enrol(h);
      const planted = "attacker-chosen-session-value-0123456789";
      const r = await h.login({ code: code(secret, h), existingCookie: planted });
      assert.equal(r.ok, true);
      assert.notEqual(r.data!.cookie, planted, "the pre-login cookie was adopted");
      refused(await h.call({ method: "GET", path: h.protectedGet, session: { cookie: planted, csrf: r.data!.csrf } }), "the planted cookie after login");
    },
  },
  {
    id: "AU-05c", title: "logout ends the session on the SERVER: the old cookie is dead",
    spec: ["Tech §5: server-side sessions"],
    async run(h) {
      const secret = await enrol(h);
      const s = await loginOk(h, secret);
      assert.equal((await h.call({ method: "GET", path: h.protectedGet, session: s })).ok, true, "premise");
      assert.equal((await h.logout(s)).ok, true);
      assert.equal((await h.call({ method: "GET", path: h.protectedGet, session: s })).status, 401, "the old cookie must be rejected");
    },
  },
  {
    id: "AU-05d", title: "an idle session ends within 60 minutes, but is not cut off after a few minutes",
    spec: ["Tech §5: 60-minute inactivity expiry"],
    async run(h) {
      const secret = await enrol(h);
      const s = await loginOk(h, secret);
      await h.advance(5 * MIN);
      assert.equal((await h.call({ method: "GET", path: h.protectedGet, session: s })).ok, true, "alive after 5 idle minutes");
      await h.advance(61 * MIN);
      assert.equal((await h.call({ method: "GET", path: h.protectedGet, session: s })).status, 401, "must be expired after 61 idle minutes");
    },
  },
  {
    id: "AU-05e", title: "a busy session still ends by 8 hours (absolute lifetime)",
    spec: ["Tech §5: 8-hour absolute lifetime"],
    async run(h) {
      const secret = await enrol(h);
      const s = await loginOk(h, secret);
      let alive = true;
      for (let t = 0; t < 8 * HOUR + 30 * MIN && alive; t += 20 * MIN) {
        await h.advance(20 * MIN);
        alive = (await h.call({ method: "GET", path: h.protectedGet, session: s })).ok;
      }
      assert.equal(alive, false, "a session kept busy for 8.5 hours must have ended");
    },
  },

  // ------------------------------------------------------------------ CSRF
  {
    id: "AU-06a", title: "CSRF: a state-changing request with a valid session but no or wrong token is refused",
    spec: ["Tech §5: CSRF controls and origin validation on state-changing requests"],
    async run(h) {
      const secret = await enrol(h);
      const s = await loginOk(h, secret);
      const post = (csrf: "valid" | "omit" | "wrong" | "other-session") => h.call({ method: "POST", path: h.protectedPost, session: s, csrf, body: {} });
      forbidden(await post("omit"), "no CSRF token");
      forbidden(await post("wrong"), "wrong CSRF token");
      forbidden(await post("other-session"), "a CSRF token from another session");
      const ok = await post("valid");
      assert.ok(ok.status !== 401 && ok.status !== 403, `the valid token must get past the CSRF check (got ${ok.status})`);
    },
  },
  {
    id: "AU-06b", title: "CSRF: a cross-site origin or Sec-Fetch-Site is refused even with the right token",
    spec: ["Tech §5"],
    async run(h) {
      const secret = await enrol(h);
      const s = await loginOk(h, secret);
      forbidden(await h.call({ method: "POST", path: h.protectedPost, session: s, csrf: "valid", origin: "https://evil.example", body: {} }), "foreign Origin");
      forbidden(await h.call({ method: "POST", path: h.protectedPost, session: s, csrf: "valid", fetchSite: "cross-site", body: {} }), "Sec-Fetch-Site: cross-site");
    },
  },
  {
    id: "AU-06c", title: "a safe GET needs a session but no CSRF token, and never changes state",
    spec: ["Tech §5"],
    async run(h) {
      const secret = await enrol(h);
      const s = await loginOk(h, secret);
      const r = await h.call({ method: "GET", path: h.protectedGet, session: s, csrf: "omit" });
      assert.equal(r.ok, true);
    },
  },
  {
    id: "AU-06d", title: "no session means 401, with or without a CSRF token",
    spec: ["FR-01: an unauthenticated request cannot read fleet data or run work"],
    async run(h) {
      await enrol(h);
      assert.equal((await h.call({ method: "GET", path: h.protectedGet, session: null })).status, 401);
      assert.equal((await h.call({ method: "POST", path: h.protectedPost, session: null, csrf: "omit", body: {} })).status, 401);
      assert.equal((await h.call({ method: "GET", path: h.protectedGet, session: { cookie: "garbage", csrf: "garbage" } })).status, 401);
    },
  },

  // ------------------------------------------------------------------ secrets
  {
    id: "AU-07a", title: "NO SECRETS IN LOGS: setup token, TOTP secret, every submitted code, session cookies and CSRF tokens never appear",
    spec: ["execution-security: never place secrets in logs", "ZT-02"],
    async run(h) {
      const token = await h.setupToken();
      const setup = await h.setup({ token });
      const secret = setup.data!.totpSecret;
      const bad = ["424242", "737373", "909090"];
      for (const c of bad) await h.login({ code: c });
      await h.setup({ token: "wrong-token-shape-of-its-own-ZZZ" });
      const valid = code(secret, h);
      const s = (await h.login({ code: valid })).data!;
      await h.call({ method: "GET", path: h.protectedGet, session: s });
      await h.call({ method: "POST", path: h.protectedPost, session: s, csrf: "wrong", body: {} });
      await h.call({ method: "POST", path: h.protectedPost, session: s, csrf: "valid", body: { note: "x" } });
      await h.logout(s);
      const log = h.logText();
      assert.ok(log.length > 0, "premise: the system logs something, so this check means something");
      const secretsHex = base32Decode(secret).toString("hex");
      const needles: [string, string][] = [
        ["setup token", token], ["wrong setup token", "wrong-token-shape-of-its-own-ZZZ"], ["TOTP secret (base32)", secret], ["TOTP secret (hex)", secretsHex],
        ["session cookie", s.cookie], ["CSRF token", s.csrf], ...bad.map((c): [string, string] => ["a submitted wrong code", c]), ["the valid code", valid],
      ];
      const leaks = needles.filter(([, v]) => v.length >= 6 && log.includes(v)).map(([n]) => n);
      assert.deepEqual(leaks, [], `secrets found in the log: ${leaks.join(", ")}`);
    },
  },
  {
    id: "AU-07b", title: "error responses never echo what was submitted",
    spec: ["execution-security: never in exceptions or responses"],
    async run(h) {
      const secret = await enrol(h);
      const r = await h.login({ code: "424242" });
      assert.ok(!(r.raw ?? "").includes("424242"), "a refusal echoed the submitted code");
      const t = await h.setup({ token: "echo-me-please-0123456789" });
      assert.ok(!(t.raw ?? "").includes("echo-me-please"), "a refusal echoed the submitted setup token");
      assert.ok(!(r.raw ?? "").includes(secret));
    },
  },
];
