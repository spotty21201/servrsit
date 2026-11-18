import { test } from "node:test";
import assert from "node:assert/strict";
import { clockBanner, describeSpan, FIXTURE_CLOCKS, parseClock } from "./clockBanner";

test("trusted clock and missing controlPlane show no banner", () => {
  assert.equal(clockBanner(FIXTURE_CLOCKS.trusted), null);
  assert.equal(clockBanner(null), null);
});

test("untrusted and about 7 h fast: the exact plain-language sentence, approvals paused, ages uncertain", () => {
  const b = clockBanner(FIXTURE_CLOCKS["untrusted-fast"]);
  assert.equal(b?.severity, "critical");
  assert.equal(b?.text, "ServrSit's own clock is wrong (about 7 h fast), so ages and expiry times may be off. Approvals are paused until it is fixed.");
  assert.equal(b?.approvalsPaused, true);
  assert.equal(b?.agesUncertain, true);
  assert.match(b?.reason ?? "", /about 7 hours ahead/);
});

test("untrusted with no usable offset does not invent a number", () => {
  const b = clockBanner(FIXTURE_CLOCKS["untrusted-unverified"]);
  assert.equal(b?.text, "ServrSit can't confirm its own clock is right, so ages and expiry times may be off. Approvals are paused until it is fixed.");
  assert.doesNotMatch(b?.text ?? "", /\d/);
});

test("slow clocks say slow; small offsets are not described as wrong", () => {
  assert.match(clockBanner({ ...FIXTURE_CLOCKS["untrusted-fast"], offsetSeconds: -600 })?.text ?? "", /about 10 min slow/);
  assert.match(clockBanner({ ...FIXTURE_CLOCKS["untrusted-fast"], offsetSeconds: 60 })?.text ?? "", /can't confirm/);
});

test("not-checked is a quiet attention state: no pause, ages unmarked", () => {
  const b = clockBanner(FIXTURE_CLOCKS["not-checked"]);
  assert.equal(b?.severity, "attention");
  assert.equal(b?.approvalsPaused, false);
  assert.equal(b?.agesUncertain, false);
});

test("no cheeky wording in any banner", () => {
  for (const c of Object.values(FIXTURE_CLOCKS)) assert.doesNotMatch(clockBanner(c)?.text ?? "", /babysit|sitter|oops|whoops|tick/i);
});

test("spans", () => {
  assert.equal(describeSpan(25_200), "7 h");
  assert.equal(describeSpan(-600), "10 min");
  assert.equal(describeSpan(172_800), "2 days");
});

test("parseClock validates against the contract schema", () => {
  assert.equal(parseClock({}), null);
  assert.equal(parseClock({ controlPlane: { clock: { status: "bogus" } } }), null);
  assert.equal(parseClock({ controlPlane: { clock: { ...FIXTURE_CLOCKS["untrusted-fast"], reason: "x".repeat(500) } } }), null);
  const c = parseClock({ controlPlane: { clock: FIXTURE_CLOCKS["untrusted-fast"], findings: [] } });
  assert.equal(c?.status, "untrusted");
  assert.equal(c?.offsetSeconds, 25_200);
});
