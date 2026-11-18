import { test } from "node:test";
import assert from "node:assert/strict";
import { createFixtureBaselinesClient } from "../fixtures/baselinesFixture";
import { baselineErrorText, canMarkIntentional, describeSetup, EXCLUSION_STATEMENT, groupRows, referenceAge, setupScope, splitCandidates, STATUS_LABEL, summaryText, validateBaselineName } from "./baselineLogic";

const NOW = new Date("2026-11-17T03:00:00Z");
const TZ = "Asia/Jakarta";
const mkClient = () => createFixtureBaselinesClient(() => NOW);

async function saved(c = mkClient()) {
  const cand = await c.listCandidates("b-web1");
  assert.ok(cand.ok);
  const ids = cand.data.filter((x) => x.eligible).map((x) => x.id);
  const b = await c.saveBaseline({ name: "Web server baseline", referenceId: "b-web1", conventionIds: ids });
  assert.ok(b.ok);
  return { c, b: b.data, cand: cand.data };
}

test("the five labels are exactly the spec's", () => {
  assert.deepEqual(Object.values(STATUS_LABEL), ["Matches", "Missing", "Different by design", "Conflict", "Not checked"]);
});

test("nothing sensitive or machine-specific is eligible; saving an ineligible item is refused", async () => {
  const { c, cand } = await saved();
  const { eligible, ineligible } = splitCandidates(cand);
  assert.equal(eligible.length, 5);
  for (const label of ["/etc/ssh", "/home/deploy", "/etc/netplan", "/var/lib/postgresql", "docker-ce"]) assert.ok(ineligible.some((x) => x.label === label && (x.ineligibleReason ?? "").length > 10), label);
  assert.deepEqual(await c.saveBaseline({ name: "x", referenceId: "b-web1", conventionIds: ["d-ssh"] }), { ok: false, error: "NOT_ALLOWED" });
});

test("a saved baseline is versioned, names its source and age, and authorizes nothing", async () => {
  const { b } = await saved();
  assert.equal(b.version, 1);
  assert.equal(b.referenceName, "Fixture Web-1");
  assert.equal(b.sourceObservedAt, new Date(NOW.getTime() - 12 * 60_000).toISOString());
  assert.equal(referenceAge({ observedAt: b.sourceObservedAt } as never, NOW, TZ).text, "Observed 09:48 WIB (12 min ago)");
  assert.equal(referenceAge({ observedAt: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() } as never, NOW, TZ).old, true);
});

test("compare: five statuses across targets; copies and deletes nothing (read-only)", async () => {
  const { c, b } = await saved();
  const dev = await c.compare(b.id, "b-dev2");
  assert.ok(dev.ok);
  assert.deepEqual(dev.data.map((r) => r.status), ["missing", "missing", "conflict", "missing", "matches"]);
  const web2 = await c.compare(b.id, "b-web2");
  assert.ok(web2.ok);
  assert.deepEqual(web2.data.map((r) => r.status), ["matches", "missing", "not-checked", "conflict", "matches"]);
  assert.equal(summaryText(dev.data), "5 conventions: 1 match, 3 missing, 1 in conflict.");
  assert.equal(groupRows(dev.data).needsDecision.length, 4);
});

test("Mark intentional: only Missing or Conflict, optional reason, scoped to one machine, history appended, can be undone", async () => {
  const { c, b } = await saved();
  assert.equal(canMarkIntentional("missing"), true);
  assert.equal(canMarkIntentional("conflict"), true);
  assert.equal(canMarkIntentional("matches"), false);
  assert.equal(canMarkIntentional("not-checked"), false);
  assert.deepEqual(await c.markIntentional(b.id, "b-dev2", "p-logrotate", null), { ok: false, error: "NOT_ALLOWED" }); // already matches
  const m = await c.markIntentional(b.id, "b-dev2", "d-tools", "Owned by alice on purpose");
  assert.ok(m.ok);
  const row = m.data.find((r) => r.conventionId === "d-tools");
  assert.equal(row?.status, "different-by-design");
  assert.equal(row?.intentional?.reason, "Owned by alice on purpose");
  const other = await c.compare(b.id, "b-web2"); // a different machine is unaffected
  assert.ok(other.ok);
  assert.equal(other.data.find((r) => r.conventionId === "d-tools")?.status, "not-checked");
  const noReason = await c.markIntentional(b.id, "b-dev2", "d-backups", "  ");
  assert.ok(noReason.ok && noReason.data.find((r) => r.conventionId === "d-backups")?.intentional?.reason === null);
  const h = await c.history(b.id, "b-dev2");
  assert.ok(h.ok);
  assert.equal(h.data.length, 2);
  assert.match(h.data[0]!.text, /changed the exception record only, not the server/);
  const u = await c.unmarkIntentional(b.id, "b-dev2", "d-tools");
  assert.ok(u.ok && u.data.find((r) => r.conventionId === "d-tools")?.status === "conflict");
});

