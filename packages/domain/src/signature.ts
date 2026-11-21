/**
 * Manifest signatures.
 *
 * Technical Spec §8.2 specifies a KMS asymmetric key (RSA-PSS/SHA-256). There
 * is no AWS in this build (ADR-014), so the simulation uses an Ed25519 key
 * pair from node:crypto with the same contract: sign the canonical manifest,
 * the target holds only public keys by key id, and rejects unknown key ids
 * and invalid signatures. Swapping in KMS changes only `Signer`.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJson } from "./canonical.js";
import type { Manifest } from "./manifest.js";

export interface Signer {
  readonly keyId: string;
  readonly publicKeyPem: string;
  sign(data: Buffer): string;
}

export interface SignedManifest {
  readonly manifest: Manifest;
  readonly keyId: string;
  /** base64 Ed25519 signature over the canonical JSON of `manifest`. */
  readonly signature: string;
}

/** A signer with a fresh key pair. The private key never leaves this object. */
export function createSigner(keyId: string): Signer {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const priv: KeyObject = createPrivateKey(privateKey.export({ format: "pem", type: "pkcs8" }));
  return {
    keyId,
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    sign: (data) => sign(null, data, priv).toString("base64"),
  };
}

/**
 * T-087 (ADR-020 step 2): a signer from a persistent PKCS#8 Ed25519 private key.
 * The caller reads the file; this function never logs, returns or exports the private key.
 */
export function signerFromPrivateKeyPem(keyId: string, privateKeyPem: string): Signer {
  const priv = createPrivateKey(privateKeyPem);
  if (priv.asymmetricKeyType !== "ed25519") throw new Error("the manifest signing key must be Ed25519");
  return {
    keyId,
    publicKeyPem: createPublicKey(priv).export({ format: "pem", type: "spki" }).toString(),
    sign: (data) => sign(null, data, priv).toString("base64"),
  };
}

export function signManifest(manifest: Manifest, signer: Signer): SignedManifest {
  return { manifest, keyId: signer.keyId, signature: signer.sign(Buffer.from(canonicalJson(manifest), "utf8")) };
}

/** True only for a known key id and a valid signature over this exact manifest. */
export function verifyManifestSignature(
  signed: SignedManifest,
  trustedKeys: Readonly<Record<string, string>>,
): boolean {
  const pem = trustedKeys[signed.keyId];
  if (pem === undefined) return false;
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(signed.manifest), "utf8"),
      createPublicKey(pem),
      Buffer.from(signed.signature, "base64"),
    );
  } catch {
    return false;
  }
}
