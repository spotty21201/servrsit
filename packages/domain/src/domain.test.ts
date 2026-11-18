import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertTransition, buildManifest, buildPlan, canonicalJson, CanonicalizationError, createSigner,
  digestOf, isExpired, isSupportedOperation, PLAN_TTL_MS, PRODUCTION_ACK, PRODUCTION_ACKS, signManifest,
  TransitionError, verifyManifestSignature, verifyPlanDigest, type OpState, type TransactionPreview,
} from "./index.js";

const NOW = new Date("2026-11-17T10:00:00.000Z");
const UBUNTU = "Ubuntu:24.04/noble-updates";
const preview = (over: Partial<TransactionPreview> = {}): TransactionPreview => ({
  upgrades: [
    { name: "openssl", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5", origin: UBUNTU },
    { name: "libssl3t64", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5", origin: UBUNTU },
  ],
  removals: [], downgrades: [], held: [], locked: false, stateDigest: "sha256:state1",
  ...over,
});
const server = { id: "00000000-0000-4000-8000-00000000s001", production: true, writesEnabled: true };
const plan = (over: Partial<Parameters<typeof buildPlan>[0]> = {}) =>
  buildPlan({ id: "p1", version: 1, operation: "apply.packages.v1", server, preview: preview(), unresolved: null, now: NOW, controllerClockTrusted: true, ...over });

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
  // T-059: restart and reboot exist, but only as their own plans with their own approvals.
  assert.equal(isSupportedOperation("restart.service.v1"), true);
  assert.equal(isSupportedOperation("reboot.host.v1"), true);
  assert.equal(isSupportedOperation("run.shell"), false);
  assert.equal(isSupportedOperation("apply.packages.v1"), true);
});

test("expiry", () => {
  const p = plan();
  assert.equal(isExpired(p, new Date(NOW.getTime() + PLAN_TTL_MS - 1)), false);
  assert.equal(isExpired(p, new Date(NOW.getTime() + PLAN_TTL_MS)), true);
});

