/**
 * Generates tests/vectors.json from the CONTROLLER's own code
 * (packages/domain): plans, manifests, canonical JSON, digests and
 * signatures. The Python tests then check that the helper canonicalizes,
 * digests and verifies exactly the same bytes.
 *
 * [FIXTURE DATA] Synthetic servers and keys. Fresh keys on every run; only
 * public keys and signatures are written.
 *
 * Run from apps/api: node_modules/.bin/tsx ../../target-helper/tests/make_vectors.mts
 */

import { constants, generateKeyPairSync, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  buildDirectoriesPlan,
  buildManifest,
  buildPlan,
  buildRebootPlan,
  buildRestartPlan,
  canonicalJson,
  createSigner,
  digestOf,
  signManifest,
} from "../../packages/domain/src/index.ts";

const NOW = new Date("2026-11-17T10:00:00.000Z");
const SERVER = { id: "00000000-0000-4000-8000-0000000000f1", production: false, writesEnabled: true };
const HOST_KEY = "SHA256:" + "Q".repeat(43);
const common = { version: 1, server: SERVER, unresolved: null, now: NOW, controllerClockTrusted: true } as const;

const plans = [
  buildPlan({
    ...common, id: "00000000-0000-4000-8000-0000000001a1", operation: "apply.packages.v1",
    preview: { upgrades: [{ name: "openssl", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5", origin: "Ubuntu:24.04/noble-updates" }], removals: [], downgrades: [], held: [], locked: false, stateDigest: "sha256:" + "1".repeat(64) },
  }),
  buildRestartPlan({ ...common, id: "00000000-0000-4000-8000-0000000001a2", unit: "nginx.service", selectedUnits: ["nginx.service"], preview: { exists: true, active: true, activeSince: "123", stateDigest: "sha256:" + "2".repeat(64) } }),
  buildRebootPlan({ ...common, id: "00000000-0000-4000-8000-0000000001a3", preview: { bootId: "11111111-2222-3333-4444-555555555555", stateDigest: "sha256:" + "3".repeat(64) } }),
  buildDirectoriesPlan({
    ...common, id: "00000000-0000-4000-8000-0000000001a4", user: "owner",
    requested: [{ path: "/srv/app", owner: "deploy", group: "deploy", mode: "0755" }, { path: "/home/owner/projects", owner: "owner", group: "owner", mode: "0700" }],
    preview: { existing: [], stateDigest: "sha256:" + "4".repeat(64) },
  }),
];

const signer = createSigner("vector-ed25519");
const rsa = generateKeyPairSync("rsa", { modulusLength: 3072 });
const manifests = plans.map((plan, i) => {
  if (plan.blockers.length > 0) throw new Error(`vector plan ${plan.operation} is blocked: ${plan.blockers.map((b) => b.code).join(",")}`);
  const { manifest, digest } = buildManifest({ installationId: "inst-vectors", operationId: `00000000-0000-4000-8000-0000000002a${i + 1}`, plan, hostKeyFingerprint: HOST_KEY, issuedAt: NOW });
  const signed = signManifest(manifest, signer);
  const canonical = canonicalJson(manifest);
  const rsaSignature = sign("sha256", Buffer.from(canonical, "utf8"), { key: rsa.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString("base64");
  return { signed, canonical, digest, rsaSignature };
});

const tricky = { b: "é\u0001\"\\\n\u2028\u{1F600}/", a: [1, true, null, -7, 0], z: { y: "x", A: "" } };

writeFileSync(
  new URL("./vectors.json", import.meta.url),
  JSON.stringify({
    generatedAt: NOW.toISOString(),
    note: "[FIXTURE DATA] made by make_vectors.mts from packages/domain; synthetic servers and keys",
    hostKeyFingerprint: HOST_KEY,
    installationId: "inst-vectors",
    keys: {
      "vector-ed25519": { algorithm: "ed25519", publicKeyPem: signer.publicKeyPem },
      "vector-rsa": { algorithm: "rsa-pss-sha256", publicKeyPem: rsa.publicKey.export({ format: "pem", type: "spki" }).toString() },
    },
    manifests,
    canonical: [{ value: tricky, text: canonicalJson(tricky), digest: digestOf(tricky) }],
  }, null, 2) + "\n",
);
console.log(`wrote ${manifests.length} manifests`);
