import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerDraftRequestSchema } from "@servrsit/contracts";
import {
  compareFingerprint, EMPTY_DRAFT, hasErrors, normaliseFingerprint, parseDraft, parseDraftId, registrationError, serializeDraft,
  toDraftRequest, treatedAsProduction, validateAddress, validateMeet, validatePort, validateRole, validateUser,
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

test("user, name and role follow the contract's own patterns", () => {
  assert.equal(validateUser("deploy"), null);
  for (const u of ["", "Root", "1abc", "a b", "x".repeat(33), "a;b"]) assert.notEqual(validateUser(u), null, u);
  const base = { ...EMPTY_DRAFT, address: "10.0.0.5", user: "ops", classification: "non-production" as const };
  assert.equal(hasErrors(validateMeet({ ...base, name: "Fixture Box-1" })), false);
  assert.equal(validateMeet({ ...base, name: "-bad" }).name !== undefined, true);
  assert.equal(validateMeet({ ...base, name: "has/slash" }).name !== undefined, true);
  assert.equal(validateRole(""), null);
  assert.equal(validateRole("Client-facing VPS (Europe)"), null);
  assert.notEqual(validateRole("<script>"), null);
});

test("classification is required, 'not sure' is sent as production, the name never decides", () => {
  const base = { ...EMPTY_DRAFT, name: "scratch-box", address: "10.0.0.5", user: "ops" };
  assert.equal(validateMeet(base).classification !== undefined, true);
  assert.equal(treatedAsProduction("not-sure"), true);
  assert.equal(treatedAsProduction("non-production"), false);
  assert.equal(toDraftRequest({ ...base, classification: "not-sure" }).production, true);
  assert.equal(toDraftRequest({ ...base, classification: "non-production" }).production, false);
});

test("the request built from a valid form passes the contract's own schema", () => {
  const req = toDraftRequest({ ...EMPTY_DRAFT, name: "Fixture Box", address: "10.0.0.5", port: "2222", user: "ops", role: " Build machine ", classification: "production" });
  assert.deepEqual(req, { address: "10.0.0.5", port: 2222, user: "ops", name: "Fixture Box", role: "Build machine", production: true });
  assert.equal(ServerDraftRequestSchema.safeParse(req).success, true);
  const noRole = toDraftRequest({ ...EMPTY_DRAFT, name: "Fixture Box", address: "10.0.0.5", user: "ops", classification: "non-production" });
  assert.equal(noRole.role, null);
  assert.equal(ServerDraftRequestSchema.safeParse(noRole).success, true);
});

test("the saved form draft holds only whitelisted non-secret fields; junk and stray ids are rejected", () => {
  const d = { ...EMPTY_DRAFT, name: "n", address: "10.0.0.5", user: "ops", classification: "production" as const, privateKey: "-----BEGIN KEY-----", password: "hunter2" } as never;
  const text = serializeDraft(d);
  assert.doesNotMatch(text, /BEGIN|hunter2|password|privateKey/);
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["address", "classification", "interval", "name", "port", "role", "user"]);
  assert.equal(parseDraft("not json"), null);
  assert.equal(parseDraft("x".repeat(5000)), null);
  assert.equal(parseDraft(JSON.stringify({ classification: "bogus", port: "" }))?.classification, null);
  assert.equal(parseDraftId("00000000-0000-4000-8000-000000000001"), "00000000-0000-4000-8000-000000000001");
  assert.equal(parseDraftId("../etc/passwd"), null);
  assert.equal(parseDraftId(null), null);
});

test("fingerprint comparison: exact, case-sensitive, bare 43 characters accepted, malformed rejected", () => {
  const fp = "SHA256:bX7Qf0Zt3m9H2cJkL8aVwYpR5nUe1dGsTiOoNqMxEhA";
  assert.equal(normaliseFingerprint(` ${fp} `), fp);
  assert.equal(normaliseFingerprint(fp.slice(7)), fp);
  assert.equal(compareFingerprint(fp, fp), "match");
  assert.equal(compareFingerprint(fp, fp.slice(7)), "match");
  assert.equal(compareFingerprint(fp, `SHA256:${fp.slice(7).toLowerCase()}`), "mismatch");
  assert.equal(compareFingerprint(fp, "SHA256:aX7Qf0Zt3m9H2cJkL8aVwYpR5nUe1dGsTiOoNqMxEhA"), "mismatch");
  assert.equal(compareFingerprint(fp, ""), "empty");
  assert.equal(compareFingerprint(fp, "short"), "malformed");
  assert.equal(compareFingerprint(fp, "MD5:aa:bb:cc"), "malformed");
});

test("every contract error code has fixed wording; none echoes server text beyond our own reason", () => {
  for (const code of ["INVALID_INPUT", "ADDRESS_REJECTED", "DUPLICATE_SERVER", "DRAFT_NOT_FOUND", "DRAFT_EXPIRED", "HOST_KEY_NOT_CONFIRMED", "FINGERPRINT_MISMATCH", "HOST_KEY_CHANGED", "ROUTE_UNAVAILABLE", "STATE_CONFLICT", "SERVER_NOT_FOUND"] as const) {
    assert.ok(registrationError({ error: code }).length > 10, code);
  }
  for (const code of ["NETWORK", "TIMEOUT", "INVALID_RESPONSE"] as const) {
    assert.match(registrationError({ error: code }), /may or may not have happened/, code);
    assert.doesNotMatch(registrationError({ error: code }), /Nothing was changed/, code);
  }
  assert.match(registrationError({ error: "CSRF_INVALID" }), /security check failed/);
  assert.match(registrationError({ error: "UNAUTHENTICATED" }), /signed out/);
  assert.match(registrationError({ error: "FINGERPRINT_MISMATCH" }), /Nothing was trusted/);
});
