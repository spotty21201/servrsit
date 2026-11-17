import { test } from "node:test";
import assert from "node:assert/strict";
import { FleetConfigSchema, loadFleetConfig } from "./config.js";

const host = { id: "11111111-1111-4111-a111-111111111111", name: "One", access: "local", role: null, production: true, collect: true };

test("DEF-L1: the shipped config sets the owner's time zone to Asia/Jakarta", async () => {
  assert.equal((await loadFleetConfig()).ownerTimeZone, "Asia/Jakarta");
});

test("ownerTimeZone defaults to Asia/Jakarta when the config omits it", () => {
  assert.equal(FleetConfigSchema.parse({ healthIntervalMinutes: 15, hosts: [host] }).ownerTimeZone, "Asia/Jakarta");
});

test("an invalid time zone is rejected at load, not discovered in an answer", () => {
  for (const tz of ["Not/AZone", "", "Asia/Jakarta; rm -rf /"]) {
    assert.throws(() => FleetConfigSchema.parse({ healthIntervalMinutes: 15, ownerTimeZone: tz, hosts: [host] }), tz);
  }
  assert.equal(FleetConfigSchema.parse({ healthIntervalMinutes: 15, ownerTimeZone: "Asia/Jayapura", hosts: [host] }).ownerTimeZone, "Asia/Jayapura");
});
