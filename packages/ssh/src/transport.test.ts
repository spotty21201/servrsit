import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSshArgv, classifySshFailure, isBlockedAddress, pinStateFor,
  TargetRejectedError, validateTarget,
} from "./transport.js";

const KNOWN = "/tmp/servrsit-test/known_hosts";
const target = { host: "nabire", port: 22, user: "spotty" } as const;

test("argv carries every required hardening option and the fixed remote command", () => {
  const argv = buildSshArgv({ ...target, identityFile: "/keys/id_test" }, { knownHostsFile: KNOWN });
  const has = (a: string, b?: string) =>
    b === undefined ? argv.includes(a) : argv.some((x, i) => x === a && argv[i + 1] === b);
  assert.ok(has("-F", "/dev/null"));
  assert.ok(has("-T"));
  for (const o of [
    "BatchMode=yes", "StrictHostKeyChecking=yes", `UserKnownHostsFile=${KNOWN}`,
    "GlobalKnownHostsFile=/dev/null", "ConnectTimeout=10", "ForwardAgent=no",
    "ClearAllForwardings=yes", "PermitLocalCommand=no", "ProxyCommand=none",
    "IdentityAgent=none", "PasswordAuthentication=no", "KbdInteractiveAuthentication=no",
    "IdentitiesOnly=yes",
  ]) assert.ok(has("-o", o), `missing -o ${o}`);
  assert.ok(has("-i", "/keys/id_test"));
  assert.deepEqual(argv.slice(-4), ["--", "nabire", "sh", "-s"]);
  assert.equal(argv.includes("sudo"), false);
});

test("without an identity file, IdentitiesOnly and -i are absent", () => {
  const argv = buildSshArgv(target, { knownHostsFile: KNOWN });
  assert.equal(argv.includes("-i"), false);
  assert.equal(argv.includes("IdentitiesOnly=yes"), false);
});

test("rejects option-injection, shell syntax, loopback, metadata, link-local, and bad ports/users", () => {
  const opts = { knownHostsFile: KNOWN };
  const bad: Array<[string, Partial<{ host: string; port: number; user: string }>]> = [
    ["option injection", { host: "-oProxyCommand=touch_x" }],
    ["spaces", { host: "a b" }],
    ["shell syntax", { host: "a;reboot" }],
    ["URI scheme", { host: "ssh://nabire" }],
    ["embedded credentials", { host: "user@nabire" }],
    ["localhost", { host: "localhost" }],
    ["loopback v4", { host: "127.0.0.1" }],
    ["metadata", { host: "169.254.169.254" }],
    ["loopback v6", { host: "::1" }],
    ["link-local v6", { host: "fe80::1" }],
    ["unapproved port", { port: 2222 }],
    ["bad user", { user: "root;ls" }],
    ["empty user", { user: "" }],
  ];
  for (const [label, patch] of bad) {
    assert.throws(() => validateTarget({ ...target, ...patch }, opts), TargetRejectedError, label);
  }
  assert.throws(() => validateTarget(target, { knownHostsFile: "/tmp/a b/known_hosts" }), TargetRejectedError);
  assert.doesNotThrow(() => validateTarget({ ...target, host: "100.97.49.76" }, opts));
});

test("blocked address helper", () => {
  for (const a of ["0.0.0.0", "127.1.2.3", "169.254.0.5", "::", "::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isBlockedAddress(a), true, a);
  }
  for (const a of ["100.97.49.76", "10.0.0.5", "8.8.8.8"]) assert.equal(isBlockedAddress(a), false, a);
});

test("pin state: pinned, absent, missing file, non-default port, revoked, hashed entries ignored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "servrsit-kh-"));
  const file = join(dir, "known_hosts");
  const key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFIXTUREFIXTUREFIXTUREFIXTUREFIXTUREFIXTURE0";
  await writeFile(file, [
    "# comment", `nabire ${key}`, `[other]:2222 ${key}`, `@revoked bad ${key}`,
    `|1|abc=|def= ${key}`, `@cert-authority ca ${key}`,
  ].join("\n"));
  assert.equal(await pinStateFor(file, "nabire", 22), "pinned");
  assert.equal(await pinStateFor(file, "NABIRE", 22), "pinned");
  assert.equal(await pinStateFor(file, "sentani", 22), "not-pinned");
  assert.equal(await pinStateFor(file, "other", 2222), "pinned");
  assert.equal(await pinStateFor(file, "other", 22), "not-pinned");
  assert.equal(await pinStateFor(file, "bad", 22), "revoked");
  assert.equal(await pinStateFor(file, "ca", 22), "not-pinned");
  assert.equal(await pinStateFor(join(dir, "missing"), "nabire", 22), "not-pinned");
});

test("ssh stderr is mapped to a fixed failure code", () => {
  assert.equal(classifySshFailure("@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed."), "HOST_KEY_CHANGED");
  assert.equal(classifySshFailure("Host key verification failed."), "HOST_UNTRUSTED");
  assert.equal(classifySshFailure("spotty@h: Permission denied (publickey,password)."), "AUTH_FAILED");
  assert.equal(classifySshFailure("ssh: connect to host h port 22: Connection timed out"), "ROUTE_UNAVAILABLE");
  assert.equal(classifySshFailure("ssh: Could not resolve hostname h"), "ROUTE_UNAVAILABLE");
  assert.equal(classifySshFailure("something odd"), "COLLECTION_FAILED");
});
