import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectViaSsh, type CollectDeps } from "./collect.js";
import type { CommandRunner, RunRequest, RunResult } from "./runner.js";
import { NONCE, NORMAL, renderOutput } from "./collector.fixtures.js";

const KEY_LINE = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFIXTUREFIXTUREFIXTUREFIXTUREFIXTUREFIXTURE0";

async function pinnedFile(hosts: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "servrsit-collect-"));
  const file = join(dir, "known_hosts");
  await writeFile(file, hosts.map((h) => `${h} ${KEY_LINE}`).join("\n"));
  return file;
}

function spy(result: Partial<RunResult>): { runner: CommandRunner; calls: RunRequest[] } {
  const calls: RunRequest[] = [];
  const runner: CommandRunner = async (req) => {
    calls.push(req);
    return {
      exitCode: 0, stdout: renderOutput(NORMAL), stderr: "", timedOut: false,
      stdoutTruncated: false, spawnFailed: false, ...result,
    };
  };
  return { runner, calls };
}

const deps = (runner: CommandRunner, extra: Partial<CollectDeps> = {}): CollectDeps => ({
  runner, nonce: () => NONCE, now: () => new Date("2026-11-17T08:00:00.000Z"),
  checkResolution: async () => undefined, ...extra,
});
const target = { host: "nabire", port: 22, user: "spotty" } as const;

test("a host with no pinned key is NOT contacted: runner and resolver are never called", async () => {
  const knownHostsFile = await pinnedFile(["sentani"]);
  const { runner, calls } = spy({});
  let resolved = 0;
  const result = await collectViaSsh(target, { knownHostsFile }, deps(runner, {
    checkResolution: async () => { resolved += 1; },
  }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "HOST_UNTRUSTED");
    assert.equal(result.contacted, false);
  }
  assert.equal(calls.length, 0);
  assert.equal(resolved, 0);
});

test("a missing known_hosts file means nothing is pinned and nothing is contacted", async () => {
  const { runner, calls } = spy({});
  const result = await collectViaSsh(target, { knownHostsFile: "/nonexistent/known_hosts" }, deps(runner));
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("a rejected target is not contacted", async () => {
  const knownHostsFile = await pinnedFile(["127.0.0.1"]);
  const { runner, calls } = spy({});
  const result = await collectViaSsh({ ...target, host: "127.0.0.1" }, { knownHostsFile }, deps(runner));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "TARGET_REJECTED");
  assert.equal(calls.length, 0);
});

test("a pinned host runs exactly ssh with the fixed argv and the script on stdin", async () => {
  const knownHostsFile = await pinnedFile(["nabire"]);
  const { runner, calls } = spy({});
  const result = await collectViaSsh(target, { knownHostsFile }, deps(runner));
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.file, "/usr/bin/ssh");
  assert.deepEqual(call.args.slice(-5), ["--", "nabire", "sh", "-s", NONCE], "T-091: the nonce is the script's argument");
  assert.ok(call.args.includes("StrictHostKeyChecking=yes"));
  assert.equal(call.stdin.includes(NONCE), false, "T-091: the script text has no nonce");
  assert.ok(call.stdin.includes(`@@BEGIN %s %s@@`));
  assert.ok(call.stdin.includes("section hostname uname -n"));
  assert.equal(call.timeoutMs, 30_000);
  assert.equal(call.maxStdoutBytes, 1024 * 1024);
});

test("blocked DNS resolution result is rejected before connecting", async () => {
  const knownHostsFile = await pinnedFile(["nabire"]);
  const { runner, calls } = spy({});
  const { TargetRejectedError } = await import("./transport.js");
  const result = await collectViaSsh(target, { knownHostsFile }, deps(runner, {
    checkResolution: async () => { throw new TargetRejectedError("blocked"); },
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, "TARGET_REJECTED");
  assert.equal(calls.length, 0);
});

test("ssh failures map to fixed codes and never expose stderr", async () => {
  const knownHostsFile = await pinnedFile(["nabire"]);
  const cases: Array<[string, string]> = [
    ["REMOTE HOST IDENTIFICATION HAS CHANGED /home/u/.ssh/id_secret", "HOST_KEY_CHANGED"],
    ["spotty@nabire: Permission denied (publickey).", "AUTH_FAILED"],
    ["ssh: connect to host nabire port 22: Connection refused", "ROUTE_UNAVAILABLE"],
  ];
  for (const [stderr, code] of cases) {
    const { runner } = spy({ exitCode: 255, stdout: "", stderr });
    const result = await collectViaSsh(target, { knownHostsFile }, deps(runner));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.code, code);
      assert.equal(JSON.stringify(result).includes("id_secret"), false);
      assert.equal(result.contacted, true);
    }
  }
});

test("timeouts and spawn failures are reported, not treated as empty success", async () => {
  const knownHostsFile = await pinnedFile(["nabire"]);
  const timeout = await collectViaSsh(target, { knownHostsFile }, deps(spy({ timedOut: true, stdout: "" }).runner));
  assert.equal(timeout.ok, false);
  if (!timeout.ok) assert.equal(timeout.failure.code, "TIMEOUT");
  const spawn = await collectViaSsh(target, { knownHostsFile }, deps(spy({ spawnFailed: true, exitCode: null, stdout: "" }).runner));
  assert.equal(spawn.ok, false);
});

test("output with no valid markers is a failure, not a healthy empty observation", async () => {
  const knownHostsFile = await pinnedFile(["nabire"]);
  const result = await collectViaSsh(target, { knownHostsFile }, deps(spy({ stdout: "garbage\nwith no markers" }).runner));
  assert.equal(result.ok, false);
});

test("size-capped output is flagged truncated and later sections are unavailable", async () => {
  const knownHostsFile = await pinnedFile(["nabire"]);
  const cut = renderOutput(NORMAL).split("@@BEGIN")[0] + `@@BEGIN ${NONCE} hostname@@\nfixture-host\n@@END ${NONCE} hostname 0@@\n@@BEGIN ${NONCE} os@@\nPRETTY`;
  const result = await collectViaSsh(target, { knownHostsFile }, deps(spy({ stdout: cut, stdoutTruncated: true }).runner));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.observation.truncated, true);
    assert.equal(result.observation.host.os.status, "unavailable");
    assert.equal(result.observation.host.hostname.status, "ok");
  }
});
