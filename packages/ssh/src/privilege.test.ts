/**
 * [FIXTURE DATA] Recorded-style `sudo -n -l` outputs (the formats sudo 1.9
 * prints on Ubuntu 24.04). None of them comes from a real server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrivilegeScript, classifySudo, probePrivilegeViaSsh, PRIVILEGE_SUMMARIES } from "./privilege.js";
import type { RunRequest, RunResult } from "./runner.js";

const NONCE = "0123456789abcdef0123456789abcdef";
const header = (user: string) =>
  `Matching Defaults entries for ${user} on fixture-host:\n    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/bin, use_pty\n\nUser ${user} may run the following commands on fixture-host:`;

test("no sudo, no rules, and a password requirement are told apart; a password prompt is never answered", () => {
  assert.deepEqual(classifySudo("", 127), { level: "no-sudo-rules", broad: false, summary: PRIVILEGE_SUMMARIES.noSudo });
  assert.equal(classifySudo("Sorry, user fixture may not run sudo on fixture-host.", 1).level, "no-sudo-rules");
  assert.deepEqual(classifySudo("sudo: a password is required", 1), { level: "unknown", broad: false, summary: PRIVILEGE_SUMMARIES.passwordNeeded });
  assert.equal(classifySudo("sudo: something else went wrong", 1).level, "unknown");
});

test("passwordless rules: full administrator is broad and warned; a narrow rule is not broad", () => {
  const broad = classifySudo(`${header("fixture")}\n    (ALL : ALL) ALL\n    (ALL) NOPASSWD: ALL`, 0);
  assert.deepEqual([broad.level, broad.broad], ["passwordless-sudo", true]);
  assert.match(broad.summary, /^Warning:/);
  assert.equal(classifySudo(`${header("fixture")}\n    (ALL : ALL) NOPASSWD: ALL`, 0).broad, true);
  assert.equal(classifySudo(`${header("fixture")}\n    (root) NOPASSWD:SETENV: ALL`, 0).broad, true);
  const narrow = classifySudo(`${header("fixture")}\n    (root) NOPASSWD: /usr/bin/systemctl status nginx`, 0);
  assert.deepEqual([narrow.level, narrow.broad], ["passwordless-sudo", false]);
  const needsPw = classifySudo(`${header("fixture")}\n    (ALL : ALL) ALL`, 0);
  assert.deepEqual([needsPw.level, needsPw.summary], ["unknown", PRIVILEGE_SUMMARIES.rulesNeedPassword]);
});

test("hostile output cannot fake a classification: only the rules after sudo's own header count", () => {
  assert.equal(classifySudo("(ALL) NOPASSWD: ALL", 0).level, "unknown", "no header, no rules");
});

test("the script runs exactly `sudo -n -l`, nothing as root, no prompt, and nothing else", () => {
  const script = buildPrivilegeScript();
  const sudoCalls = script.match(/\bsudo\b[^;\n]*/g) ?? [];
  assert.deepEqual(sudoCalls.filter((c) => !c.startsWith("sudo >")), ["sudo -n -l 2>&1 </dev/null"]);
  assert.doesNotMatch(script, /sudo -n true|sudo -S|sudo -v|sudo -i|sudo -s\b|\bsu\b|pkexec|doas/);
  assert.doesNotMatch(script, /\$\(|`|\|/);
});

test("over SSH: an unpinned host is never contacted; the output itself is never returned", async () => {
  const calls: RunRequest[] = [];
  const runner = async (r: RunRequest): Promise<RunResult> => {
    calls.push(r);
    return { exitCode: 0, stdout: `@@BEGIN ${NONCE} sudorules@@\n${header("fixture")}\n    (ALL) NOPASSWD: ALL\n@@END ${NONCE} sudorules 0@@\n`, stderr: "", timedOut: false, stdoutTruncated: false, spawnFailed: false };
  };
  const unpinned = await probePrivilegeViaSsh({ host: "198.51.100.7", port: 22, user: "u" }, { knownHostsFile: "/nonexistent/k" }, { runner, nonce: () => NONCE });
  assert.equal(unpinned.ok ? null : unpinned.code, "HOST_UNTRUSTED");
  assert.equal(calls.length, 0);
});
