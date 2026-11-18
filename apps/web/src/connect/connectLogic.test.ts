import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareFingerprint, EMPTY_DRAFT, hasErrors, normaliseFingerprint, parseDraft, serializeDraft, treatedAsProduction,
  validateAddress, validateMeet, validatePort, validateUsername,
} from "./connectLogic";

test("good addresses: hostnames, private and CGNAT IPv4, IPv6", () => {
  for (const a of ["example.org", "web-1.internal.example.org", "192.168.1.20", "10.0.0.5", "100.64.12.7", "2001:db8::1", " 203.0.113.9 "]) assert.equal(validateAddress(a), null, a);
});

test("refused: schemes, credentials, shell syntax, option-like, paths, ports in the address", () => {
  for (const a of ["ssh://host", "user@host", "host; rm -rf /", "host && id", "$(id)", "`id`", "-oProxyCommand=x", "host/path", "host:22", "a b", "", "a".repeat(254)]) {
    assert.notEqual(validateAddress(a), null, JSON.stringify(a));
  }
});

test("refused: loopback, unspecified, link-local and metadata, multicast, bad octets, localhost names", () => {
  for (const a of ["127.0.0.1", "127.1.2.3", "0.0.0.0", "169.254.169.254", "169.254.0.5", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "256.1.1.1", "1.2.3", "localhost", "LOCALHOST.", "foo.localhost", "metadata.google.internal"]) {
    assert.notEqual(validateAddress(a), null, a);
  }
});

test("ports: 22 or 1024–65535 only", () => {
  for (const p of ["22", "2222", "1024", "65535"]) assert.equal(validatePort(p), null, p);
  for (const p of ["", "0", "21", "80", "443", "1023", "65536", "22.5", "abc", "-1"]) assert.notEqual(validatePort(p), null, p);
});

test("user names follow Linux rules", () => {
  assert.equal(validateUsername("deploy"), null);
  assert.equal(validateUsername("svc_user-1"), null);
  for (const u of ["", "Root", "1abc", "a b", "x".repeat(33), "a;b"]) assert.notEqual(validateUsername(u), null, u);
});

test("step 1 needs an explicit classification; the name never decides it", () => {
  const base = { ...EMPTY_DRAFT, name: "scratch-box", address: "10.0.0.5", username: "ops" };
  assert.equal(validateMeet(base).classification !== undefined, true);
  assert.equal(hasErrors(validateMeet({ ...base, classification: "non-production" })), false);
  assert.equal(treatedAsProduction("not-sure"), true);
  assert.equal(treatedAsProduction("production"), true);
  assert.equal(treatedAsProduction("non-production"), false);
  assert.equal(treatedAsProduction(null), false);
});

test("the saved draft contains only whitelisted non-secret fields", () => {
  const d = { ...EMPTY_DRAFT, name: "n", address: "10.0.0.5", username: "ops", classification: "production" as const, privateKey: "-----BEGIN KEY-----", password: "hunter2", fingerprintConfirmed: true } as never;
  const text = serializeDraft(1, d);
  assert.doesNotMatch(text, /BEGIN|hunter2|password|privateKey|fingerprintConfirmed/);
  assert.deepEqual(Object.keys(JSON.parse(text).draft).sort(), ["access", "address", "classification", "interval", "name", "port", "purpose", "username"]);
});

test("a restored draft never resumes past step 2 and never enables maintenance; junk is rejected", () => {
  const r = parseDraft(JSON.stringify({ step: 3, draft: { name: "n", access: "maintenance", classification: "bogus", port: "" } }));
  assert.equal(r?.step, 1);
  assert.equal(r?.draft.access, "inspect-only");
  assert.equal(r?.draft.classification, null);
  assert.equal(r?.draft.port, "22");
  assert.equal(parseDraft("not json"), null);
  assert.equal(parseDraft(null), null);
  assert.equal(parseDraft("x".repeat(9000)), null);
});

test("fingerprint comparison: exact, case-sensitive, accepts the SHA256: prefix, rejects malformed input", () => {
  const fp = "SHA256:bX7Qf0Zt3m9H2cJkL8aVwYpR5nUe1dGsTiOoNqMxEhA";
  assert.equal(normaliseFingerprint(` ${fp} `), "bX7Qf0Zt3m9H2cJkL8aVwYpR5nUe1dGsTiOoNqMxEhA");
  assert.equal(compareFingerprint(fp, fp), "match");
  assert.equal(compareFingerprint(fp, "bX7Qf0Zt3m9H2cJkL8aVwYpR5nUe1dGsTiOoNqMxEhA"), "match");
  assert.equal(compareFingerprint(fp, `SHA256:${fp.slice(7).toLowerCase()}`), "mismatch");
  assert.equal(compareFingerprint(fp, "SHA256:aX7Qf0Zt3m9H2cJkL8aVwYpR5nUe1dGsTiOoNqMxEhA"), "mismatch");
  assert.equal(compareFingerprint(fp, ""), "empty");
  assert.equal(compareFingerprint(fp, "short"), "malformed");
  assert.equal(compareFingerprint(fp, "MD5:aa:bb:cc"), "malformed");
});
