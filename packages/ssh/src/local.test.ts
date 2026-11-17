/**
 * Integration test: runs the real read-only collector script on THIS machine
 * through /bin/sh (no SSH). Results depend on the host running the tests, so
 * assertions check structure and honesty, not specific values.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectLocal } from "./collect.js";
import { InspectionObservationSchema } from "./schema.js";

test("local collector returns a valid observation with explicit field states", { skip: process.platform !== "linux" }, async () => {
  const result = await collectLocal();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const o = InspectionObservationSchema.parse(result.observation);
  assert.equal(o.source, "local");
  assert.equal(o.truncated, false);
  assert.equal(o.host.hostname.status, "ok");
  assert.equal(o.host.memory.status, "ok");
  assert.equal(o.host.filesystems.status, "ok");
  for (const f of [o.services.failedUnits, o.packages.pendingCount, o.packages.rebootRequired]) {
    assert.ok(f.status === "ok" || (f.status === "unavailable" && f.reason.length > 0));
  }
});
