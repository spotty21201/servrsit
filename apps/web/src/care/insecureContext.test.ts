// Regression (founder report 2026-11-22): on a plain-HTTP origin (the Tailscale address) browsers do not
// provide crypto.randomUUID, so approval silently failed. The key must come from getRandomValues only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newIdempotencyKey } from "./approval.ts";

test("approval key works when crypto.randomUUID is missing (non-secure context)", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
  Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    const k = newIdempotencyKey();
    assert.match(k, /^[A-Za-z0-9_-]{16,128}$/);
    assert.notEqual(k, newIdempotencyKey());
  } finally {
    if (saved) Object.defineProperty(globalThis.crypto, "randomUUID", saved);
  }
});
