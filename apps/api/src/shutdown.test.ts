import { test } from "node:test";
import assert from "node:assert/strict";
import { createShutdownHandler, SHUTDOWN_DEADLINE_MS } from "./shutdown.js";

function harness(close: () => Promise<void>) {
  const exits: number[] = [];
  const logs: Array<[string, string]> = [];
  const timers: Array<{ fn: () => void; ms: number; unrefd: boolean }> = [];
  const handler = createShutdownHandler({
    close,
    exit: (code) => { exits.push(code); },
    log: (level, message) => { logs.push([level, message]); },
    setTimer: (fn, ms) => {
      const t = { fn, ms, unrefd: false };
      timers.push(t);
      return { unref: () => { t.unrefd = true; } };
    },
  });
  return { handler, exits, logs, timers };
}

test("a clean close exits 0 once, with an unref'd deadline timer of 10 s", async () => {
  const h = harness(async () => undefined);
  await h.handler("SIGTERM");
  assert.deepEqual(h.exits, [0]);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0]!.ms, SHUTDOWN_DEADLINE_MS);
  assert.equal(SHUTDOWN_DEADLINE_MS, 10_000);
  assert.equal(h.timers[0]!.unrefd, true, "the deadline must never keep the process alive");
  h.timers[0]!.fn();
  assert.deepEqual(h.exits, [0], "a late deadline does nothing after a clean close");
});

test("a close that never finishes is cut off by the deadline with exit 1", async () => {
  const h = harness(() => new Promise<void>(() => undefined));
  void h.handler("SIGINT");
  await Promise.resolve();
  assert.deepEqual(h.exits, []);
  h.timers[0]!.fn();
  assert.deepEqual(h.exits, [1]);
  assert.ok(h.logs.some(([lvl, m]) => lvl === "error" && /deadline/.test(m)));
});

test("a second signal exits immediately with 1", async () => {
  const h = harness(() => new Promise<void>(() => undefined));
  void h.handler("SIGTERM");
  await h.handler("SIGINT");
  assert.deepEqual(h.exits, [1]);
  assert.equal(h.timers.length, 1, "the second signal does not start another close");
});

test("a close that throws exits 1, once", async () => {
  const h = harness(async () => { throw new Error("close failed"); });
  await h.handler("SIGTERM");
  assert.deepEqual(h.exits, [1]);
  h.timers[0]!.fn();
  assert.deepEqual(h.exits, [1]);
});
