/**
 * [FIXTURE DATA] Synthetic SSH public keys for tests. Each call makes a fresh
 * key pair in memory and returns only the public blob; nothing describes a
 * real server.
 */

import { generateKeyPairSync } from "node:crypto";

/** A real-format ED25519 public key blob (base64), made here. */
export function syntheticEd25519(): string {
  const der = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" });
  const raw = der.subarray(der.length - 32);
  const str = (b: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
  return Buffer.concat([str(Buffer.from("ssh-ed25519")), str(raw)]).toString("base64");
}
