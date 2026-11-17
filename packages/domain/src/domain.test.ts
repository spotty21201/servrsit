import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertTransition, buildManifest, buildPlan, canonicalJson, CanonicalizationError, createSigner,
  digestOf, isExpired, isSupportedOperation, PLAN_TTL_MS, PRODUCTION_ACK, signManifest,
  TransitionError, verifyManifestSignature, verifyPlanDigest, type OpState, type TransactionPreview,
} from "./index.js";

const NOW = new Date("2026-11-17T10:00:00.000Z");
const preview = (over: Partial<TransactionPreview> = {}): TransactionPreview => ({
  upgrades: [
    { name: "openssl", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5" },
    { name: "libssl3t64", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5" },
  ],
  removals: [], downgrades: [], held: [], locked: false, stateDigest: "sha256:state1",
  ...over,
});
const server = { id: "00000000-0000-4000-8000-00000000s001", production: true, writesEnabled: true };
const plan = (over: Partial<Parameters<typeof buildPlan>[0]> = {}) =>
  buildPlan({ id: "p1", version: 1, operation: "apply.packages.v1", server, preview: preview(), unresolved: null, now: NOW, ...over });

// ---- canonical JSON -------------------------------------------------------

test("canonical JSON sorts keys recursively, keeps array order, has no whitespace", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, 1], c: "x" } }), '{"a":{"c":"x","d":[3,1]},"b":1}');
  assert.equal(digestOf({ a: 1, b: 2 }), digestOf({ b: 2, a: 1 }));
  assert.notEqual(digestOf([1, 2]), digestOf([2, 1]));
});

test("canonical JSON rejects values that would otherwise be dropped or ambiguous", () => {
  for (const bad of [{ a: undefined }, { a: Number.NaN }, { a: Infinity }, { a: () => 1 }, { a: new Date() }, { a: 1n }]) {
    assert.throws(() => canonicalJson(bad), CanonicalizationError);
  }
});

// ---- plans ----------------------------------------------------------------

