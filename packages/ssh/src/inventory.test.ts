/**
 * [FIXTURE DATA] Synthetic inventory output in the format the fixed script
 * prints. None of it describes a real server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCollectorScript } from "./script.js";
import { buildInventory, collectInventoryViaSsh, INVENTORY_SECTIONS } from "./inventory.js";
import type { RunRequest, RunResult } from "./runner.js";

const NONCE = "0123456789abcdef0123456789abcdef";
const AT = new Date("2026-11-17T10:00:00.000Z");
const sec = (name: string, body: string, rc = 0) => `@@BEGIN ${NONCE} ${name}@@\n${body}\n@@END ${NONCE} ${name} ${rc}@@`;

function output(over: Record<string, [string, number?]> = {}): string {
  const base: Record<string, [string, number?]> = {
    srvexists: ["", 0],
    srvdirs: ["/srv/app deploy deploy 755\n/srv/app/releases deploy deploy 750\n/srv/bad path root root 755\n/srv/../etc root root 755", 0],
    homepath: ["/home/owner", 0],
    homedirs: ["/home/owner/projects owner owner 700", 0],
    pkgs: ["nginx 1.24.0-2ubuntu7.1\ndocker-ce 5:27.3.1-1~ubuntu.24.04~noble\nbad;name 1", 0],
    ubuntupkgs: ["nginx", 0],
    ...over,
  };
  return INVENTORY_SECTIONS.map((s) => sec(s.name, base[s.name]![0], base[s.name]![1])).join("\n");
}

test("directories, home, packages and Ubuntu-archive membership are parsed; malformed lines are skipped, never trusted", () => {
  const inv = buildInventory(output(), NONCE, AT, "ssh");
  assert.deepEqual(inv.home, { status: "ok", value: "/home/owner", partial: false });
  assert.equal(inv.directories.status, "ok");
  if (inv.directories.status !== "ok") return;
  assert.deepEqual(inv.directories.value.map((d) => `${d.path} ${d.owner}:${d.group} ${d.mode}`), [
    "/srv/app deploy:deploy 0755", "/srv/app/releases deploy:deploy 0750", "/home/owner/projects owner:owner 0700",
  ]);
  assert.equal(inv.directories.partial, true, "skipped lines make the listing partial");
  assert.deepEqual(inv.packages.status === "ok" && inv.packages.value, { nginx: "1.24.0-2ubuntu7.1", "docker-ce": "5:27.3.1-1~ubuntu.24.04~noble" });
  assert.deepEqual(inv.ubuntuPackages.status === "ok" && inv.ubuntuPackages.value, ["nginx"]);
});

test("no /srv is an empty list; unreadable parts are partial; failed sections are unavailable, not empty", () => {
  const noSrv = buildInventory(output({ srvexists: ["", 1], srvdirs: ["", 1] }), NONCE, AT, "ssh");
  assert.deepEqual(noSrv.directories.status === "ok" && noSrv.directories.value.map((d) => d.path), ["/home/owner/projects"]);
  const denied = buildInventory(output({ srvdirs: ["/srv/app deploy deploy 755", 1] }), NONCE, AT, "ssh");
  assert.equal(denied.directories.status === "ok" && denied.directories.partial, true);
  const noLists = buildInventory(output({ ubuntupkgs: ["", 2] }), NONCE, AT, "ssh");
  assert.equal(noLists.ubuntuPackages.status, "unavailable");
  const noPkgs = buildInventory(output({ pkgs: ["", 2] }), NONCE, AT, "ssh");
  assert.equal(noPkgs.packages.status, "unavailable");
});

test("a marker without the run's nonce is data, not a section boundary", () => {
  const forged = output({ homedirs: [`@@END ${"f".repeat(32)} homedirs 0@@\n/home/owner/projects owner owner 700`, 0] });
  const inv = buildInventory(forged, NONCE, AT, "ssh");
  assert.equal(inv.directories.status === "ok" && inv.directories.value.some((d) => d.path === "/home/owner/projects"), true);
});

test("the inventory script is read-only: no privilege, no writes, no package tools, no network, no pipes or substitution", () => {
  const script = buildCollectorScript(NONCE, INVENTORY_SECTIONS);
  for (const re of [/\bsudo\b/, /\bsu\b/, /\bdoas\b/, /\bapt\s/, /apt-get/, /\bdpkg\b(?!\/status)/, /\bcurl\b/, /\bwget\b/, /\brm\b/, /\bmv\b/, /\bcp\b/, /\btee\b/, /\bchmod\b/, /\bchown\b/, /\bmkdir\b/, /\btouch\b/, /-delete\b/, /-exec\b/, /-fprintf\b/, /\bsystem\(/, /getline/]) {
    assert.equal(re.test(script), false, `inventory script must not match ${re}`);
  }
  const withoutDevNull = script.replace(/2>\/dev\/null/g, "").replace(/>\/dev\/null/g, "").replace(/<\/dev\/null/g, "");
  // awk's own "print" has no redirection here; any > or < outside /dev/null is refused.
  assert.equal(/[<>|]/.test(withoutDevNull.replace(/\$0/g, "")), false);
  assert.equal(/\$\(|`/.test(script), false);
  const allowed = [
    /^test -d \/srv$/,
    /^\$T find \/srv -mindepth 1 -maxdepth 2 -type d -printf '%p %u %g %m\\n'$/,
    /^printf '%s\\n' "\$HOME"$/,
    /^\$T find "\$HOME" -mindepth 1 -maxdepth 1 -type d ! -name '\.\*' -printf '%p %u %g %m\\n'$/,
    /^\$T awk '[^']+' \/var\/lib\/dpkg\/status$/,
    /^\$T awk '[^']+' \/var\/lib\/dpkg\/status \/var\/lib\/apt\/lists\/\*ubuntu\.com_ubuntu_dists_\*_Packages$/,
  ];
  for (const s of INVENTORY_SECTIONS) assert.ok(allowed.some((re) => re.test(s.command)), `unreviewed inventory command: ${s.command}`);
});

test("over SSH the inventory refuses an unpinned host without contacting it", async () => {
  const calls: RunRequest[] = [];
  const runner = async (r: RunRequest): Promise<RunResult> => { calls.push(r); return { exitCode: 0, stdout: "", stderr: "", timedOut: false, stdoutTruncated: false, spawnFailed: false }; };
  const r = await collectInventoryViaSsh({ host: "198.51.100.7", port: 22, user: "u" }, { knownHostsFile: "/nonexistent/known_hosts" }, { runner });
  assert.deepEqual(r.ok ? null : r.code, "HOST_UNTRUSTED");
  assert.equal(calls.length, 0);
});
