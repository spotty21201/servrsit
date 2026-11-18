import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteBaselineStore } from "./index.js";

test("versions are immutable, history is append-only, exceptions can be marked and removed", () => {
  const path = join(mkdtempSync(join(tmpdir(), "servrsit-baselines-")), "b.db");
  const s = new SqliteBaselineStore({ path });
  const base = { id: "b1", name: "Web", referenceId: "r", referenceName: "Ref", source: "simulated" as const, sourceObservedAt: "t", createdAt: "2026-11-17T10:00:00.000Z", createdBy: "o", conventions: [{ id: "pkg:nginx" }] };
  assert.equal(s.insert(base).version, 1);
  assert.equal(s.insert({ ...base, conventions: [] }).version, 2);
  assert.equal(s.latest("b1")?.version, 2);
  assert.equal(s.listLatest().length, 1);
  s.mark("b1", "t1", "pkg:nginx", "nginx", null, "o", "2026-11-17T10:01:00.000Z");
  assert.equal(s.exceptions("b1", "t1").length, 1);
  assert.equal(s.unmark("b1", "t1", "pkg:nginx", "nginx", "o", "2026-11-17T10:02:00.000Z"), true);
  assert.equal(s.unmark("b1", "t1", "pkg:nginx", "nginx", "o", "2026-11-17T10:02:00.000Z"), false);
  assert.equal(s.history("b1", "t1").length, 4);
  const raw = new DatabaseSync(path);
  assert.throws(() => raw.prepare("UPDATE baselines SET name = 'x'").run(), /immutable/);
  assert.throws(() => raw.prepare("DELETE FROM baseline_events").run(), /append-only/);
});
