/**
 * [FIXTURE DATA] T-089 package preview. The apt and dpkg outputs below are
 * written in the formats apt 2.7 and dpkg 1.22 print on Ubuntu 24.04; none
 * of them comes from a real server. No test here starts ssh.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedConffiles, collectInstalledViaSsh, collectPackagePreviewViaSsh, CONFFILE_SECTIONS, INSTALLED_SECTIONS, parseAptUpgrade, parseConffiles, parseInstalled, parseMd5sums, PREVIEW_SECTIONS } from "./preview.js";
import { spawnSync } from "node:child_process";
import { splitSections } from "./parse.js";
import { buildCollectorScript } from "./script.js";
import type { RunRequest, RunResult } from "./runner.js";

const NONCE = "0123456789abcdef0123456789abcdef";

const APT = [
  "NOTE: This is only a simulation!",
  "Reading package lists...",
  "The following packages will be upgraded:",
  "  vim-common wget",
  "Inst wget [1.21.4-1ubuntu4] (1.21.4-1ubuntu4.1 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])",
  "Inst vim-common [2:9.1.0016-1ubuntu7.8] (2:9.1.0016-1ubuntu7.9 Ubuntu:24.04/noble-updates [all])",
  "Inst docker-ce [5:27.3.1-1~ubuntu.24.04~noble] (5:27.4.0-1~ubuntu.24.04~noble Docker CE:noble [amd64])",
  "Conf wget (1.21.4-1ubuntu4.1 Ubuntu:24.04/noble-updates [amd64])",
  "Conf vim-common (2:9.1.0016-1ubuntu7.9 Ubuntu:24.04/noble-updates [all])",
].join("\n");

const DPKG = [
  "wget amd64 1.21.4-1ubuntu4 ii ",
  "vim-common all 2:9.1.0016-1ubuntu7.8 ii ",
  "docker-ce amd64 5:27.3.1-1~ubuntu.24.04~noble ii ",
  "nginx amd64 1.24.0-2ubuntu7.1 hi ",
  "removed-pkg amd64 1.0-1 rc ",
  "half amd64 1.0-1 iU ",
  "evil;rm amd64 1.0 ii ",
].join("\n");

test("apt-get -s upgrade: name, arch (including Architecture: all), from, to and origin, multi-origin included", () => {
  const p = parseAptUpgrade(APT);
  assert.equal(p.unreadable, 0);
  assert.deepEqual(p.removals, []);
  assert.deepEqual(p.upgrades, [
    { name: "wget", arch: "amd64", from: "1.21.4-1ubuntu4", to: "1.21.4-1ubuntu4.1", origin: "Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security" },
    { name: "vim-common", arch: "all", from: "2:9.1.0016-1ubuntu7.8", to: "2:9.1.0016-1ubuntu7.9", origin: "Ubuntu:24.04/noble-updates" },
    { name: "docker-ce", arch: "amd64", from: "5:27.3.1-1~ubuntu.24.04~noble", to: "5:27.4.0-1~ubuntu.24.04~noble", origin: "Docker CE:noble" },
  ]);
});

test("removals are listed; a transaction line that cannot be read makes the preview untrusted", () => {
  assert.deepEqual(parseAptUpgrade("Remv oldpkg [1.0-1]").removals, ["oldpkg"]);
  assert.equal(parseAptUpgrade("Inst newpkg (1.0-1 Ubuntu:24.04/noble [amd64])").unreadable, 1, "a new install (no installed version) is not guessed");
  assert.equal(parseAptUpgrade("Inst bad$(id) [1] (2 Ubuntu:24.04/noble [amd64])").unreadable, 1);
  assert.equal(parseAptUpgrade("Remv ../../etc").unreadable, 1);
});

test("dpkg-query: installed and held packages only; broken, removed and malformed lines are ignored", () => {
  const r = parseInstalled(DPKG);
  assert.deepEqual(r.installed, {
    "wget:amd64": "1.21.4-1ubuntu4",
    "vim-common:all": "2:9.1.0016-1ubuntu7.8",
    "docker-ce:amd64": "5:27.3.1-1~ubuntu.24.04~noble",
    "nginx:amd64": "1.24.0-2ubuntu7.1",
  });
  assert.deepEqual(r.held, ["nginx:amd64"]);
});

test("the preview script is read-only: simulated apt, dpkg-query, md5sum of conffiles, nothing else, no sudo, no variable input", () => {
  assert.deepEqual(PREVIEW_SECTIONS.map((s) => s.command), [
    "$T apt-get -s -o Debug::NoLocking=1 upgrade",
    "$T dpkg-query -W -f '${Package} ${Architecture} ${Version} ${db:Status-Abbrev}\\n'",
    "$T dpkg-query -W -f '@${Package}:${Architecture}\\n${Conffiles}\\n'",
    // D-T2: the one reviewed pipeline: dpkg's conffile list, read line by line, hashed if under /etc and readable.
    "$T sh -c 'dpkg-query -W -f \"\\${Conffiles}\\n\" | while read -r p s x; do case $p in /etc/*) if [ -f \"$p\" ] && [ -r \"$p\" ]; then md5sum -- \"$p\"; fi ;; esac; done; exit 0'",
  ]);
  const script = buildCollectorScript(PREVIEW_SECTIONS);
  for (const re of [/\bsudo\b/, /\bsu\b/, /apt-get\s+(?!-s\b)/, /\bdpkg\s/, /\brm\b/, /\$\(|`/, /apt(-get)? update/, />(?!\/dev\/null|&)/]) {
    assert.equal(re.test(script), false, `script must not match ${re}`);
  }
  const withoutReviewedPipe = script.replace(PREVIEW_SECTIONS[3]!.command, "");
  assert.equal(/\|/.test(withoutReviewedPipe.replace(/\|\|/g, "")), false, "no pipe outside the reviewed conffile section");
});

test("D-T2: conffile parsing: dpkg's records per package, md5sum lines, changed = different MD5 only", () => {
  const records = parseConffiles([
    "@wget:amd64",
    " /etc/wgetrc 6a6ad4e3a8a6e6e7d9e1c1d2b3a4f5e6",
    "@vim-common:all",
    " /etc/vim/vimrc 11111111111111111111111111111111",
    " /etc/vim/old 22222222222222222222222222222222 obsolete",
    " /etc/vim/new newconffile",
    "@openssl:amd64",
    " /etc/ssl/openssl.cnf 33333333333333333333333333333333",
    " /etc/../shadow 44444444444444444444444444444444",
    "@bad name:amd64",
    " /etc/x 55555555555555555555555555555555",
  ].join("\n"));
  assert.deepEqual(records, {
    "wget:amd64": [{ path: "/etc/wgetrc", md5: "6a6ad4e3a8a6e6e7d9e1c1d2b3a4f5e6" }],
    "vim-common:all": [{ path: "/etc/vim/vimrc", md5: "11111111111111111111111111111111" }],
    "openssl:amd64": [{ path: "/etc/ssl/openssl.cnf", md5: "33333333333333333333333333333333" }],
  });
  const sums = parseMd5sums([
    "ffffffffffffffffffffffffffffffff  /etc/wgetrc",
    "11111111111111111111111111111111  /etc/vim/vimrc",
    "\\eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee  /etc/odd\\nname",
  ].join("\n"));
  assert.deepEqual(sums, { "/etc/wgetrc": "ffffffffffffffffffffffffffffffff", "/etc/vim/vimrc": "11111111111111111111111111111111" });
  // openssl.cnf has no sum (unreadable to this account): not claimed either way.
  assert.deepEqual(changedConffiles(records, sums), [{ package: "wget:amd64", path: "/etc/wgetrc" }]);
});

test("D-T2: the conffile sections run on this machine's real dpkg and give well-formed results (read-only)", () => {
  const nonce = "fedcba9876543210fedcba9876543210";
  const r = spawnSync("/bin/sh", ["-s", nonce], { input: buildCollectorScript(CONFFILE_SECTIONS), encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0);
  const found = splitSections(r.stdout, nonce, 4 * 1024 * 1024, ["conffiles", "conffilesums"]);
  assert.equal(found.get("conffiles")?.exitCode, 0);
  assert.equal(found.get("conffilesums")?.exitCode, 0);
  const records = parseConffiles(found.get("conffiles")!.output);
  const sums = parseMd5sums(found.get("conffilesums")!.output);
  assert.ok(Object.keys(records).length > 10, "dpkg lists conffiles for many packages");
  assert.ok(Object.keys(sums).length > 10, "readable conffiles are hashed");
  for (const c of changedConffiles(records, sums)) assert.match(c.path, /^\/etc\//);
});

function pinned(): string {
  const dir = mkdtempSync(join(tmpdir(), "servrsit-preview-"));
  const kh = join(dir, "known_hosts");
  writeFileSync(kh, `198.51.100.7 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixtur\n`);
  return kh;
}

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false, stdoutTruncated: false, spawnFailed: false });
const CONFFILES = "@wget:amd64\n /etc/wgetrc 6a6ad4e3a8a6e6e7d9e1c1d2b3a4f5e6\n@vim-common:all\n /etc/vim/vimrc 11111111111111111111111111111111";
const SUMS = "ffffffffffffffffffffffffffffffff  /etc/wgetrc\n11111111111111111111111111111111  /etc/vim/vimrc";
const sections = (apt: string, dpkg: string, aptRc = 0) =>
  `@@BEGIN ${NONCE} aptsim@@\n${apt}\n@@END ${NONCE} aptsim ${aptRc}@@\n@@BEGIN ${NONCE} installed@@\n${dpkg}\n@@END ${NONCE} installed 0@@\n` +
  `@@BEGIN ${NONCE} conffiles@@\n${CONFFILES}\n@@END ${NONCE} conffiles 0@@\n@@BEGIN ${NONCE} conffilesums@@\n${SUMS}\n@@END ${NONCE} conffilesums 0@@\n`;

test("over SSH: the fixed script on stdin, the inspect key, the pinned file; result parsed", async () => {
  const calls: RunRequest[] = [];
  const runner = async (r: RunRequest) => {
    calls.push(r);
    return ok(sections(APT, DPKG));
  };
  const kh = pinned();
  const r = await collectPackagePreviewViaSsh({ host: "198.51.100.7", port: 22, user: "servrsit", identityFile: "/keys/inspect" }, { knownHostsFile: kh }, { runner, nonce: () => NONCE, checkResolution: async () => undefined });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.stdin, buildCollectorScript(PREVIEW_SECTIONS));
  assert.deepEqual(calls[0]!.args.slice(-4), ["198.51.100.7", "sh", "-s", NONCE]);
  assert.ok(calls[0]!.args.includes(`UserKnownHostsFile=${kh}`));
  if (r.ok) {
    assert.equal(r.preview.upgrades.length, 3);
    assert.equal(r.installed.installed["vim-common:all"], "2:9.1.0016-1ubuntu7.8");
    assert.deepEqual(r.changedConffiles, [{ package: "wget:amd64", path: "/etc/wgetrc" }], "D-T2: the owner's changed wgetrc");
  }
});

test("over SSH: unpinned host is never contacted; failed apt or an unreadable line gives no preview", async () => {
  let n = 0;
  const runner = (out: string) => async () => {
    n++;
    return ok(out);
  };
  const deps = { nonce: () => NONCE, checkResolution: async () => undefined };
  const unpinned = await collectPackagePreviewViaSsh({ host: "198.51.100.7", port: 22, user: "servrsit" }, { knownHostsFile: "/nonexistent/kh" }, { ...deps, runner: runner("") });
  assert.equal(unpinned.ok ? null : unpinned.code, "HOST_UNTRUSTED");
  assert.equal(n, 0);
  const kh = pinned();
  const t = { host: "198.51.100.7", port: 22, user: "servrsit" };
  const aptFailed = await collectPackagePreviewViaSsh(t, { knownHostsFile: kh }, { ...deps, runner: runner(sections(APT, DPKG, 100)) });
  assert.equal(aptFailed.ok ? null : aptFailed.code, "OUTPUT_INVALID");
  const unreadable = await collectPackagePreviewViaSsh(t, { knownHostsFile: kh }, { ...deps, runner: runner(sections("Inst x$(id) [1] (2 U [amd64])", DPKG)) });
  assert.equal(unreadable.ok ? null : unreadable.code, "OUTPUT_INVALID");
  const noMarkers = await collectPackagePreviewViaSsh(t, { knownHostsFile: kh }, {
    ...deps,
    runner: async () => ({ exitCode: 255, stdout: "", stderr: "ssh: connect to host 198.51.100.7 port 22: Connection refused", timedOut: false, stdoutTruncated: false, spawnFailed: false }),
  });
  assert.equal(noMarkers.ok ? null : noMarkers.code, "ROUTE_UNAVAILABLE");
});

test("verification reads installed versions only: dpkg-query alone, so a broken apt cannot hide what is installed", async () => {
  assert.deepEqual(INSTALLED_SECTIONS.map((s) => s.name), ["installed"]);
  const calls: RunRequest[] = [];
  const runner = async (r: RunRequest) => {
    calls.push(r);
    return ok(`@@BEGIN ${NONCE} installed@@\n${DPKG}\n@@END ${NONCE} installed 0@@\n`);
  };
  const r = await collectInstalledViaSsh({ host: "198.51.100.7", port: 22, user: "servrsit" }, { knownHostsFile: pinned() }, { runner, nonce: () => NONCE, checkResolution: async () => undefined });
  assert.equal(r.ok && r.installed.installed["wget:amd64"], "1.21.4-1ubuntu4");
  assert.equal(calls[0]!.stdin, buildCollectorScript(INSTALLED_SECTIONS));
  assert.doesNotMatch(calls[0]!.stdin, /apt-get/);
});
