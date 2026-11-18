import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExportContent, createFixtureActivityClient, REDACTION_STATEMENT } from "../fixtures/activityFixture";
import { exportErrorText, countText, DEFAULT_FILTERS, dayLabel, filterRecords, groupByDay, isDefault, planExport, resultLabel, toRow } from "./activityViewModel";

const NOW = new Date("2026-11-17T03:00:00Z"); // 10:00 WIB
const TZ = "Asia/Jakarta";

async function all() {
  const r = await createFixtureActivityClient(() => NOW).list();
  assert.ok(r.ok);
  return r.data.records;
}

test("default list shows operations and findings; routine checks only when asked", async () => {
  const recs = await all();
  const def = filterRecords(recs, DEFAULT_FILTERS, NOW);
  assert.ok(def.every((r) => r.type !== "inspection"));
  assert.equal(def.length, 8);
  const withChecks = filterRecords(recs, { ...DEFAULT_FILTERS, types: ["operation", "finding", "inspection"] }, NOW);
  assert.equal(withChecks.length, 12);
  assert.equal(filterRecords(recs, { ...DEFAULT_FILTERS, types: ["inspection"] }, NOW).length, 4);
});

test("filters: server, result and period combine", async () => {
  const recs = await all();
  const timika = filterRecords(recs, { ...DEFAULT_FILTERS, serverId: "s-timika" }, NOW);
  assert.deepEqual(timika.map((r) => r.id), ["op-fixture-partial-03", "op-fixture-unknown-04", "fnd-f1-open"]);
  assert.deepEqual(filterRecords(recs, { ...DEFAULT_FILTERS, result: "unknown" }, NOW).map((r) => r.id), ["op-fixture-unknown-04"]);
  assert.equal(filterRecords(recs, { ...DEFAULT_FILTERS, period: "24h" }, NOW).length, 3); // queued 6 min, ok 130 min, finding resolved 120 min; partial is 26 h
  assert.equal(filterRecords(recs, { ...DEFAULT_FILTERS, period: "7d" }, NOW).length, 7);
});

test("search matches server name, title and id, case-insensitively, and never the summary", async () => {
  const recs = await all();
  const f = (query: string) => filterRecords(recs, { ...DEFAULT_FILTERS, types: ["operation", "finding", "inspection"], query }, NOW).map((r) => r.id);
  assert.ok(f("nabire").includes("op-fixture-queued-01"));
  assert.ok(f("UPDATE PACKAGES").length >= 6);
  assert.deepEqual(f("fnd-f5"), ["fnd-f5-resolved"]);
  assert.deepEqual(f("96 %"), []); // appears only in a summary
});

test("operation results use the UX section 11 wording; unknown and partial never read as success", () => {
  assert.equal(resultLabel("operation", "succeeded"), "Completed and verified");
  assert.equal(resultLabel("operation", "partial"), "Some work completed");
  assert.equal(resultLabel("operation", "unknown"), "Result not yet confirmed");
  assert.equal(resultLabel("operation", "cancelled"), "Cancelled, no work started");
  assert.equal(resultLabel("inspection", "partial"), "Partly checked");
  assert.equal(resultLabel("finding", "unknown"), "Not rechecked");
});

test("rows carry the time in the owner zone with an age; ≈ when ServrSit's clock is untrusted", async () => {
  const r = (await all())[0]!;
  assert.equal(toRow(r, NOW, TZ).when, "09:54 WIB (6 min ago)");
  assert.equal(toRow(r, NOW, TZ, true).when, "09:54 WIB (≈ 6 min ago)");
  assert.equal(toRow(r, NOW, TZ).href, "/operations/fixture-op-queued");
});

test("days: Today, Yesterday, then a date, in the owner zone", async () => {
  const recs = filterRecords(await all(), { ...DEFAULT_FILTERS, period: "all" }, NOW);
  const labels = groupByDay(recs, NOW, TZ).map((g) => g.label);
  assert.equal(labels[0], "Today");
  assert.ok(labels.includes("Yesterday"));
  assert.equal(dayLabel("2026-11-16T20:00:00Z", NOW, TZ), "Today"); // 17 Nov 03:00 WIB
  assert.equal(dayLabel("2026-11-16T10:00:00Z", NOW, TZ), "Yesterday");
});

