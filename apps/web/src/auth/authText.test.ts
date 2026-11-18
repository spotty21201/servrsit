import { test } from "node:test";
import assert from "node:assert/strict";
import { authError, formatRetry, groupSecret, isPasswordAcceptable, normaliseTotp, passwordHint, recoveryFileText } from "./authText";
import { qrMatrix, qrPath } from "./qr";

const NOW = new Date("2026-11-17T07:00:00Z"); // 14:00 WIB
const TZ = "Asia/Jakarta";

test("wrong username and wrong password read the same; no wording says an account exists or not", () => {
  const e = authError({ kind: "INVALID_CREDENTIALS", status: 401 }, "password", NOW, TZ);
  assert.equal(e.text, "That username and password don't match. Check both and try again.");
  for (const kind of ["INVALID_CREDENTIALS", "MFA_REQUIRED", "LOCKED_OUT", "RATE_LIMITED", "INVALID_CODE", "SETUP_UNAVAILABLE"] as const) {
    const t = authError({ kind, retryAfterSeconds: 30 }, "password", NOW, TZ).text;
    assert.doesNotMatch(t, /no such|not found|doesn't exist|does not exist|unknown (user|account)|no account/i, kind);
  }
});

test("lockout says how long and at what time, in the owner zone", () => {
  const e = authError({ kind: "LOCKED_OUT", retryAfterSeconds: 150 }, "password", NOW, TZ);
  assert.equal(e.text, "Too many failed attempts. Try again in 2 min 30 s (at 14:02 WIB).");
  assert.equal(e.retryAt?.toISOString(), "2026-11-17T07:02:30.000Z");
  assert.equal(formatRetry(30), "30 s");
  assert.equal(formatRetry(900), "15 min");
});

test("an expired password step restarts the flow; network errors say nothing was changed", () => {
  assert.equal(authError({ kind: "MFA_REQUIRED" }, "totp", NOW, TZ).restart, true);
  assert.match(authError({ kind: "NETWORK" }, "password", NOW, TZ).text, /Nothing was changed/);
  assert.match(authError({ kind: "INVALID_CODE" }, "recovery", NOW, TZ).text, /works once/);
});

test("password hint is advice with the API's 12-character floor; no composition rules block", () => {
  assert.equal(passwordHint("").level, "empty");
  assert.equal(passwordHint("abc").text, "9 more characters needed (12 minimum).");
  assert.equal(passwordHint("aaaaaaaaaaaaaa").level, "short");
  assert.equal(passwordHint("correct horse battery").level, "good");
  assert.equal(passwordHint("twelve words").level, "ok");
  assert.equal(isPasswordAcceptable("a".repeat(11)), false);
  assert.equal(isPasswordAcceptable("a".repeat(12)), true);
  assert.equal(isPasswordAcceptable("a".repeat(257)), false);
});

test("secret grouping, code normalisation, recovery file", () => {
  assert.equal(groupSecret("JBSWY3DPEHPK3PXP"), "JBSW Y3DP EHPK 3PXP");
  assert.equal(normaliseTotp("123 456"), "123456");
  assert.equal(normaliseTotp("12-34-56"), "123456");
  const f = recoveryFileText(["AAAA-1111", "BBBB-2222"], NOW);
  assert.match(f, /^ServrSit recovery codes\nCreated 2026-11-17T07:00:00.000Z/);
  assert.match(f, / 1\. AAAA-1111\n 2\. BBBB-2222\n/);
});

test("QR matrix is square, has the finder pattern, and the path is non-empty (no network involved)", () => {
  const m = qrMatrix("otpauth://totp/ServrSit:owner?secret=JBSWY3DPEHPK3PXP&issuer=ServrSit");
  assert.ok(m.length >= 21);
  assert.ok(m.every((row) => row.length === m.length));
  assert.deepEqual(m[0]!.slice(0, 7), [true, true, true, true, true, true, true]); // top-left finder edge
  assert.match(qrPath(m), /^M\d+ 0h/);
});
