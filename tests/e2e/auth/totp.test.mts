/** The oracle must be right before it judges anything. RFC 4226 / 6238 published vectors. */
import assert from "node:assert/strict";
import test from "node:test";
import { base32Decode, base32Encode, hotp, totp } from "./support/totp.mts";

const SECRET_ASCII = Buffer.from("12345678901234567890"); // RFC 6238 Appendix B, SHA-1

test("RFC 4226 Appendix D: HOTP test vectors for counters 0..9", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => assert.equal(hotp(SECRET_ASCII, counter), code, `counter ${counter}`));
});

test("RFC 6238 Appendix B: TOTP test vectors (SHA-1, 8 digits) at the published times", () => {
  const b32 = base32Encode(SECRET_ASCII);
  const vectors: [number, string][] = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];
  for (const [t, code] of vectors) assert.equal(totp(b32, t * 1000, { digits: 8 }), code, `T=${t}`);
});

test("6-digit codes are the last six digits of the 8-digit ones (same truncation)", () => {
  const b32 = base32Encode(SECRET_ASCII);
  assert.equal(totp(b32, 59_000), "287082");
});

test("base32 round-trips and rejects junk", () => {
  for (const s of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
    assert.equal(base32Decode(base32Encode(Buffer.from(s))).toString(), s);
  }
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI"); // RFC 4648 vector
  assert.throws(() => base32Decode("not*base32"));
});

test("a code is stable inside its 30 s window and changes at the boundary", () => {
  const b32 = base32Encode(SECRET_ASCII);
  const start = 1_700_000_010_000 - (1_700_000_010_000 % 30_000);
  assert.equal(totp(b32, start), totp(b32, start + 29_999));
  assert.notEqual(totp(b32, start), totp(b32, start + 30_000));
});
