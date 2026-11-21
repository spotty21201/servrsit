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
  installedFromPreview,
  packagesPreconditionDigest,
} from "../../packages/domain/src/index.ts";
import { parseAptUpgrade, parseInstalled } from "../../packages/ssh/src/index.ts";

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

// T-089: a real-target preview (apt-get -s and dpkg-query, as the controller parses them) and the
// precondition digest the controller puts in the manifest. The helper must compute the same digest
// from the same installed versions (adapters.precondition_digest), including an Architecture: all
// package, or it would refuse every real plan with PRECONDITION_CHANGED.
const APT = [
  "Inst wget [1.21.4-1ubuntu4] (1.21.4-1ubuntu4.1 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])",
  "Inst vim-common [2:9.1.0016-1ubuntu7.8] (2:9.1.0016-1ubuntu7.9 Ubuntu:24.04/noble-updates [all])",
  "Inst docker-ce [5:27.3.1-1~ubuntu.24.04~noble] (5:27.4.0-1~ubuntu.24.04~noble Docker CE:noble [amd64])",
].join("\n");
const DPKG = "wget amd64 1.21.4-1ubuntu4 ii \nvim-common all 2:9.1.0016-1ubuntu7.8 ii \ndocker-ce amd64 5:27.3.1-1~ubuntu.24.04~noble ii \n";
const parsed = parseAptUpgrade(APT);
const installed = parseInstalled(DPKG).installed;
const realPlan = buildPlan({
  ...common, id: "00000000-0000-4000-8000-0000000001b1", operation: "apply.packages.v1",
  preview: { upgrades: parsed.upgrades, removals: [], downgrades: [], held: [], locked: false, stateDigest: "unused", digestRule: "installed-v1" },
});
if (realPlan.blockers.length > 0) throw new Error(`real-target vector plan is blocked: ${realPlan.blockers.map((b) => b.code).join(",")}`);
const keys = realPlan.scope.packages.map((c) => `${c.name}:${c.arch}`);
const expectedDigest = packagesPreconditionDigest(installedFromPreview({ upgrades: parsed.upgrades, removals: [], downgrades: [], held: [], locked: false, stateDigest: "unused" }, keys));
if (realPlan.preconditions.previewDigest !== expectedDigest) throw new Error("real-target plan does not use the installed-v1 rule");
const realManifest = buildManifest({ installationId: "inst-vectors", operationId: "00000000-0000-4000-8000-0000000002b1", plan: realPlan, hostKeyFingerprint: HOST_KEY, issuedAt: NOW }).manifest;
const preconditions = [{ note: "[FIXTURE DATA] T-089 real-target package plan", installed, manifest: realManifest, previewDigest: realPlan.preconditions.previewDigest }];

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
    preconditions,
    canonical: [{ value: tricky, text: canonicalJson(tricky), digest: digestOf(tricky) }],
  }, null, 2) + "\n",
);
console.log(`wrote ${manifests.length} manifests`);
