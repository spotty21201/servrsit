/**
 * T-087: persistent keys, trust.json, prepare, and the test-bench client.
 * Keys are made in temporary directories only. ssh is never run: the client
 * gets a fake runner. The Python helper's own verifier checks a manifest
 * signed with the persistent key (local process, no server).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest, buildRebootPlan } from "@servrsit/domain";
import type { RunRequest, RunResult } from "@servrsit/ssh";
import { keyIdOf, loadOrCreateMaintenanceKey, loadOrCreateSigningKey, trustJson } from "./keys.js";
import { prepare } from "./prepare.js";
import { describe, queryRequest, send, submitRequest } from "./client.js";

const tmp = () => mkdtempSync(join(tmpdir(), "servrsit-bench-"));
const HELPER = new URL("../../../../target-helper", import.meta.url).pathname;

function manifest() {
  const now = new Date();
  const plan = buildRebootPlan({
    id: "00000000-0000-4000-8000-0000000009a1", version: 1, now,
    server: { id: "00000000-0000-4000-8000-0000000009f1", production: false, writesEnabled: true },
    unresolved: null, controllerClockTrusted: true, preview: { bootId: "11111111-2222-3333-4444-555555555555", stateDigest: "sha256:" + "3".repeat(64) },
  });
  return buildManifest({ installationId: "servrsit-merauke-founder-1", operationId: "00000000-0000-4000-8000-0000000009b1", plan, hostKeyFingerprint: "SHA256:" + "Q".repeat(43), issuedAt: now }).manifest;
}

test("the signing key is made once, 0600 in a 0700 directory, and reused; its key id is stable and public", () => {
  const dir = join(tmp(), "helper");
  const a = loadOrCreateSigningKey(dir);
  const b = loadOrCreateSigningKey(dir);
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.signer.keyId, b.signer.keyId);
  assert.equal(a.signer.keyId, keyIdOf(a.signer.publicKeyPem));
  assert.match(a.signer.keyId, /^ctrl-[0-9a-f]{16}$/);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(a.path).mode & 0o777, 0o600);
  assert.throws(() => loadOrCreateSigningKey(join(tmp(), "none"), false), /no manifest signing key yet/);
});

test("a key file readable by others is refused", () => {
  const dir = join(tmp(), "helper");
  const { path } = loadOrCreateSigningKey(dir);
  execFileSync("chmod", ["0644", path]);
  assert.throws(() => loadOrCreateSigningKey(dir), /0600/);
});

test("trust.json and prepare's output hold public material only", () => {
  const keys = join(tmp(), "helper");
  const out = tmp();
  const facts = prepare("sentani", out, keys);
  const trust = readFileSync(join(out, "trust.json"), "utf8");
  assert.doesNotMatch(trust, /PRIVATE KEY/);
  assert.doesNotMatch(JSON.stringify(facts), /PRIVATE KEY/);
  assert.deepEqual(Object.keys(JSON.parse(trust).keys), [facts.keyId]);
  assert.equal(facts.installationId, "servrsit-merauke-founder-1");
  assert.deepEqual([facts.account, facts.homeUser, facts.from, facts.founderSshTarget], ["servrsit", "spotty", "100.104.220.8", "spotty@sentani"]);
  assert.match(facts.maintenancePublicLine, /^ssh-ed25519 \S+ servrsit-maintenance-sentani$/);
  assert.equal(statSync(join(keys, "sentani", "id_ed25519")).mode & 0o777, 0o600);
  const again = prepare("sentani", out, keys);
  assert.deepEqual([again.signingKeyCreated, again.maintenanceKeyCreated, again.maintenancePublicLine], [false, false, facts.maintenancePublicLine]);
  assert.throws(() => prepare("nabire", out, keys), /no test-bench entry/);
  assert.throws(() => loadOrCreateMaintenanceKey("timika", keys, false), /no maintenance key/);
});

test("the Python helper verifies a manifest signed with the persistent key, and refuses a tampered one", () => {
  const keys = join(tmp(), "helper");
  const signer = loadOrCreateSigningKey(keys).signer;
  const dir = tmp();
  writeFileSync(join(dir, "trust.json"), trustJson(signer), { mode: 0o644 });
  const req = JSON.parse(submitRequest(manifest(), signer)) as { signed: { manifest: { plan: { version: number } } } };
  writeFileSync(join(dir, "good.json"), JSON.stringify(req.signed));
  req.signed.manifest.plan.version = 2;
  writeFileSync(join(dir, "bad.json"), JSON.stringify(req.signed));
  const py = "import json,sys; sys.path.insert(0, sys.argv[1]); from servrsit_helper.signature import load_trust, verify_manifest; t=load_trust(sys.argv[2], require_root=False); print(verify_manifest(json.load(open(sys.argv[3])), t))";
  const run = (f: string) => execFileSync("python3", ["-c", py, HELPER, join(dir, "trust.json"), join(dir, f)], { env: { PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1" } }).toString().trim();
  assert.equal(run("good.json"), "None");
  assert.equal(run("bad.json"), "INVALID_SIGNATURE");
});

test("the client refuses an unpinned host without running ssh; with a pin it runs the hardened argv and parses the reply", async () => {
  const dir = tmp();
  const calls: RunRequest[] = [];
  const runner = async (r: RunRequest): Promise<RunResult> => { calls.push(r); return { exitCode: 0, stdout: '{"found": false, "helperVersion": "0.1.0"}', stderr: "", timedOut: false, stdoutTruncated: false, spawnFailed: false }; };
  const target = { host: "100.101.102.103", account: "servrsit", identityFile: join(dir, "id_ed25519"), knownHostsFile: join(dir, "known_hosts") };
  assert.deepEqual(await send(queryRequest("x"), target, runner), { ok: false, reason: "HOST_NOT_PINNED", exitCode: null });
  assert.equal(calls.length, 0);
  writeFileSync(target.knownHostsFile, "100.101.102.103 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture\n");
  const r = await send(queryRequest("00000000-0000-4000-8000-0000000009b1"), target, runner);
  assert.deepEqual(r, { ok: true, reply: { found: false, helperVersion: "0.1.0" } });
  const argv = calls[0]!.args;
  for (const opt of ["BatchMode=yes", "StrictHostKeyChecking=yes", `UserKnownHostsFile=${target.knownHostsFile}`, "IdentitiesOnly=yes", "ForwardAgent=no"]) assert.ok(argv.includes(opt), opt);
  assert.deepEqual(argv.slice(argv.indexOf("-l"), argv.indexOf("-l") + 2), ["-l", "servrsit"]);
  assert.equal(calls[0]!.stdin, queryRequest("00000000-0000-4000-8000-0000000009b1"));
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE KEY/);
});

test("describe gives public facts only", () => {
  const signer = loadOrCreateSigningKey(join(tmp(), "helper")).signer;
  const d = describe(manifest(), signer);
  assert.deepEqual(Object.keys(d).sort(), ["canonicalBytes", "digest", "keyId"]);
});
