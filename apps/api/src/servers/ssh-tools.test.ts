import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRequest, RunResult } from "@servrsit/ssh";
import { syntheticEd25519 } from "./keys.fixtures.js";
import { createHostKeyScanner, createKeyVault, fingerprintOf, knownHostsLine, parseKeyscanOutput } from "./ssh-tools.js";

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false, stdoutTruncated: false, spawnFailed: false });

test("keyscan output: the ED25519 key wins, comments are ignored, a blob that lies about its type is refused", () => {
  const ed = syntheticEd25519();
  const out = `# host:22 SSH-2.0-OpenSSH_9.6\nhost ssh-rsa ${ed}\nhost ssh-ed25519 ${ed}\n`;
  const key = parseKeyscanOutput(out);
  assert.equal(key?.algorithm, "ED25519");
  assert.equal(key?.fingerprint, fingerprintOf(ed));
  assert.equal(parseKeyscanOutput(`host ssh-rsa ${ed}\n`), null, "an ed25519 blob labelled ssh-rsa is refused");
  assert.equal(parseKeyscanOutput("host ssh-ed25519 not*base64\n"), null);
  assert.equal(parseKeyscanOutput("$(id)\n"), null);
});

test("fingerprints match ssh-keygen exactly", () => {
  const dir = mkdtempSync(join(tmpdir(), "servrsit-fp-"));
  execFileSync("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(dir, "k")]);
  const pub = execFileSync("/usr/bin/ssh-keygen", ["-y", "-f", join(dir, "k")]).toString().trim().split(" ");
  const printed = execFileSync("/usr/bin/ssh-keygen", ["-l", "-E", "sha256", "-f", join(dir, "k.pub")]).toString().split(" ")[1];
  assert.equal(fingerprintOf(pub[1]!), printed);
});

test("the scanner runs ssh-keyscan from an argument array with -- before the address", async () => {
  const seen: RunRequest[] = [];
  const ed = syntheticEd25519();
  const scan = createHostKeyScanner(async (r) => { seen.push(r); return ok(`203.0.113.5 ssh-ed25519 ${ed}\n`); });
  const r = await scan("203.0.113.5", 2222);
  assert.equal(r.ok, true);
  assert.equal(seen[0]?.file, "/usr/bin/ssh-keyscan");
  assert.deepEqual(seen[0]?.args, ["-T", "10", "-t", "ed25519,ecdsa,rsa", "-p", "2222", "--", "203.0.113.5"]);
  const silent = createHostKeyScanner(async () => ok(""));
  assert.deepEqual(await silent("203.0.113.5", 22), { ok: false, code: "ROUTE_UNAVAILABLE" });
  const slow = createHostKeyScanner(async () => ({ ...ok(""), timedOut: true }));
  assert.deepEqual(await slow("203.0.113.5", 22), { ok: false, code: "TIMEOUT" });
});

test("known_hosts line uses the registered name and the [host]:port form off port 22", () => {
  const ed = syntheticEd25519();
  const key = parseKeyscanOutput(`x ssh-ed25519 ${ed}`)!;
  assert.equal(knownHostsLine("Web.Example", 22, key), `web.example ssh-ed25519 ${ed}\n`);
  assert.equal(knownHostsLine("203.0.113.5", 2222, key), `[203.0.113.5]:2222 ssh-ed25519 ${ed}\n`);
});

test("vault: one 0700 directory per server, a 0600 private file that is never returned, removal leaves nothing", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "servrsit-vault-")), "keys");
  const vault = createKeyVault(root);
  const id = "00000000-0000-4000-8000-000000000c01";
  await vault.writeKnownHosts(id, "x ssh-ed25519 AAAA\n");
  const key = await vault.generate(id, "servrsit-web-1");
  const dir = vault.dirFor(id);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(key.privateKeyPath).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "known_hosts")).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir).sort(), ["id_ed25519", "id_ed25519.pub", "known_hosts"]);
  assert.equal(key.keyType, "ssh-ed25519");
  assert.match(key.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.doesNotMatch(JSON.stringify(key), /PRIVATE KEY/);
  assert.deepEqual(Object.keys(key).sort(), ["fingerprint", "keyBase64", "keyType", "privateKeyPath"]);
  assert.equal(await vault.remove(id), true);
  assert.equal(existsSync(dir), false);
});

test("vault refuses ids that are not UUIDs and unsafe key comments", async () => {
  const vault = createKeyVault(mkdtempSync(join(tmpdir(), "servrsit-vault-")));
  for (const bad of ["../etc", "x", "00000000-0000-4000-8000-000000000C01", "00000000-0000-4000-8000-000000000c01/.."]) {
    assert.throws(() => vault.dirFor(bad), /UUID/, bad);
  }
  await assert.rejects(() => vault.generate("00000000-0000-4000-8000-000000000c02", "x; rm -rf /"), /unsafe key comment/);
});
