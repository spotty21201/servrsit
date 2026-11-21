/**
 * T-091 (D-S3): the inspect key's forced command.
 *
 * These tests run the forced command with this machine's own /bin/sh and
 * bash, exactly as sshd would hand it to a login shell, and feed it the
 * reviewed `installed` script (dpkg-query, read-only) or refused inputs. No
 * ssh connection is made. ssh-keygen parses the key line with OpenSSH's own
 * authorized_keys parser (a throwaway key in a temporary directory).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSPECT_SCRIPTS, inspectForcedCommand, inspectKeyOptions, inspectScriptDigest, inspectScriptDigests, MAX_INSPECT_SCRIPT_BYTES } from "./inspect-access.js";
import { buildCollectorScript } from "./script.js";
import { COLLECTOR_SECTIONS } from "./sections.js";

const NONCE = "0123456789abcdef0123456789abcdef";

/** sshd's own unquoting of a command="..." option: \" becomes ", nothing else changes. */
function sshdCommand(options: string): string {
  const m = /,command="((?:[^"\\]|\\.)*)"$/.exec(options);
  assert.ok(m, "options end with command=\"...\"");
  return m[1]!.replace(/\\"/g, '"');
}

function run(shell: string, original: string | undefined, stdin: string) {
  const env: Record<string, string> = { PATH: "/usr/bin:/bin", LC_ALL: "C" };
  if (original !== undefined) env["SSH_ORIGINAL_COMMAND"] = original;
  const r = spawnSync(shell, ["-c", inspectForcedCommand()], { input: stdin, env, encoding: "utf8", timeout: 30_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("the key line quotes the forced command so sshd hands back exactly the program", () => {
  const options = inspectKeyOptions("100.104.220.8");
  assert.ok(options.startsWith('restrict,from="100.104.220.8",command="exec /bin/sh -c '));
  assert.equal(sshdCommand(options), inspectForcedCommand());
  assert.doesNotMatch(inspectForcedCommand(), /\n/);
  assert.throws(() => inspectKeyOptions('1.2.3.4",command="sh'));
  assert.throws(() => inspectKeyOptions("*"));
});

test("OpenSSH's own parser accepts the full authorized_keys line", () => {
  const dir = mkdtempSync(join(tmpdir(), "servrsit-t091-"));
  const key = join(dir, "k");
  const made = spawnSync("/usr/bin/ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "servrsit-fixture", "-f", key], { stdio: "ignore" });
  assert.equal(made.status, 0);
  const pub = readFileSync(`${key}.pub`, "utf8").trim();
  const line = `${inspectKeyOptions("100.104.220.8")} ${pub}`;
  assert.ok(line.length < 2048, `key line is ${line.length} characters`);
  writeFileSync(join(dir, "authorized_keys"), `${line}\n`);
  const r = spawnSync("/usr/bin/ssh-keygen", ["-l", "-f", join(dir, "authorized_keys")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /servrsit-fixture \(ED25519\)/);
});

for (const shell of ["/bin/sh", "/bin/bash"]) {
  test(`${shell}: a reviewed script runs, with the nonce from the request`, () => {
    const r = run(shell, `sh -s ${NONCE}`, INSPECT_SCRIPTS["installed"]!);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^@@BEGIN ${NONCE} installed@@$`, "m"));
    assert.match(r.stdout, new RegExp(`^@@END ${NONCE} installed 0@@$`, "m"));
  });

  test(`${shell}: any other request runs nothing (exit 2)`, () => {
    for (const original of [undefined, "", "id", "sh -s", "sh -s abc", `sh -s ${NONCE}; id`, `sh -s ${NONCE.toUpperCase()}`, `sh -s ${NONCE} x`, `sh  -s ${NONCE}`, `bash -s ${NONCE}`]) {
      const r = run(shell, original, INSPECT_SCRIPTS["installed"]!);
      assert.equal(r.status, 2, `request ${JSON.stringify(original)}`);
      assert.equal(r.stdout, "", `request ${JSON.stringify(original)} printed something`);
    }
  });

  test(`${shell}: a changed, unknown or oversized script runs nothing (exit 3)`, () => {
    const marker = join(mkdtempSync(join(tmpdir(), "servrsit-t091-")), "ran");
    const installed = INSPECT_SCRIPTS["installed"]!;
    for (const script of [
      `${installed}touch ${marker}\n`,
      installed.replace("exit 0", `touch ${marker}; exit 0`),
      `touch ${marker}\n`,
      "",
      buildCollectorScript([...COLLECTOR_SECTIONS, { name: "extra", command: `touch ${marker}` }]),
      `${installed}#${"x".repeat(MAX_INSPECT_SCRIPT_BYTES)}\n`,
    ]) {
      const r = run(shell, `sh -s ${NONCE}`, script);
      assert.equal(r.status, 3, `script of ${script.length} bytes`);
      assert.equal(r.stdout, "");
    }
    assert.equal(spawnSync("/usr/bin/test", ["-e", marker]).status, 1, "nothing ran");
  });
}

test("every inspect script is allowed, and only those (a script change needs new key lines)", () => {
  assert.deepEqual(Object.keys(INSPECT_SCRIPTS).sort(), ["health", "installed", "inventory", "preview", "privilege"]);
  const digests = inspectScriptDigests();
  assert.equal(digests.length, 5);
  for (const s of Object.values(INSPECT_SCRIPTS)) assert.ok(digests.includes(inspectScriptDigest(s)));
  for (const d of digests) assert.ok(inspectForcedCommand().includes(`"${d}  -"`));
  // The trailing newline does not change the digest (command substitution drops it).
  assert.equal(inspectScriptDigest("a\n\n"), inspectScriptDigest("a"));
});
