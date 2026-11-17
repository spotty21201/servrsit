import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCollectorScript, isValidNonce, REMOTE_COMMAND } from "./script.js";
import { COLLECTOR_SECTIONS } from "./sections.js";
import { NONCE } from "./collector.fixtures.js";

const script = buildCollectorScript(NONCE);

test("nonce must be 32 lowercase hex characters", () => {
  assert.equal(isValidNonce(NONCE), true);
  assert.equal(isValidNonce("xyz"), false);
  assert.throws(() => buildCollectorScript("not-hex; rm -rf /"));
});

test("remote command line is the fixed `sh -s`", () => {
  assert.deepEqual([...REMOTE_COMMAND], ["sh", "-s"]);
});

test("script is read-only: no privilege, refresh, write, or service control", () => {
  const forbidden: RegExp[] = [
    /\bsudo\b/, /\bsu\b/, /\bdoas\b/,
    /apt-get\s+(?!-s\b)/, // every apt-get call must start with -s (simulate)
    /\bapt\s+(update|upgrade|install|remove)/,
    /\bdpkg\b/, /\bpip\b/, /\bcurl\b/, /\bwget\b/,
    /\brm\b/, /\bmv\b/, /\bcp\b/, /\btee\b/, /\bchmod\b/, /\bchown\b/, /\bmkdir\b/, /\btouch\b/,
    /systemctl\s+(restart|start|stop|reload|enable|disable|mask|kill|daemon)/,
    // Standalone words only: `reboot-required` (a path we read) must stay allowed.
    /(^|[\s;&|])(reboot|shutdown|poweroff|halt)(\s|$)/m,
  ];
  for (const re of forbidden) {
    assert.equal(re.test(script), false, `script must not match ${re}`);
  }
});

test("no redirection other than from/to /dev/null, and no pipes or command substitution", () => {
  const withoutDevNull = script
    .replace(/2>\/dev\/null/g, "")
    .replace(/>\/dev\/null/g, "")
    .replace(/<\/dev\/null/g, "");
  assert.equal(/[<>]/.test(withoutDevNull), false, "unexpected redirection in script");
  assert.equal(/\$\(|`/.test(script), false);
  assert.equal(/\|/.test(script), false);
});

test("every collector command is on the reviewed allowlist", () => {
  const allowed = [
    /^uname -[nm]$/, /^cat \/etc\/os-release$/, /^cat \/proc\/(sys\/kernel\/random\/boot_id|uptime|loadavg|meminfo)$/,
    /^nproc$/, /^\$T df -P(i)? -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs$/,
    /^\$T systemctl --failed --no-legend --plain --no-pager$/,
    /^\$T apt-get -s -o Debug::NoLocking=1 upgrade$/,
    /^stat -c %Y \/var\/lib\/apt\/periodic\/update-success-stamp$/,
    /^test -e \/var\/run\/reboot-required$/,
  ];
  for (const s of COLLECTOR_SECTIONS) {
    assert.ok(allowed.some((re) => re.test(s.command)), `unreviewed command: ${s.command}`);
  }
});

test("each section is wrapped with the nonce markers", () => {
  for (const s of COLLECTOR_SECTIONS) assert.ok(script.includes(`section ${s.name} `));
  assert.ok(script.includes(`@@BEGIN ${NONCE} %s@@`));
  assert.ok(script.includes(`@@END ${NONCE} %s %s@@`));
});
