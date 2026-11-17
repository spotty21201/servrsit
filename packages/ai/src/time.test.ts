import { test } from "node:test";
import assert from "node:assert/strict";
import { clockTimes, formatAge, formatLocal, isValidTimeZone, localTime, timesAreQuoted } from "./time.js";

const at = (iso: string) => new Date(iso);

test("formats in the owner's zone: 17:10 UTC is 00:10 the next day in Asia/Jakarta (the DEF-L1 case)", () => {
  assert.equal(formatLocal(at("2026-11-17T17:10:03.658Z"), "Asia/Jakarta"), "18 Nov 2026, 00:10 GMT+7");
  assert.equal(formatLocal(at("2026-11-17T17:10:03.658Z"), "Asia/Jayapura"), "18 Nov 2026, 02:10 GMT+9");
  assert.equal(formatLocal(at("2026-11-17T17:10:03.658Z"), "UTC"), "17 Nov 2026, 17:10 UTC");
});

test("ages: just now within a minute either way, then minutes, hours, days, and future", () => {
  const now = at("2026-11-17T17:22:00.000Z");
  assert.equal(formatAge(at("2026-11-17T17:21:30.000Z"), now), "just now");
  assert.equal(formatAge(at("2026-11-17T17:22:30.000Z"), now), "just now", "sub-minute skew is not 'in the future'");
  assert.equal(formatAge(at("2026-11-17T17:10:00.000Z"), now), "12 min ago");
  assert.equal(formatAge(at("2026-11-17T08:29:39.000Z"), now), "8 h 52 min ago", "Nabire's package lists at the time of the report");
  assert.equal(formatAge(at("2026-11-17T15:22:00.000Z"), now), "2 h ago");
  assert.equal(formatAge(at("2026-11-14T17:22:00.000Z"), now), "3 days ago");
  assert.equal(formatAge(at("2026-11-17T17:40:00.000Z"), now), "in 18 min");
});

test("localTime returns {at, age}, and null for null or unparsable input", () => {
  const ctx = { timeZone: "Asia/Jakarta", now: at("2026-11-17T17:22:00.000Z") };
  assert.deepEqual(localTime("2026-11-17T17:10:03.658Z", ctx), { at: "18 Nov 2026, 00:10 GMT+7", age: "11 min ago" });
  assert.equal(localTime(null, ctx), null);
  assert.equal(localTime("not a date", ctx), null);
});

test("time zone validation", () => {
  for (const tz of ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "UTC", "Europe/Berlin"]) assert.equal(isValidTimeZone(tz), true, tz);
  for (const tz of ["", "Not/AZone", "Asia/Jakarta; rm -rf /", "x".repeat(100)]) assert.equal(isValidTimeZone(tz), false, tz);
});

test("clockTimes normalises 24-hour and 12-hour forms", () => {
  assert.deepEqual(clockTimes("at 00:10, then 5:10 PM and 12:10 AM and 12:30 p.m."), ["00:10", "17:10", "00:10", "12:30"]);
  assert.deepEqual(clockTimes("version 24.04 and 99:99 and 1:2"), [], "not clock times");
});

test("timesAreQuoted accepts only times the model was given, in any 12/24-hour form", () => {
  const given = '{"observed":{"at":"18 Nov 2026, 00:10 GMT+7","age":"12 min ago"},"packageLists":{"at":"17 Nov 2026, 15:29 GMT+7"}}';
  assert.deepEqual(timesAreQuoted("Last checked at 00:10; lists from 15:29.", given), { ok: true });
  assert.deepEqual(timesAreQuoted("Last checked at 12:10 AM; lists from 3:29 PM.", given), { ok: true });
  assert.deepEqual(timesAreQuoted("Checked 12 minutes ago.", given), { ok: true });
  assert.deepEqual(timesAreQuoted("The check succeeded at 17:10.", given), { ok: false, offending: "17:10" }, "the founder's DEF-L1 reply");
  assert.deepEqual(timesAreQuoted("Lists refreshed at 08:29.", given), { ok: false, offending: "08:29" }, "UTC time of the lists");
  assert.deepEqual(timesAreQuoted("At 2026-11-17T17:10:03Z it was fine.", given), { ok: false, offending: "iso-timestamp" });
  assert.deepEqual(timesAreQuoted("It was fine at midnight UTC.", given), { ok: false, offending: "utc" });
});
