import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus, coverageOf, freshUntil, type StatusInput } from "./status.js";
import { makeObservation } from "./observation.fixtures.js";

const MIN = 60_000;
const INTERVAL = 15 * MIN;
const NOW = new Date("2026-11-17T09:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const base: StatusInput = {
  collect: true, collectDisabledReason: undefined, pin: "pinned",
  latestAttempt: { at: ago(MIN), succeeded: true, failure: null },
  lastSuccessAt: ago(MIN), lastSuccessCoverageComplete: true,
  healthIntervalMs: INTERVAL, now: NOW,
};

test("freshness deadline is two health intervals after the observation (PRD FR-06)", () => {
  const at = new Date("2026-11-17T08:00:00.000Z");
  assert.equal(freshUntil(at, INTERVAL).toISOString(), "2026-11-17T08:30:00.000Z");
});

test("fresh within two intervals; stale just after", () => {
  assert.equal(deriveStatus({ ...base, lastSuccessAt: ago(29 * MIN) }).status, "fresh");
  assert.equal(deriveStatus({ ...base, lastSuccessAt: ago(30 * MIN) }).status, "fresh");
  assert.equal(deriveStatus({ ...base, lastSuccessAt: ago(31 * MIN) }).status, "stale");
});

test("fresh but incomplete coverage is 'partial', never 'fresh'", () => {
  assert.equal(deriveStatus({ ...base, lastSuccessCoverageComplete: false }).status, "partial");
});

test("a host with no pinned key is 'unverified-host' regardless of anything else", () => {
  for (const pin of ["not-pinned", "revoked"] as const) {
    const s = deriveStatus({ ...base, pin, latestAttempt: null, lastSuccessAt: null });
    assert.equal(s.status, "unverified-host");
    assert.match(s.statusReason, /not contacted/);
  }
});

test("an unchecked pin is not reported as unverified", () => {
  assert.equal(deriveStatus({ ...base, pin: "unknown", latestAttempt: null, lastSuccessAt: null }).status, "not-yet-checked");
});

test("failed latest attempt wins over older success, and success time is kept by the caller", () => {
  const failed = { at: ago(MIN), succeeded: false, failure: { code: "ROUTE_UNAVAILABLE", message: "x" } };
  assert.equal(deriveStatus({ ...base, latestAttempt: failed, lastSuccessAt: ago(5 * MIN) }).status, "unreachable");
  const auth = { ...failed, failure: { code: "AUTH_FAILED", message: "x" } };
  assert.equal(deriveStatus({ ...base, latestAttempt: auth }).status, "access-denied");
  const key = { ...failed, failure: { code: "HOST_KEY_CHANGED", message: "x" } };
  assert.equal(deriveStatus({ ...base, latestAttempt: key }).status, "host-key-changed");
  const rej = { ...failed, failure: { code: "TARGET_REJECTED", message: "x" } };
  assert.equal(deriveStatus({ ...base, latestAttempt: rej }).status, "misconfigured");
});

test("disabled collection is explicit, with its reason", () => {
  const s = deriveStatus({ ...base, collect: false, collectDisabledReason: "No key.", latestAttempt: null, lastSuccessAt: null });
  assert.deepEqual(s, { status: "collection-disabled", statusReason: "No key." });
});

test("no attempt yet is 'not-yet-checked'", () => {
  assert.equal(deriveStatus({ ...base, latestAttempt: null, lastSuccessAt: null }).status, "not-yet-checked");
});

test("coverage lists each unavailable check with its reason", () => {
  const full = coverageOf(makeObservation());
  assert.equal(full.passed, full.total);
  assert.deepEqual(full.unavailable, []);
  const partial = coverageOf(makeObservation({ unavailableChecks: true }));
  assert.equal(partial.passed, partial.total - 1);
  assert.deepEqual(partial.unavailable, [{ check: "memory", reason: "missing from meminfo: MemAvailable" }]);
});

test("T-061: the clock is one of the counted checks; when it cannot be read it is listed as unavailable", () => {
  const ok = coverageOf(makeObservation());
  assert.equal(ok.total, 16);
  assert.equal(ok.passed, 16);
  const missing = coverageOf(makeObservation({ clockSkewSeconds: null }));
  assert.equal(missing.passed, 15);
  assert.deepEqual(missing.unavailable, [{ check: "clock", reason: "target time not in expected format" }]);
});
