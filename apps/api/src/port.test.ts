import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PORT, resolvePort } from "./port.js";

test("defaults to 3001 when PORT is unset or empty", () => {
  assert.equal(DEFAULT_PORT, 3001);
  assert.equal(resolvePort({}), 3001);
  assert.equal(resolvePort({ PORT: "" }), 3001);
});

test("accepts a valid port", () => {
  assert.equal(resolvePort({ PORT: "3101" }), 3101);
  assert.equal(resolvePort({ PORT: "1" }), 1);
  assert.equal(resolvePort({ PORT: "65535" }), 65535);
});

test("rejects invalid values instead of falling back silently", () => {
  for (const bad of ["0", "65536", "-1", "3001.5", "abc", "3001abc", " 3001", "0x10", "1e3", "999999"]) {
    assert.throws(() => resolvePort({ PORT: bad }), /PORT must be an integer from 1 to 65535/, bad);
  }
});

test("the error message does not echo the rejected value", () => {
  try {
    resolvePort({ PORT: "secret-looking-value" });
    assert.fail("should have thrown");
  } catch (e) {
    assert.equal(String(e).includes("secret-looking-value"), false);
  }
});
