import { test } from "node:test";
import assert from "node:assert/strict";
import { fleetReducer, initialFleetState, type FleetState } from "./fleetState";
import type { FleetError, FleetResult } from "./fleet";
import { fixtureFleet } from "./fleet.fixtures";

const okResult = (at = "2026-11-17T09:00:00.000Z"): FleetResult => ({ ok: true, data: fixtureFleet(), receivedAt: at });
const errResult = (kind: FleetError["kind"]): FleetResult => ({ ok: false, error: { kind, message: `fixed ${kind}` } });
const run = (state: FleetState, ...actions: Parameters<typeof fleetReducer>[1][]) => actions.reduce(fleetReducer, state);

test("starts in 'loading' with no data", () => {
  assert.deepEqual(initialFleetState, { phase: "loading", data: null, receivedAt: null, error: null, refreshing: false });
});

test("a request marks refreshing without changing data", () => {
  const s = run(initialFleetState, { type: "request" });
  assert.equal(s.refreshing, true);
  assert.equal(s.phase, "loading");
});

test("success stores data and clears any earlier error", () => {
  const s = run(initialFleetState, { type: "request" }, { type: "result", result: okResult() });
  assert.equal(s.phase, "ready");
  assert.equal(s.refreshing, false);
  assert.equal(s.error, null);
  assert.equal(s.data?.servers.length, 2);
  assert.equal(s.receivedAt, "2026-11-17T09:00:00.000Z");
});

test("a failure with no data is the 'error' phase", () => {
  const s = run(initialFleetState, { type: "request" }, { type: "result", result: errResult("network") });
  assert.equal(s.phase, "error");
  assert.equal(s.data, null);
  assert.equal(s.error?.kind, "network");
});

test("a failed refresh KEEPS the last good data next to the error", () => {
  const good = run(initialFleetState, { type: "result", result: okResult("2026-11-17T09:00:00.000Z") });
  const s = run(good, { type: "request" }, { type: "result", result: errResult("timeout") });
  assert.equal(s.phase, "ready");
  assert.equal(s.error?.kind, "timeout");
  assert.equal(s.data?.servers.length, 2, "last good data is kept");
  assert.equal(s.receivedAt, "2026-11-17T09:00:00.000Z", "and is labelled by its own receive time");
});

test("the next success clears the error and replaces the data", () => {
  const failed = run(initialFleetState, { type: "result", result: okResult() }, { type: "result", result: errResult("http") });
  const s = run(failed, { type: "result", result: okResult("2026-11-17T09:05:00.000Z") });
  assert.equal(s.error, null);
  assert.equal(s.receivedAt, "2026-11-17T09:05:00.000Z");
});

test("an aborted request is not recorded as a failure", () => {
  const good = run(initialFleetState, { type: "result", result: okResult() });
  const s = run(good, { type: "request" }, { type: "result", result: errResult("aborted") });
  assert.equal(s.error, null);
  assert.equal(s.refreshing, false);
  assert.equal(s.phase, "ready");
  const fromEmpty = run(initialFleetState, { type: "request" }, { type: "result", result: errResult("aborted") });
  assert.equal(fromEmpty.phase, "loading", "no data and no failure: still loading");
});

test("the reducer does not mutate its input", () => {
  const before = run(initialFleetState, { type: "result", result: okResult() });
  const snapshot = JSON.stringify(before);
  run(before, { type: "request" }, { type: "result", result: errResult("network") });
  assert.equal(JSON.stringify(before), snapshot);
});
