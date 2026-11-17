import { test } from "node:test";
import assert from "node:assert/strict";
import { createScrubber, REDACTED } from "./redact.js";
import { FAKE_API_KEY } from "./ai.fixtures.js";

const scrub = createScrubber([FAKE_API_KEY]);

test("replaces the exact secret wherever it appears in a string", () => {
  const out = scrub(`failed calling with ${FAKE_API_KEY} and again ${FAKE_API_KEY}`);
  assert.equal(out, `failed calling with ${REDACTED} and again ${REDACTED}`);
});

test("replaces the URL-encoded form too", () => {
  assert.equal(String(scrub(`GET /x?k=${encodeURIComponent(FAKE_API_KEY + "&a b")}`)).includes(FAKE_API_KEY), false);
  const odd = createScrubber(["key with/odd chars+12345"]);
  assert.equal(String(odd(`?k=${encodeURIComponent("key with/odd chars+12345")}`)).includes("odd"), false);
});

test("redacts bearer credentials even when the value is unknown", () => {
  assert.equal(scrub("Authorization: Bearer abcDEF123456.xyz"), `Authorization: Bearer ${REDACTED}`);
  assert.equal(scrub("authorization: basic dXNlcjpwYXNz"), `authorization: basic ${REDACTED}`);
});

test("walks nested objects and arrays", () => {
  const out = scrub({ a: { b: [`x ${FAKE_API_KEY} y`, 1, null, true] }, ok: "fine" }) as { a: { b: unknown[] }; ok: string };
  assert.equal(out.a.b[0], `x ${REDACTED} y`);
  assert.deepEqual(out.a.b.slice(1), [1, null, true]);
  assert.equal(out.ok, "fine");
});

test("values under credential-like key names are replaced outright", () => {
  const out = scrub({ headers: { authorization: "anything", Cookie: "s=1", "x-api-key": "k" }, apiKey: "v", password: "p", token: "t", name: "keep" }) as Record<string, unknown>;
  assert.deepEqual(out["headers"], { authorization: REDACTED, Cookie: REDACTED, "x-api-key": REDACTED });
  assert.equal(out["apiKey"], REDACTED);
  assert.equal(out["password"], REDACTED);
  assert.equal(out["token"], REDACTED);
  assert.equal(out["name"], "keep");
});

test("errors keep their type and message but lose the secret, including in the stack", () => {
  const e = new Error(`request to https://x failed, key ${FAKE_API_KEY}`);
  const out = scrub(e) as { type: string; message: string; stack: string };
  assert.equal(out.type, "Error");
  assert.equal(out.message.includes(FAKE_API_KEY), false);
  assert.equal(out.stack.includes(FAKE_API_KEY), false);
  assert.match(out.message, /request to https:\/\/x failed/);
});

test("handles circular references and depth without throwing", () => {
  const a: Record<string, unknown> = { name: "a" };
  a["self"] = a;
  assert.doesNotThrow(() => scrub(a));
  let deep: Record<string, unknown> = { v: FAKE_API_KEY };
  for (let i = 0; i < 20; i++) deep = { n: deep };
  assert.equal(JSON.stringify(scrub(deep)).includes(FAKE_API_KEY), false);
});

test("short or empty secrets are ignored so ordinary text is not mangled", () => {
  const s = createScrubber(["", "abc", "short"]);
  assert.equal(s("abc short text"), "abc short text");
});

test("non-plain objects are passed through untouched for their own serializers", () => {
  class Req { url = "/x"; }
  const r = new Req();
  assert.equal(scrub(r), r);
});

test("with no secrets, ordinary values are unchanged", () => {
  const s = createScrubber([]);
  assert.deepEqual(s({ a: 1, b: "two" }), { a: 1, b: "two" });
});
