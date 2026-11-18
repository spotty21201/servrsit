/** The oracle must agree with the real ssh-keygen before anything is judged against it. */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintOfBlob, newEd25519, parseAuthorizedKeysLine, optionValue } from "./support/ssh.mts";

test("oracle: fingerprint equals `ssh-keygen -lf` for 20 random ed25519 keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "oracle-"));
  try {
    for (let i = 0; i < 20; i++) {
      const k = newEd25519("oracle-test"); const f = join(dir, `k${i}.pub`); writeFileSync(f, k.openssh + "\n");
      const out = execFileSync("ssh-keygen", ["-lf", f], { encoding: "utf8" }).trim().split(/\s+/);
      assert.equal(out[1], k.fingerprint, `key ${i}`); assert.equal(out[3], "(ED25519)");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("oracle: authorized_keys parsing handles options with quoted commas, no options, and rejects multi-line", () => {
  const k = newEd25519("servrsit-Fixture");
  const p = parseAuthorizedKeysLine(`restrict,from="100.64.0.9,100.64.0.10" ${k.openssh}`);
  assert.deepEqual(p.options, ["restrict", 'from="100.64.0.9,100.64.0.10"']); assert.equal(optionValue(p.options, "from"), "100.64.0.9,100.64.0.10");
  assert.equal(p.type, "ssh-ed25519"); assert.equal(p.fingerprint, k.fingerprint); assert.equal(p.comment, "servrsit-Fixture");
  assert.equal(parseAuthorizedKeysLine(k.openssh).options.length, 0);
  assert.throws(() => parseAuthorizedKeysLine(k.openssh + "\nssh-ed25519 AAAA"));
  assert.equal(fingerprintOfBlob(k.blob), k.fingerprint);
});