test("T-057: production servers require both acknowledgements: a recovery route and the interruption risk", () => {
  assert.deepEqual(plan().requiredAcknowledgements, ["recovery-route-confirmed", "interruption-risk-understood"]);
  assert.deepEqual([...PRODUCTION_ACKS], ["recovery-route-confirmed", "interruption-risk-understood"]);
  assert.equal(PRODUCTION_ACK, "recovery-route-confirmed", "the deprecated single constant is one of the two, not enough alone");
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

// ---- T-062: updates from outside Ubuntu's archive -------------------------------------

/** The form Sentani reported on 2026-11-17. */
const DOCKER = [
  { name: "docker-ce", arch: "amd64", from: "5:29.9.3-1~ubuntu.24.04~noble", to: "5:29.10.0-1~ubuntu.24.04~noble", origin: "Docker CE:noble" },
  { name: "docker-ce-cli", arch: "amd64", from: "5:29.9.3-1~ubuntu.24.04~noble", to: "5:29.10.0-1~ubuntu.24.04~noble", origin: "Docker CE:noble" },
];

test("T-062: updates from outside Ubuntu's archive are listed as excluded and never enter the transaction", () => {
  const p = plan({ preview: preview({ upgrades: [...preview().upgrades, ...DOCKER] }) });
  assert.deepEqual(p.scope.packages.map((c) => c.name), ["libssl3t64", "openssl"]);
  assert.ok(p.scope.packages.every((c) => !("origin" in c)), "the transaction carries no origin labels");
  assert.deepEqual(p.scope.excludedPackages.map((c) => [c.name, c.origin, c.reason]), [
    ["docker-ce", "Docker CE:noble", "outside-ubuntu-archive"],
    ["docker-ce-cli", "Docker CE:noble", "outside-ubuntu-archive"],
  ]);
  assert.deepEqual(Object.keys(p.verification.expectInstalled).sort(), ["libssl3t64:amd64", "openssl:amd64"]);
  assert.deepEqual(p.blockers, []);
  assert.ok(verifyPlanDigest(p));
});

test("T-062: when every pending update is from outside Ubuntu, the plan is blocked ONLY_EXCLUDED_PACKAGES", () => {
  const p = plan({ preview: preview({ upgrades: DOCKER }) });
  assert.deepEqual(p.scope.packages, []);
  assert.deepEqual(p.blockers.map((b) => b.code), ["ONLY_EXCLUDED_PACKAGES"]);
});

test("T-062: a missing, unrecognised, backports or mixed origin is excluded (fail safe)", () => {
  const base = { arch: "amd64", from: "1", to: "2" };
  const p = plan({
    preview: preview({
      upgrades: [
        { ...base, name: "a" },
        { ...base, name: "b", origin: "Ubuntu:24.04/noble-backports" },
        { ...base, name: "c", origin: "Ubuntu:24.04/noble-updates, Docker CE:noble" },
        { ...base, name: "d", origin: "evil`id`" },
        { ...base, name: "e", origin: "Ubuntu:24.04/noble-security" },
      ],
    }),
  });
  assert.deepEqual(p.scope.packages.map((c) => c.name), ["e"]);
  assert.deepEqual(p.scope.excludedPackages.map((c) => [c.name, c.origin]), [
    ["a", "(unknown)"],
    ["b", "Ubuntu:24.04/noble-backports"],
    ["c", "Ubuntu:24.04/noble-updates, Docker CE:noble"],
    ["d", "(unknown)"],
  ]);
});

// ---- T-063: ServrSit's own clock ---------------------------------------------------

test("T-063: an untrusted controller clock blocks the plan with CONTROLLER_CLOCK_UNTRUSTED", () => {
  const p = plan({ controllerClockTrusted: false });
  assert.deepEqual(p.blockers.map((b) => b.code), ["CONTROLLER_CLOCK_UNTRUSTED"]);
  assert.match(p.blockers[0]!.message, /ServrSit's own clock/);
});

// ---- T-056: canonical identity -------------------------------------------------------

test("T-056: same host key AND machine id is one machine; one shared attribute is ambiguous; a missing one is unverified", async () => {
  const { resolveIdentities, canonicalIdOf } = await import("./index.js");
  const m = resolveIdentities([
    { id: "a", hostKeyFingerprint: "SHA256:k1", machineId: "m1" },
    { id: "a-alias", hostKeyFingerprint: "SHA256:k1", machineId: "m1" },
    { id: "clone", hostKeyFingerprint: "SHA256:k9", machineId: "m2" },
    { id: "rebuilt", hostKeyFingerprint: "SHA256:k8", machineId: "m2" },
    { id: "no-key", hostKeyFingerprint: null, machineId: "m3" },
    { id: "no-mid", hostKeyFingerprint: "SHA256:k7", machineId: null },
  ]);
  assert.deepEqual(m.get("a"), { status: "verified", canonicalId: canonicalIdOf("SHA256:k1", "m1"), aliases: ["a-alias"] });
  assert.equal(m.get("a-alias")?.status === "verified" && m.get("a-alias")?.status, "verified");
  assert.deepEqual(m.get("clone"), { status: "ambiguous", conflictsWith: ["rebuilt"] });
  assert.deepEqual(m.get("rebuilt"), { status: "ambiguous", conflictsWith: ["clone"] });
  assert.deepEqual(m.get("no-key"), { status: "unverified", reason: "host-key-unknown" });
  assert.deepEqual(m.get("no-mid"), { status: "unverified", reason: "machine-id-unknown" });
});

test("T-056: an unverified or ambiguous identity blocks a plan only when writes are enabled", () => {
  assert.deepEqual(plan({ identity: { status: "ambiguous", conflictsWith: ["x"] } }).blockers.map((b) => b.code), ["IDENTITY_AMBIGUOUS"]);
  assert.deepEqual(plan({ identity: { status: "unverified", reason: "machine-id-unknown" } }).blockers.map((b) => b.code), ["IDENTITY_UNVERIFIED"]);
  assert.deepEqual(plan({ server: { ...server, writesEnabled: false }, preview: null, identity: { status: "unverified", reason: "host-key-unknown" } }).blockers.map((b) => b.code), ["WRITES_DISABLED"]);
});


// ---- T-059: restart, reboot and directory plans ---------------------------------------

test("T-059: a restart plan is one selected unit, never a reboot; unknown or unselected units are blocked", async () => {
  const { buildRestartPlan } = await import("./index.js");
  const base = { id: "r1", version: 1, server, unresolved: null, now: NOW, controllerClockTrusted: true } as const;
  const preview = { exists: true, active: true, activeSince: "2026-11-17T09:00:00.000Z", stateDigest: "sha256:svc" };
  const p = buildRestartPlan({ ...base, unit: "nginx.service", selectedUnits: ["nginx.service"], preview });
  assert.deepEqual([p.operation, p.scope, p.blockers], ["restart.service.v1", { unit: "nginx.service", includesServiceRestart: true, includesReboot: false }, []]);
  assert.deepEqual(p.verification, { unit: "nginx.service", previousActiveSince: "2026-11-17T09:00:00.000Z" });
  assert.deepEqual(p.requiredAcknowledgements, [...PRODUCTION_ACKS], "production needs both acknowledgements");
  assert.ok(verifyPlanDigest(p));
  const code = (q: { blockers: readonly { code: string }[] }) => q.blockers.map((b) => b.code);
  assert.deepEqual(code(buildRestartPlan({ ...base, unit: "sshd.service", selectedUnits: ["nginx.service"], preview })), ["UNIT_NOT_SELECTED"]);
  assert.deepEqual(code(buildRestartPlan({ ...base, unit: "nginx.service; reboot", selectedUnits: ["nginx.service; reboot"], preview })), ["UNIT_NOT_SELECTED"]);
  assert.deepEqual(code(buildRestartPlan({ ...base, unit: "nginx.service", selectedUnits: ["nginx.service"], preview: { ...preview, exists: false } })), ["UNIT_NOT_FOUND"]);
});

test("T-059: a reboot plan is the whole machine, never a restart, verified by a new boot id", async () => {
  const { buildRebootPlan } = await import("./index.js");
  const p = buildRebootPlan({ id: "b1", version: 1, server, unresolved: null, now: NOW, controllerClockTrusted: true, preview: { bootId: "boot-1", stateDigest: "sha256:boot" } });
  assert.deepEqual([p.operation, p.scope, p.verification, p.blockers], ["reboot.host.v1", { includesServiceRestart: false, includesReboot: true }, { previousBootId: "boot-1" }, []]);
});

test("T-059: directories only under /srv or the user's home, safe modes, existing paths left alone (Tech Spec 8.3)", async () => {
  const { buildDirectoriesPlan, directoryAllowed } = await import("./index.js");
  const d = (path: string, mode = "0750", owner = "spotty") => ({ path, owner, group: owner, mode });
  for (const ok of ["/srv/app", "/srv/app/data", "/home/spotty/projects"]) assert.equal(directoryAllowed(d(ok), "spotty"), true, ok);
  for (const bad of ["/etc/app", "/srv", "/home/other/x", "/home/spotty/.ssh", "/srv/../etc", "/srv/a//b", "srv/app", "/srv/app/", "/proc/x", "/srv/$(id)"]) {
    assert.equal(directoryAllowed(d(bad), "spotty"), false, bad);
  }
  for (const mode of ["4750", "2750", "1777", "0777", "0757", "0640", "75x"]) assert.equal(directoryAllowed(d("/srv/app", mode), "spotty"), false, mode);
  assert.equal(directoryAllowed(d("/srv/app", "0750", "Root!"), "spotty"), false);

  const base = { id: "d1", version: 1, server, unresolved: null, now: NOW, controllerClockTrusted: true, user: "spotty" } as const;
  const p = buildDirectoriesPlan({ ...base, requested: [d("/srv/b"), d("/srv/a")], preview: { existing: ["/srv/b"], stateDigest: "sha256:dirs" } });
  assert.deepEqual([p.scope.directories.map((x) => x.path), p.scope.existing, p.blockers], [["/srv/a"], ["/srv/b"], []]);
  assert.deepEqual(p.verification.expectDirectories, [d("/srv/a")]);
  const allExist = buildDirectoriesPlan({ ...base, requested: [d("/srv/a")], preview: { existing: ["/srv/a"], stateDigest: "x" } });
  assert.deepEqual(allExist.blockers.map((b) => b.code), ["NO_CHANGES"]);
  const bad = buildDirectoriesPlan({ ...base, requested: [d("/srv/a"), d("/etc/x")], preview: { existing: [], stateDigest: "x" } });
  assert.deepEqual(bad.blockers.map((b) => b.code), ["DIRECTORY_NOT_ALLOWED"], "one bad path blocks the whole plan");
});
