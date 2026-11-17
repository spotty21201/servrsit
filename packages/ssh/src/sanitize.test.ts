import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSafeHostname,
  isSafeMountPath,
  isSafeUnitName,
  sanitizeLines,
  sanitizeText,
  stripEscapeSequences,
} from "./sanitize.js";

test("strips CSI, OSC and charset escape sequences", () => {
  assert.equal(stripEscapeSequences("a\u001b[31mred\u001b[0mb"), "aredb");
  assert.equal(stripEscapeSequences("x\u001b]0;window title\u0007y"), "xy");
  assert.equal(stripEscapeSequences("x\u001b]8;;http://e.example\u001b\\link\u001b]8;;\u001b\\y"), "xlinky");
  assert.equal(stripEscapeSequences("a\u001b(Bb"), "ab");
});

test("control characters become spaces, so they cannot join into a valid-looking name", () => {
  assert.equal(sanitizeText("ssh\u0000d.service", 64), "ssh d.service");
  assert.equal(isSafeUnitName(sanitizeText("ssh\u0000d.service", 64)), false);
});

test("removes bidirectional and zero-width formatting characters", () => {
  assert.equal(sanitizeText("\u202eevil\u200b.service", 64), "evil.service");
});

test("truncates by code point without splitting a surrogate pair", () => {
  assert.equal(sanitizeText("a😀b😀c", 3), "a😀b");
  assert.equal(sanitizeText("x".repeat(500), 10).length, 10);
});

test("sanitizeLines splits CRLF and leaves no escape characters", () => {
  const lines = sanitizeLines("one\r\ntwo\u001b[2J\nthree");
  assert.deepEqual(lines, ["one", "two", "three"]);
  assert.ok(lines.every((l) => !l.includes("\u001b")));
});

test("name validators accept normal names and reject hostile ones", () => {
  assert.equal(isSafeUnitName("ssh.service"), true);
  assert.equal(isSafeUnitName("systemd-fsck@dev-sda1.service"), true);
  assert.equal(isSafeUnitName("x$(reboot).service"), false);
  assert.equal(isSafeUnitName("a b.service"), false);
  assert.equal(isSafeUnitName("evil.service; rm -rf /"), false);
  assert.equal(isSafeHostname("nabire"), true);
  assert.equal(isSafeHostname("a;b"), false);
  assert.equal(isSafeHostname("-oProxyCommand=x"), false);
  assert.equal(isSafeMountPath("/srv/data"), true);
  assert.equal(isSafeMountPath("/srv/$(reboot)"), false);
  assert.equal(isSafeMountPath("relative"), false);
});
