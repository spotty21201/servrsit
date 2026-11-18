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

test("path builders encode", () => {
  assert.equal(planPath("a b"), "/plans/a%20b");
  assert.equal(operationPath("x"), "/operations/x");
});
