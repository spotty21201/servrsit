/** [FIXTURE DATA] T-091: the replacement inspect-key line for a server registered before T-091. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectKeyOptions } from "@servrsit/ssh";
import type { StoredServer } from "@servrsit/store";
import { forcedCommandLine } from "./inspect-key-line.js";

const KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixtureFixt";

function row(over: Partial<StoredServer> = {}): StoredServer {
  return {
    id: "00000000-0000-4000-8000-0000000091a1", source: "registration", access: "ssh", name: "Sentani", role: null, productionStatus: "no", production: false,
    address: "100.101.102.103", port: 22, user: "spotty", identityFile: "/k", knownHostsFile: "/kh", importantServices: [], collect: true, collectDisabledReason: null,
    writesEnabled: false, hostKey: null, createdAt: "2026-11-21T00:00:00.000Z", disconnectedAt: null,
    accessKey: { authorizedKeysLine: `restrict,from="100.104.220.8" ssh-ed25519 ${KEY} servrsit-sentani`, algorithm: "ED25519", keyFingerprint: "SHA256:x", controllerAddress: "100.104.220.8", createdAt: "2026-11-21T00:00:00.000Z" },
    ...over,
  } as StoredServer;
}

test("an old line becomes the forced-command line with the same key and comment", () => {
  const r = forcedCommandLine(row());
  assert.deepEqual(r, { ok: true, line: `${inspectKeyOptions("100.104.220.8")} ssh-ed25519 ${KEY} servrsit-sentani`, comment: "servrsit-sentani" });
  const again = forcedCommandLine(row({ accessKey: { ...row().accessKey!, authorizedKeysLine: r.ok ? r.line : "" } }));
  assert.deepEqual(again, r, "already converted: the same line");
});

test("no line for a server without a ServrSit-made key, or with an unexpected line", () => {
  assert.equal(forcedCommandLine(row({ accessKey: null })).ok, false);
  assert.equal(forcedCommandLine(row({ access: "local" })).ok, false);
  assert.equal(forcedCommandLine(row({ accessKey: { ...row().accessKey!, authorizedKeysLine: "ssh-rsa AAAA other" } })).ok, false);
});
