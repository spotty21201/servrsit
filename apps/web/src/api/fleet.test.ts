import { test } from "node:test";
import assert from "node:assert/strict";
import { FLEET_ENDPOINT, FLEET_MAX_BYTES, FLEET_TIMEOUT_MS, fetchFleet } from "./fleet";
import { fixtureFleet, respondWith } from "./fleet.fixtures";

const NOW = () => new Date("2026-11-17T09:00:00.000Z");

test("a valid response is returned typed, with the receive time from the injected clock", async () => {
  const result = await fetchFleet({ fetchImpl: respondWith(JSON.stringify(fixtureFleet())), now: NOW });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.receivedAt, "2026-11-17T09:00:00.000Z");
  assert.equal(result.data.servers.length, 2);
  assert.equal(result.data.servers[1]?.status, "unreachable");
});

test("the request is a no-store same-origin GET for JSON to /api/fleet", async () => {
  let seen: { url: string; init: RequestInit | undefined } | null = null;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(fixtureFleet()), { status: 200 });
  }) as unknown as typeof fetch;
  await fetchFleet({ fetchImpl });
  assert.ok(seen);
  const s = seen as { url: string; init: RequestInit };
  assert.equal(s.url, FLEET_ENDPOINT);
  assert.equal(FLEET_ENDPOINT, "/api/fleet");
  assert.equal(s.init.method, "GET");
  assert.equal(s.init.cache, "no-store");
  assert.equal(s.init.credentials, "same-origin");
  assert.deepEqual(s.init.headers, { Accept: "application/json" });
});

test("HTTP errors carry the status and fixed text, never the body", async () => {
  const cases: Array<[number, RegExp]> = [
    [401, /Not signed in/], [403, /Not signed in/], [404, /not found.*proxied/i],
    [500, /reported an error/], [503, /reported an error/], [418, /unexpected status/],
  ];
  for (const [status, message] of cases) {
    const result = await fetchFleet({ fetchImpl: respondWith("SECRET-BODY-TEXT <script>", { status }) });
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.kind, "http");
    assert.equal(result.error.status, status);
    assert.match(result.error.message, message);
    assert.equal(JSON.stringify(result).includes("SECRET-BODY-TEXT"), false);
  }
});

test("a network failure is reported as 'network' without exposing the underlying error", async () => {
  const fetchImpl = (async () => { throw new TypeError("connect ECONNREFUSED 10.1.2.3:3001"); }) as typeof fetch;
  const result = await fetchFleet({ fetchImpl });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "network");
  assert.equal(JSON.stringify(result).includes("10.1.2.3"), false);
});

test("a request that never answers times out, and the abort signal reaches fetch", async () => {
  let aborted = false;
  const fetchImpl = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); });
    })) as unknown as typeof fetch;
  const started = Date.now();
  const result = await fetchFleet({ fetchImpl, timeoutMs: 40 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "timeout");
  assert.equal(aborted, true);
  assert.ok(Date.now() - started < 1000);
});

test("the timeout also covers a body that stalls after the headers arrived", async () => {
  const fetchImpl = ((_url: string, init?: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    });
    return Promise.resolve(new Response(stream, { status: 200 }));
  }) as unknown as typeof fetch;
  const result = await fetchFleet({ fetchImpl, timeoutMs: 40 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "timeout");
});

test("the default timeout is 10 seconds", () => {
  assert.equal(FLEET_TIMEOUT_MS, 10_000);
});

test("a caller abort is reported as 'aborted', not as a service failure", async () => {
  const controller = new AbortController();
  const fetchImpl = ((_url: string, init?: RequestInit) =>
    new Promise((_r, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as unknown as typeof fetch;
  const pending = fetchFleet({ fetchImpl, signal: controller.signal, timeoutMs: 5000 });
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "aborted");
});

test("an already-aborted signal never calls fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const fetchImpl = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  const result = await fetchFleet({ fetchImpl, signal: controller.signal });
  assert.equal(called, false);
  assert.equal(result.ok === false && result.error.kind, "aborted");
});

test("an HTML 200 (for example a missing dev proxy falling back to index.html) is an invalid response", async () => {
  const result = await fetchFleet({ fetchImpl: respondWith("<!doctype html><html></html>", { headers: { "content-type": "text/html" } }) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "invalid-response");
  assert.equal(result.error.detail, "response was not JSON");
});

test("JSON that does not match the contract is rejected, with schema paths and no values", async () => {
  const bad = fixtureFleet() as unknown as Record<string, unknown>;
  (bad["servers"] as Array<Record<string, unknown>>)[0]!["status"] = "TOTALLY-HEALTHY-TRUST-ME";
  const result = await fetchFleet({ fetchImpl: respondWith(JSON.stringify(bad)) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "invalid-response");
  assert.equal(result.error.detail, "servers.0.status");
  assert.equal(JSON.stringify(result).includes("TRUSTME"), false);
  assert.equal(JSON.stringify(result).includes("TOTALLY-HEALTHY"), false);
});

test("a response missing required fields, or an unknown fleet mode, is rejected", async () => {
  for (const body of ["{}", "[]", "null", JSON.stringify({ ...fixtureFleet(), mode: "demo" })]) {
    const result = await fetchFleet({ fetchImpl: respondWith(body) });
    assert.equal(result.ok, false, body);
    if (!result.ok) assert.equal(result.error.kind, "invalid-response");
  }
});

test("oversized responses are refused by declared length and by actual size", async () => {
  const declared = await fetchFleet({ fetchImpl: respondWith("{}", { headers: { "content-length": String(FLEET_MAX_BYTES + 1) } }) });
  assert.equal(declared.ok === false && declared.error.detail, "response too large");
  const actual = await fetchFleet({ fetchImpl: respondWith(" ".repeat(FLEET_MAX_BYTES + 1)) });
  assert.equal(actual.ok === false && actual.error.detail, "response too large");
});

test("unknown extra fields from a newer API do not break parsing", async () => {
  const body = { ...fixtureFleet(), futureField: 1 };
  const result = await fetchFleet({ fetchImpl: respondWith(JSON.stringify(body)) });
  assert.equal(result.ok, true);
});

test("the function never throws, whatever fetch does", async () => {
  const throwers: Array<typeof fetch> = [
    (async () => { throw new Error("boom"); }) as typeof fetch,
    (async () => { throw "string"; }) as unknown as typeof fetch,
    (async () => { throw null; }) as unknown as typeof fetch,
    (async () => ({ ok: true, headers: new Headers(), text: async () => { throw new Error("body"); } })) as unknown as typeof fetch,
  ];
  for (const fetchImpl of throwers) {
    const result = await fetchFleet({ fetchImpl });
    assert.equal(result.ok, false);
  }
});

test("O1: a live card with no data (source 'none') is accepted and not reported as live", async () => {
  const body = fixtureFleet({ mode: "live" });
  body.servers[0] = { ...body.servers[0]!, source: "none", status: "unverified-host", observedAt: null, freshUntil: null };
  const result = await fetchFleet({ fetchImpl: respondWith(JSON.stringify(body)) });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.servers[0]?.source, "none");
});

test("an unknown source value is rejected", async () => {
  const body = fixtureFleet() as unknown as { servers: Array<Record<string, unknown>> };
  body.servers[0]!["source"] = "maybe-live";
  const result = await fetchFleet({ fetchImpl: respondWith(JSON.stringify(body)) });
  assert.equal(result.ok === false && result.error.detail, "servers.0.source");
});
