import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteActivityStore } from "./index.js";

const S = "00000000-0000-4000-8000-000000000f01";

function fresh() {
  const path = join(mkdtempSync(join(tmpdir(), "servrsit-activity-")), "a.db");
  return { path, store: new SqliteActivityStore({ path }) };
}

test("one inspection row per (server, time); retention prunes old rows; rows cannot be edited", () => {
  const { path, store } = fresh();
  const row = { id: "i1", serverId: S, at: "2026-10-01T00:00:00.000Z", succeeded: true, passed: 16, total: 16, failureCode: null };
  assert.equal(store.recordInspection(row), true);
  assert.equal(store.recordInspection({ ...row, id: "i2" }), false);
  store.recordInspection({ ...row, id: "i3", at: "2026-11-17T00:00:00.000Z" });
  assert.equal(store.pruneInspections("2026-10-18T00:00:00.000Z"), 1);
  assert.deepEqual(store.listInspections("2026-01-01T00:00:00.000Z", 10).map((i) => i.id), ["i3"]);
  assert.throws(() => new DatabaseSync(path).prepare("UPDATE inspections SET succeeded = 0").run(), /cannot be edited/);
});

test("exports are listed until they expire, then pruned; they cannot be edited", () => {
  const { path, store } = fresh();
  const meta = {
    id: "e1", format: "report" as const, filename: "f.txt", mime: "text/plain", createdAt: "2026-11-17T10:00:00.000Z", expiresAt: "2026-11-24T10:00:00.000Z",
    from: "a", to: "b", timeZone: "UTC", recordCount: 0, sizeBytes: 1, redaction: "r", createdBy: "o",
  };
  store.insertExport(meta, "x");
  assert.equal(store.listExports("2026-11-20T00:00:00.000Z", 10).length, 1);
  assert.equal(store.listExports("2026-11-24T10:00:00.000Z", 10).length, 0);
  assert.equal(store.getExport("e1")?.content, "x");
  assert.throws(() => new DatabaseSync(path).prepare("UPDATE exports SET content = 'y'").run(), /cannot be edited/);
  assert.equal(store.pruneExports("2026-11-25T00:00:00.000Z"), 1);
  assert.equal(store.getExport("e1"), null);
});
