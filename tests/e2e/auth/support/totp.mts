/**
 * Independent RFC 6238 TOTP (HMAC-SHA1) and RFC 4648 base32. Written from the
 * RFCs, NOT from the product. Used as the oracle to mint valid, stale, future
 * and replayed codes, so the product's TOTP is never checked against itself.
 */
import { createHmac } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base32 character ${JSON.stringify(ch)}`);
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** HOTP (RFC 4226 section 5.3): dynamic truncation of HMAC-SHA1. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** TOTP (RFC 6238): the HOTP of the 30-second time step. `atMs` is milliseconds since the epoch. */
export function totp(secretBase32: string, atMs: number, opts: { step?: number; digits?: number } = {}): string {
  const step = opts.step ?? 30;
  return hotp(base32Decode(secretBase32), Math.floor(atMs / 1000 / step), opts.digits ?? 6);
}

/** The code for a neighbouring time step (offset -1 is the previous 30 s window). */
export const totpAtStep = (secret: string, atMs: number, offset: number) => totp(secret, atMs + offset * 30_000);