test("setup scope: creates only Missing items; conflicts, not-checked and intentional items are left alone and say why", async () => {
  const { c, b } = await saved();
  await c.markIntentional(b.id, "b-dev2", "d-backups", null);
  const rows = await c.compare(b.id, "b-dev2");
  assert.ok(rows.ok);
  const s = setupScope(rows.data);
  assert.deepEqual(s.directories.map((r) => r.label), ["/srv/app"]);
  assert.deepEqual(s.notIncluded.map((r) => r.label), ["nginx"]);
  assert.deepEqual(s.leftAlone.map((x) => x.label), ["/var/backups/app", "/opt/tools"]);
  assert.match(s.leftAlone[1]!.reason, /conflicts with the baseline, so it is not changed/);
  assert.equal(describeSetup(s), "A setup plan would create 1 directory and leave 2 items alone. 1 missing item is not included.");
});

test("repeating a completed setup changes nothing", () => {
  const rows = [{ conventionId: "a", kind: "directory", label: "/srv/app", expected: "", found: "x", status: "matches", reason: "", actionable: false, intentional: null }] as const;
  const s = setupScope(rows);
  assert.equal(s.nothingToDo, true);
  assert.match(describeSetup(s), /would change nothing/);
});

test("the setup plan id goes to the canonical plan screen; a real host's plan is the blocked one", async () => {
  const { c, b } = await saved();
  const sim = await c.createSetupPlan(b.id, "b-dev2");
  const real = await c.createSetupPlan(b.id, "b-web2");
  assert.ok(sim.ok && sim.data.planId === "fixture-plan-prepare" && sim.data.included === 2 && sim.data.notIncluded.length === 1);
  assert.ok(real.ok && real.data.planId === "fixture-plan-prepare-blocked");
});

test("exclusion statement names what is never copied; names validate", () => {
  for (const w of ["credentials", "SSH host keys", "application data", "databases", "personal files", "existing contents", "network settings"]) assert.match(EXCLUSION_STATEMENT, new RegExp(w, "i"));
  assert.equal(validateBaselineName(""), "Give the baseline a name.");
  assert.equal(validateBaselineName("Web server baseline"), null);
  assert.notEqual(validateBaselineName("<b>"), null);
});

test("a missing package is never planned; only missing directories are", async () => {
  const { c, b } = await saved();
  const rows = await c.compare(b.id, "b-dev2");
  assert.ok(rows.ok);
  const s = setupScope(rows.data);
  assert.ok(s.directories.every((r) => r.kind === "directory"));
  assert.ok(s.notIncluded.every((r) => r.kind === "package"));
  assert.doesNotMatch(describeSetup(s), /install/);
});

test("a never-observed server says so", () => {
  assert.equal(referenceAge({ observedAt: null }, NOW, TZ).text, "Never observed by ServrSit");
  assert.equal(referenceAge({ observedAt: null }, NOW, TZ).old, true);
});

test("error wording: stale candidates, refusals and lost answers", () => {
  assert.match(baselineErrorText("STALE_CANDIDATES"), /read it again/);
  assert.match(baselineErrorText("NOT_ALLOWED", "Reason."), /Nothing was changed/);
  for (const code of ["NETWORK", "TIMEOUT", "INVALID_RESPONSE"] as const) {
    assert.match(baselineErrorText(code), /may or may not/);
    assert.doesNotMatch(baselineErrorText(code), /Nothing was changed/);
  }
});
