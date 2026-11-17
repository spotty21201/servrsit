import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OWNER_TIME_ZONE, formatClock, formatClockWithAge, formatRelative, resolveTimeZone, zoneLabel,
} from "./time";

const D = (iso: string) => new Date(iso);
const JKT = "Asia/Jakarta";

test("default zone is Asia/Jakarta; invalid or missing zones fall back to it", () => {
  assert.equal(DEFAULT_OWNER_TIME_ZONE, "Asia/Jakarta");
  assert.equal(resolveTimeZone(undefined), JKT);
  assert.equal(resolveTimeZone("Not/AZone"), JKT);
  assert.equal(resolveTimeZone("Europe/Berlin"), "Europe/Berlin");
});

test("times render in the owner zone, not the process zone", () => {
  const now = D("2026-11-17T03:00:00Z"); // 10:00 WIB
  assert.equal(formatClock(D("2026-11-17T02:42:00Z"), now, JKT), "09:42 WIB");
  assert.equal(formatClock(D("2026-11-17T02:42:00Z"), now, JKT, false), "09:42");
  assert.equal(formatClock(D("2026-11-17T02:42:00Z"), now, "Europe/Berlin"), "03:42 CET");
});

test("same-day check uses the owner zone: 17:30Z is already the next day in Jakarta", () => {
  const now = D("2026-11-17T18:00:00Z"); // 18 Nov 01:00 WIB
  assert.equal(formatClock(D("2026-11-17T17:30:00Z"), now, JKT, false), "00:30");
  assert.equal(formatClock(D("2026-11-17T16:30:00Z"), now, JKT, false), "17 Nov 23:30");
});

test("midnight renders as 00:xx, 24-hour", () => {
  const now = D("2026-11-17T17:10:00Z");
  assert.equal(formatClock(D("2026-11-17T17:05:00Z"), now, JKT, false), "00:05");
});

test("Indonesian zone labels", () => {
  const at = D("2026-11-17T00:00:00Z");
  assert.equal(zoneLabel("Asia/Jakarta", at), "WIB");
  assert.equal(zoneLabel("Asia/Makassar", at), "WITA");
  assert.equal(zoneLabel("Asia/Jayapura", at), "WIT");
  assert.equal(zoneLabel("UTC", at), "UTC");
});

test("relative age", () => {
  const now = D("2026-11-17T03:00:00Z");
  assert.equal(formatRelative(D("2026-11-17T02:59:30Z"), now, JKT), "just now");
  assert.equal(formatRelative(D("2026-11-17T02:56:00Z"), now, JKT), "4 min ago");
  assert.equal(formatRelative(D("2026-11-17T00:50:00Z"), now, JKT), "2 h ago");
  assert.equal(formatRelative(D("2026-11-15T03:00:00Z"), now, JKT), "15 Nov 10:00 WIB");
  assert.equal(formatRelative(D("2026-11-17T03:05:00Z"), now, JKT), "10:05 WIB"); // future: no claim
});

test("clock with age", () => {
  const now = D("2026-11-17T03:00:00Z");
  assert.equal(formatClockWithAge(D("2026-11-17T02:56:00Z"), now, JKT), "09:56 WIB (4 min ago)");
  assert.equal(formatClockWithAge(D("2026-11-15T03:00:00Z"), now, JKT), "15 Nov 10:00 WIB");
});
