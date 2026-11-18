import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureFleet, fixtureServer } from "../../api/fleet.fixtures";
import { initialFleetState } from "../../api/fleetState";
import { toOverviewVM, type ServerCardVM } from "./fleetViewModel";
import { applyOrder, DEFAULT_PREFS, effectiveView, offersList, orderDiffers, orderIds, parsePrefs, serializePrefs, sortCards } from "./listView";

const NOW = new Date("2026-11-17T08:10:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function cards(specs: Array<{ n: number; name: string; status?: "fresh" | "unreachable" | "stale" | "partial" | "not-yet-checked"; observedAt?: string | null; production?: boolean }>): ServerCardVM[] {
  const servers = specs.map((s) => fixtureServer({
    id: id(s.n), name: s.name, status: s.status ?? "fresh", production: s.production ?? false,
    observedAt: s.observedAt === undefined ? "2026-11-17T08:00:00.000Z" : s.observedAt,
    freshUntil: null, source: "fixture",
  }));
  return toOverviewVM({ ...initialFleetState, phase: "ready", data: fixtureFleet({ servers }), receivedAt: NOW.toISOString() }, NOW).servers;
}

test("the list and sort control are offered from 6 servers only", () => {
  assert.equal(offersList(5), false);
  assert.equal(offersList(6), true);
  assert.equal(effectiveView({ view: "list", sort: "name" }, 5), "cards");
  assert.equal(effectiveView({ view: "list", sort: "name" }, 6), "list");
  assert.equal(effectiveView({ view: "cards", sort: "name" }, 20), "cards");
});

test("sort by attention puts failures, then attention, then unknown, then healthy; production first within a tier", () => {
  const c = cards([
    { n: 1, name: "Alpha" },
    { n: 2, name: "Bravo", status: "unreachable" },
    { n: 3, name: "Charlie", status: "partial" },
    { n: 4, name: "Delta", status: "unreachable", production: true },
    { n: 5, name: "Echo", status: "not-yet-checked" },
  ]);
  assert.deepEqual(sortCards(c, "attention").map((x) => x.name), ["Charlie", "Delta", "Bravo", "Echo", "Alpha"]);
});

test("sort by name is natural and case-insensitive; by last check puts never-checked first, then oldest", () => {
  const c = cards([
    { n: 1, name: "web-10" }, { n: 2, name: "Web-2" }, { n: 3, name: "api", observedAt: "2026-11-17T07:00:00.000Z" },
    { n: 4, name: "db", observedAt: null, status: "not-yet-checked" }, { n: 5, name: "cache", observedAt: "2026-11-16T07:00:00.000Z" },
  ]);
  assert.deepEqual(sortCards(c, "name").map((x) => x.name), ["api", "cache", "db", "Web-2", "web-10"]);
  assert.deepEqual(sortCards(c, "last-check").map((x) => x.name), ["db", "cache", "api", "Web-2", "web-10"]);
});

test("later status changes update in place; the order only changes when the owner asks", () => {
  const before = cards([{ n: 1, name: "A" }, { n: 2, name: "B" }, { n: 3, name: "C", status: "unreachable" }]);
  const ids = orderIds(before, "attention"); // C, A, B
  assert.deepEqual(ids, [id(3), id(1), id(2)]);
  // B becomes unreachable and C recovers: the shown order stays, the data updates
  const after = cards([{ n: 1, name: "A" }, { n: 2, name: "B", status: "unreachable" }, { n: 3, name: "C" }]);
  const shown = applyOrder(after, ids, "attention");
  assert.deepEqual(shown.map((x) => x.name), ["C", "A", "B"]);
  assert.equal(shown[2]?.statusKey, "unknown"); // B's new status is visible in place
  assert.equal(orderDiffers(after, ids, "attention"), true); // so the owner can be offered "Update order"
  assert.equal(orderDiffers(before, ids, "attention"), false);
});

test("new servers go last, removed ones drop out", () => {
  const first = cards([{ n: 1, name: "A" }, { n: 2, name: "B" }]);
  const ids = orderIds(first, "name");
  const next = cards([{ n: 2, name: "B" }, { n: 3, name: "0-new" }]);
  assert.deepEqual(applyOrder(next, ids, "name").map((x) => x.name), ["B", "0-new"]);
});

test("the saved preference holds only the view and the sort; junk falls back to defaults", () => {
  assert.equal(serializePrefs({ view: "list", sort: "name" }), '{"view":"list","sort":"name"}');
  assert.deepEqual(parsePrefs('{"view":"list","sort":"last-check","token":"x"}'), { view: "list", sort: "last-check" });
  for (const bad of [null, "", "not json", "x".repeat(600), '{"view":"grid","sort":"random"}']) assert.deepEqual(parsePrefs(bad), DEFAULT_PREFS, String(bad).slice(0, 20));
});