test("counts and default detection", () => {
  assert.equal(countText(3, 3), "3 records");
  assert.equal(countText(1, 1), "1 record");
  assert.equal(countText(2, 9), "2 of 9 records match");
  assert.equal(isDefault(DEFAULT_FILTERS), true);
  assert.equal(isDefault({ ...DEFAULT_FILTERS, query: "x" }), false);
});

test("export states range, zone and redaction; the file holds whitelisted fields only", async () => {
  const recs = filterRecords(await all(), DEFAULT_FILTERS, NOW);
  const plan = planExport("json", recs, DEFAULT_FILTERS, NOW, TZ);
  assert.match(plan.statement, /^8 records, 18 Oct 10:00 WIB to 10:00 WIB, times in Asia\/Jakarta \(WIB\)\.$/);
  const built = buildExportContent(plan.request, recs, NOW.toISOString());
  const j = JSON.parse(built.content);
  assert.equal(j.redaction, REDACTION_STATEMENT);
  assert.equal(j.timeZone, "Asia/Jakarta");
  assert.equal(j.records.length, 8);
  assert.deepEqual(Object.keys(j.records[0]).sort(), ["at", "id", "production", "result", "server", "simulated", "summary", "title", "type"]);
  const report = buildExportContent({ ...plan.request, format: "report" }, recs, NOW.toISOString());
  assert.match(report.content, /^ServrSit activity report \[FIXTURE DATA\]/);
  assert.match(report.content, /Secrets are redacted/);
});

test("the fixture client keeps exports as a persistent list, newest first", async () => {
  const c = createFixtureActivityClient(() => NOW);
  const recs = filterRecords(await all(), DEFAULT_FILTERS, NOW);
  const plan = planExport("report", recs, DEFAULT_FILTERS, NOW, TZ);
  const a = await c.createExport(plan.request, recs);
  const b = await c.createExport({ ...plan.request, format: "json" }, recs);
  assert.ok(a.ok && b.ok);
  assert.match(a.data.filename, /^servrsit-activity-\d{8}\d{4}\.txt$/);
  assert.match(b.data.filename, /\.json$/);
  const list = await c.listExports();
  assert.ok(list.ok);
  assert.deepEqual(list.data.map((x) => x.id), [b.data.id, a.data.id]);
  assert.ok(a.data.sizeBytes > 100);
});

test("the fixture download returns the stored file; an unknown export is NOT_FOUND", async () => {
  const c = createFixtureActivityClient(() => NOW);
  const recs = filterRecords(await all(), DEFAULT_FILTERS, NOW);
  const made = await c.createExport(planExport("json", recs, DEFAULT_FILTERS, NOW, TZ).request, recs);
  assert.ok(made.ok);
  assert.match(made.data.downloadUrl, /^\/api\/exports\/[0-9a-f-]{36}\/download$/);
  const d = await c.download(made.data);
  assert.ok(d.ok && d.data.filename === made.data.filename && JSON.parse(d.data.content).records.length === 8);
  const gone = await c.download({ ...made.data, id: "00000000-0000-4000-8000-000000000000" });
  assert.deepEqual(gone, { ok: false, error: "NOT_FOUND" });
});

test("simulated work is flagged on the row", async () => {
  const recs = await all();
  const sim = recs.find((r) => r.simulated);
  assert.ok(sim);
  assert.equal(toRow(sim, NOW, TZ).simulated, true);
  assert.equal(toRow(recs[0]!, NOW, TZ).simulated, false);
});

test("export errors: expired, too large, and a lost answer that may have created a file", () => {
  assert.match(exportErrorText("EXPIRED", "download").title, /expired/);
  assert.match(exportErrorText("TOO_LARGE", "create").text, /Narrow/);
  const lost = exportErrorText("TIMEOUT", "create");
  assert.match(lost.title, /may not have been created/);
  assert.doesNotMatch(lost.text, /No file was created/);
  assert.match(exportErrorText("NETWORK", "download").text, /not received/);
});
