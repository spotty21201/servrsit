import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteFindingStore, SqliteSettingsStore } from "./index.js";

const S = "00000000-0000-4000-8000-000000000f01";
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const disk = { key: "disk:/", rule: "disk.usage.v1", severity: "warning" as const, summary: "Disk space on / is at 88 %" };

function fresh() {
  const path = join(mkdtempSync(join(tmpdir(), "servrsit-findings-")), "f.db");
  return { path, store: new SqliteFindingStore({ path }) };
}

test("repeated detections update one open record; a recurrence after resolution is a new record", () => {
  const { store } = fresh();
  const a = store.observe(S, disk, "2026-11-17T10:00:00.000Z", true, id);
  const b = store.observe(S, { ...disk, severity: "critical", summary: "Disk space on / is at 96 %" }, "2026-11-17T10:15:00.000Z", true, id);
  assert.equal(a.id, b.id);
  assert.equal(b.firstObservedAt, "2026-11-17T10:00:00.000Z");
  assert.equal(b.lastObservedAt, "2026-11-17T10:15:00.000Z");
  assert.equal(b.severity, "critical");
  store.resolve(a.id, "2026-11-17T10:30:00.000Z", "The check at 2026-11-17T10:30:00.000Z covered this and no longer showed it.");
  const c = store.observe(S, disk, "2026-11-17T11:00:00.000Z", true, id);
  assert.notEqual(c.id, a.id);
  assert.deepEqual(store.listEvents(a.id).map((e) => e.type), ["opened", "severity-changed", "resolved"]);
});

test("stale evidence marks not-rechecked instead of advancing lastObservedAt; fresh evidence clears it", () => {
  const { store } = fresh();
  const a = store.observe(S, disk, "2026-11-17T10:00:00.000Z", true, id);
  const b = store.observe(S, disk, "2026-11-17T10:00:00.000Z", false, id);
  assert.equal(b.notRecheckedSince, "2026-11-17T10:00:00.000Z");
  const c = store.observe(S, disk, "2026-11-17T11:00:00.000Z", true, id);
  assert.equal(c.notRecheckedSince, null);
  assert.equal(c.id, a.id);
});

test("acknowledge and snooze never resolve; a resolved record refuses both and cannot be changed or deleted", () => {
  const { path, store } = fresh();
  const a = store.observe(S, disk, "2026-11-17T10:00:00.000Z", true, id);
  const ack = store.acknowledge(a.id, "owner:o", "2026-11-17T10:01:00.000Z");
  assert.equal(ack.ok && ack.finding.resolvedAt, null);
  const sn = store.snooze(a.id, "2026-11-17T11:01:00.000Z", "owner:o", "2026-11-17T10:01:00.000Z");
  assert.equal(sn.ok && sn.finding.snoozedUntil, "2026-11-17T11:01:00.000Z");
  store.resolve(a.id, "2026-11-17T10:30:00.000Z", "x");
  assert.deepEqual(store.acknowledge(a.id, "owner:o", "2026-11-17T10:31:00.000Z"), { ok: false, code: "NOT_ALLOWED" });
  assert.deepEqual(store.snooze(a.id, "2026-11-18T00:00:00.000Z", "owner:o", "2026-11-17T10:31:00.000Z"), { ok: false, code: "NOT_ALLOWED" });
  assert.deepEqual(store.acknowledge(id(), "owner:o", "2026-11-17T10:31:00.000Z"), { ok: false, code: "NOT_FOUND" });
  const raw = new DatabaseSync(path);
  assert.throws(() => raw.prepare("UPDATE findings SET resolved_at = NULL, resolved_by = NULL").run(), /cannot change/);
  assert.throws(() => raw.prepare("DELETE FROM findings").run(), /never deleted/);
  assert.throws(() => raw.prepare("UPDATE finding_events SET actor = 'x'").run(), /append-only/);
});

test("settings keep a value per key and an append-only history of every change", () => {
  const path = join(mkdtempSync(join(tmpdir(), "servrsit-settings-")), "s.db");
  const s = new SqliteSettingsStore({ path });
  s.set("scheduler.paused", { since: "t", reason: "r" }, "owner:o", new Date("2026-11-17T10:00:00Z"));
  assert.deepEqual(s.get("scheduler.paused"), { since: "t", reason: "r" });
  s.clear("scheduler.paused", "owner:o", new Date("2026-11-17T11:00:00Z"));
  assert.equal(s.get("scheduler.paused"), null);
  assert.deepEqual(s.history("scheduler.paused").map((h) => h.value), [{ since: "t", reason: "r" }, null]);
  assert.throws(() => new DatabaseSync(path).prepare("DELETE FROM settings_history").run(), /append-only/);
});
