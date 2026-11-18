/**
 * Independent SSH key helpers, written from RFC 4253 section 6.6 and the OpenSSH key format, NOT from the
 * product. They mint the fake servers' host keys and compute the fingerprint an owner would compare
 * (what `ssh-keygen -lf` prints), so a product that computes the wrong fingerprint cannot agree with itself.
 * ssh.test.mts cross-checks these against the real ssh-keygen.
 */
import { createHash, generateKeyPairSync, createPublicKey, type KeyObject } from "node:crypto";

const lengthPrefixed = (b: Buffer): Buffer => { const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return Buffer.concat([n, b]); };

/** SSH wire blob of an ed25519 public key: string "ssh-ed25519", string raw-32-bytes. */
export function ed25519Blob(raw32: Buffer): Buffer {
  if (raw32.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  return Buffer.concat([lengthPrefixed(Buffer.from("ssh-ed25519")), lengthPrefixed(raw32)]);
}
/** "SHA256:" + unpadded base64 of the SHA-256 of the blob, exactly as ssh-keygen prints it. */
export const fingerprintOfBlob = (blob: Buffer): string => "SHA256:" + createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");

export interface FakeHostKey { readonly blob: Buffer; readonly fingerprint: string; readonly openssh: string; readonly publicKey: KeyObject }
export function newEd25519(comment = ""): FakeHostKey {
  const { publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  const raw = Buffer.from(jwk.x, "base64url");
  const blob = ed25519Blob(raw);
  return { blob, fingerprint: fingerprintOfBlob(blob), openssh: `ssh-ed25519 ${blob.toString("base64")}${comment ? " " + comment : ""}`, publicKey: createPublicKey(publicKey.export({ type: "spki", format: "pem" })) };
}

export interface ParsedAuthorizedKeysLine { options: string[]; type: string; blob: Buffer; comment: string; fingerprint: string; raw: string }
/** Split an authorized_keys line into options, type, key blob and comment. Options may contain quoted commas. */
export function parseAuthorizedKeysLine(line: string): ParsedAuthorizedKeysLine {
  if (/[\r\n\0]/.test(line)) throw new Error("authorized_keys line must be a single line");
  let i = 0; const opts: string[] = []; let cur = ""; let quoted = false;
  // options run until the first unquoted space
  for (; i < line.length; i++) { const c = line[i]!; if (c === '"') quoted = !quoted; if (c === " " && !quoted) break; if (c === "," && !quoted) { opts.push(cur); cur = ""; } else cur += c; }
  if (cur) opts.push(cur);
  const rest = line.slice(i + 1).trim();
  // when there are no options the "options" token is actually the key type
  const looksLikeType = /^(ssh-|ecdsa-|sk-)/.test(opts[0] ?? "") && opts.length === 1;
  const body = looksLikeType ? line.trim() : rest;
  const [type = "", b64 = "", ...comment] = body.split(/\s+/);
  const blob = Buffer.from(b64, "base64");
  return { options: looksLikeType ? [] : opts, type, blob, comment: comment.join(" "), fingerprint: fingerprintOfBlob(blob), raw: line };
}
export const optionValue = (opts: string[], name: string): string | null => { const o = opts.find((x) => x === name || x.startsWith(name + "=")); if (o === undefined) return null; return o.includes("=") ? o.slice(o.indexOf("=") + 1).replace(/^"|"$/g, "") : ""; };