test("a plan is versioned, exact, digested and expires after 15 minutes", () => {
  const p = plan();
  assert.equal(p.version, 1);
  assert.deepEqual(p.scope.packages.map((c) => c.name), ["libssl3t64", "openssl"], "sorted for a stable digest");
  assert.equal(p.expiresAt, new Date(NOW.getTime() + PLAN_TTL_MS).toISOString());
  assert.equal(PLAN_TTL_MS, 15 * 60_000);
  assert.match(p.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(verifyPlanDigest(p), true);
  assert.deepEqual(p.blockers, []);
  assert.deepEqual(p.verification.expectInstalled, { "libssl3t64:amd64": "3.0.13-0ubuntu3.5", "openssl:amd64": "3.0.13-0ubuntu3.5" });
});

test("invariant 4: any change to scope, version or expiry changes the digest", () => {
  const base = plan();
  assert.notEqual(plan({ version: 2 }).digest, base.digest);
  assert.notEqual(plan({ now: new Date(NOW.getTime() + 1) }).digest, base.digest, "expiry is bound");
  assert.notEqual(plan({ preview: preview({ upgrades: [preview().upgrades[0]!] }) }).digest, base.digest);
  const tampered = { ...base, scope: { ...base.scope, packages: [...base.scope.packages, { name: "x", arch: "amd64", from: "1", to: "2" }] } };
  assert.equal(verifyPlanDigest(tampered), false);
});

test("invariant 5: a package plan never includes a service restart or a reboot", () => {
  const p = plan();
  assert.equal(p.scope.includesServiceRestart, false);
  assert.equal(p.scope.includesReboot, false);
  assert.equal(isSupportedOperation("restart.service.v1"), false);
  assert.equal(isSupportedOperation("reboot.host.v1"), false);
  assert.equal(isSupportedOperation("run.shell"), false);
  assert.equal(isSupportedOperation("apply.packages.v1"), true);
});

test("expiry", () => {
  const p = plan();
  assert.equal(isExpired(p, new Date(NOW.getTime() + PLAN_TTL_MS - 1)), false);
  assert.equal(isExpired(p, new Date(NOW.getTime() + PLAN_TTL_MS)), true);
});

test("production servers require an explicit production acknowledgement", () => {
  assert.deepEqual(plan().requiredAcknowledgements, [PRODUCTION_ACK]);
  assert.deepEqual(plan({ server: { ...server, production: false } }).requiredAcknowledgements, []);
});

test("typed blockers: writes disabled, busy, unknown outcome, removals, downgrades, holds, lock, nothing to do", () => {
  const codes = (p: ReturnType<typeof plan>) => p.blockers.map((b) => b.code);
  assert.deepEqual(codes(plan({ server: { ...server, writesEnabled: false }, preview: null })), ["WRITES_DISABLED"]);
  assert.deepEqual(codes(plan({ unresolved: "running" })), ["TARGET_BUSY"]);
  assert.deepEqual(codes(plan({ unresolved: "outcome_unknown" })), ["OUTCOME_UNKNOWN"]);
  assert.deepEqual(codes(plan({ preview: preview({ removals: ["foo"] }) })), ["PACKAGE_REMOVAL_UNSUPPORTED"]);
  assert.deepEqual(codes(plan({ preview: preview({ downgrades: ["foo"] }) })), ["DOWNGRADE_UNSUPPORTED"]);
  assert.deepEqual(codes(plan({ preview: preview({ held: ["foo"] }) })), ["HELD_PACKAGE"]);
  assert.deepEqual(codes(plan({ preview: preview({ locked: true }) })), ["PACKAGE_LOCKED"]);
  assert.deepEqual(codes(plan({ preview: preview({ upgrades: [] }) })), ["NO_CHANGES"]);
  assert.deepEqual(codes(plan({ preview: null })), ["PLAN_UNAVAILABLE"]);
});

test("malformed package data from a target is a blocker, never scope", () => {
  const p = plan({ preview: preview({ upgrades: [{ name: "x; rm -rf /", arch: "amd64", from: "1", to: "2" }] }) });
  assert.deepEqual(p.blockers.map((b) => b.code), ["PLAN_UNAVAILABLE"]);
  assert.deepEqual(p.scope.packages, []);
});

// ---- state machine ----------------------------------------------------------

test("allowed transitions", () => {
  const ok: Array<[OpState, OpState, Parameters<typeof assertTransition>[2]]> = [
    ["queued", "running", "remote_accepted"],
    ["queued", "cancelled_before_start", "cancelled"],
    ["queued", "failed", "remote_rejected"],
    ["queued", "outcome_unknown", "outcome_unknown"],
    ["running", "verifying", "remote_finished"],
    ["running", "outcome_unknown", "outcome_unknown"],
    ["verifying", "succeeded", "verification_recorded"],
    ["verifying", "partially_succeeded", "verification_recorded"],
    ["outcome_unknown", "running", "reconciled"],
    ["outcome_unknown", "succeeded", "reconciled"],
  ];
  for (const [from, to, ev] of ok) assert.doesNotThrow(() => assertTransition(from, to, ev), `${from}->${to}`);
});

test("forbidden transitions: final states never change; unknown moves only by reconciliation", () => {
  const bad: Array<[OpState, OpState, Parameters<typeof assertTransition>[2]]> = [
    ["failed", "succeeded", "reconciled"],
    ["succeeded", "failed", "verification_recorded"],
    ["partially_succeeded", "succeeded", "reconciled"],
    ["cancelled_before_start", "running", "reconciled"],
    ["outcome_unknown", "succeeded", "verification_recorded"],
    ["outcome_unknown", "running", "remote_accepted"],
    ["queued", "succeeded", "verification_recorded"],
    ["running", "succeeded", "remote_finished"],
    ["running", "cancelled_before_start", "cancelled"],
    ["queued", "cancelled_before_start", "remote_rejected"],
  ];
  for (const [from, to, ev] of bad) assert.throws(() => assertTransition(from, to, ev), TransitionError, `${from}->${to} via ${ev}`);
});

// ---- manifest and signature -----------------------------------------------

test("manifest carries the binding fields and no executable content", () => {
  const { manifest, digest } = buildManifest({ installationId: "inst-1", operationId: "op-1", plan: plan(), hostKeyFingerprint: "SHA256:abc", issuedAt: NOW });
  assert.deepEqual(Object.keys(manifest).sort(), [
    "acceptBefore", "catalogVersion", "installationId", "issuedAt", "operation", "operationId",
    "plan", "preconditionDigest", "schemaVersion", "scope", "server", "verification",
  ]);
  assert.equal(manifest.plan.digest, plan().digest);
  assert.match(digest, /^sha256:/);
  assert.equal(/command|script|exec|shell/i.test(canonicalJson(manifest)), false);
  assert.ok(Date.parse(manifest.acceptBefore) <= Date.parse(plan().expiresAt), "never accepted after the plan expires");
});

test("signatures verify; any change, wrong key or unknown key id fails", () => {
  const signer = createSigner("key-1");
  const other = createSigner("key-2");
  const { manifest } = buildManifest({ installationId: "inst-1", operationId: "op-1", plan: plan(), hostKeyFingerprint: "SHA256:abc", issuedAt: NOW });
  const signed = signManifest(manifest, signer);
  const trusted = { [signer.keyId]: signer.publicKeyPem };
  assert.equal(verifyManifestSignature(signed, trusted), true);
  assert.equal(verifyManifestSignature({ ...signed, manifest: { ...manifest, operationId: "op-2" } }, trusted), false);
  assert.equal(verifyManifestSignature(signManifest(manifest, other), trusted), false, "unknown key id");
  assert.equal(verifyManifestSignature({ ...signManifest(manifest, other), keyId: signer.keyId }, trusted), false, "wrong key");
  assert.equal(verifyManifestSignature({ ...signed, signature: "AAAA" }, trusted), false);
});
