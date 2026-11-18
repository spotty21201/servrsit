import { test } from "node:test";
import assert from "node:assert/strict";
import { watchUnauthorized } from "./unauthorized";

function fakeTarget(status: number) {
  const calls: string[] = [];
  const target = { fetch: (async (url: string) => { calls.push(url); return new Response("{}", { status }); }) as unknown as typeof fetch };
  return { target, calls };
}

test("a 401 from a data route fires the callback and the response still reaches the caller", async () => {
  const { target } = fakeTarget(401);
  let fired = 0;
  const stop = watchUnauthorized(() => fired++, target);
  const r = await target.fetch("/api/fleet");
  assert.equal(r.status, 401);
  assert.equal(fired, 1);
  stop();
});

test("auth routes, other statuses and non-api URLs do not fire; stop restores fetch", async () => {
  const a = fakeTarget(401);
  const original = a.target.fetch;
  let fired = 0;
  const stop = watchUnauthorized(() => fired++, a.target);
  await a.target.fetch("/api/auth/session");
  await a.target.fetch("/fonts/x.woff2");
  assert.equal(fired, 0);
  const b = fakeTarget(200);
  const stop2 = watchUnauthorized(() => fired++, b.target);
  await b.target.fetch("/api/fleet");
  assert.equal(fired, 0);
  stop(); stop2();
  assert.equal(a.target.fetch, original);
});
