import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRoute, operationPath, planPath } from "./router";

test("plan and operation routes", () => {
  assert.deepEqual(matchRoute("/plans/abc-123"), { name: "plan", id: "abc-123" });
  assert.deepEqual(matchRoute("/operations/884e1a11-57db/"), { name: "operation", id: "884e1a11-57db" });
});

test("anything else is the overview, including unsafe ids", () => {
  for (const p of ["/", "/overview", "/plans", "/plans/", "/plans/a/b", "/plans/a%2Fb", "/plans/%E0%A4%A", "/plans/<x>", "/operations/" + "x".repeat(65)]) {
    assert.deepEqual(matchRoute(p), { name: "overview" }, p);
  }
});

test("fixture clock page route", () => { assert.deepEqual(matchRoute("/fixtures/clock"), { name: "fixtureClock" }); });

test("path builders encode", () => {
  assert.equal(planPath("a b"), "/plans/a%20b");
  assert.equal(operationPath("x"), "/operations/x");
});

test("server detail and connect routes", () => {
  const id = "11111111-1111-4111-a111-111111111111";
  assert.deepEqual(matchRoute(`/servers/${id}`), { name: "server", id, section: null });
  assert.deepEqual(matchRoute(`/servers/${id}/settings`), { name: "server", id, section: "settings" });
  assert.deepEqual(matchRoute(`/servers/${id}/verify/`), { name: "server", id, section: "verify" });
  assert.deepEqual(matchRoute("/servers/new"), { name: "connect" });
  assert.deepEqual(matchRoute("/servers/a/b/c"), { name: "overview" });
  assert.deepEqual(matchRoute("/servers/%3Cx%3E"), { name: "overview" });
});

test("findings and activity routes", () => {
  assert.deepEqual(matchRoute("/fixtures/connect"), { name: "fixtureConnect" });
  assert.deepEqual(matchRoute("/baselines"), { name: "baselines" });
  assert.deepEqual(matchRoute("/settings"), { name: "settings" });
  assert.deepEqual(matchRoute("/findings"), { name: "findings" });
  assert.deepEqual(matchRoute("/activity/"), { name: "activity" });
});
