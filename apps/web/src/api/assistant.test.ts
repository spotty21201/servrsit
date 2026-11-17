import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSISTANT_ENDPOINT, ASSISTANT_MAX_BYTES, ASSISTANT_TIMEOUT_MS, askAssistant } from "./assistant";

/** [FIXTURE DATA] A synthetic assistant reply. */
const OK_BODY = {
  answer: "Fixture One is fresh. [FIXTURE DATA]",
  source: "ai",
  model: "cb/deepseek-v4.1-flash",
  evidence: [{ serverId: "11111111-1111-4111-a111-111111111111", observedAt: "2026-11-17T08:00:00.000Z" }],
  notice: "AI-generated explanation of the latest checks.",
};

function respond(status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    })) as typeof fetch;
}

test("a valid reply is returned typed", async () => {
  const r = await askAssistant("How is it?", "all", undefined, { fetchImpl: respond(200, OK_BODY) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.source, "ai");
  assert.equal(r.data.model, "cb/deepseek-v4.1-flash");
  assert.equal(r.data.evidence.length, 1);
});

test("a deterministic reply with null model and notice is valid", async () => {
  const body = { ...OK_BODY, source: "deterministic", model: null, evidence: [], notice: null };
  const r = await askAssistant("How is it?", "all", undefined, { fetchImpl: respond(200, body) });
  assert.equal(r.ok, true);
});

test("it sends one same-origin POST with exactly {message, scope}", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(OK_BODY), { status: 200 });
  }) as unknown as typeof fetch;
  await askAssistant("How is Nabire?", "11111111-1111-4111-a111-111111111111", undefined, { fetchImpl });
  assert.ok(seen);
  const s = seen as { url: string; init: RequestInit };
  assert.equal(s.url, ASSISTANT_ENDPOINT);
  assert.equal(ASSISTANT_ENDPOINT, "/api/assistant/messages");
  assert.equal(s.init.method, "POST");
  assert.equal(s.init.credentials, "same-origin");
  assert.equal(s.init.cache, "no-store");
  assert.deepEqual(JSON.parse(String(s.init.body)), { message: "How is Nabire?", scope: "11111111-1111-4111-a111-111111111111" });
});

test("obviously invalid input never leaves the browser", async () => {
  let called = 0;
  const fetchImpl = (async () => { called += 1; return new Response("{}"); }) as typeof fetch;
  for (const [message, scope] of [["", "all"], ["   ", "all"], ["x".repeat(2001), "all"], ["hi", ""]] as const) {
    const r = await askAssistant(message, scope, undefined, { fetchImpl });
    assert.equal(r.ok === false && r.error.kind, "invalid-input", JSON.stringify([message.length, scope]));
  }
  assert.equal(called, 0);
  assert.equal((await askAssistant("x".repeat(2000), "all", undefined, { fetchImpl: respond(200, OK_BODY) })).ok, true);
});

test("400 INVALID_INPUT and 429 RATE_LIMITED map to their kinds; Retry-After is read", async () => {
  const bad = await askAssistant("hi", "all", undefined, { fetchImpl: respond(400, { error: "INVALID_INPUT" }) });
  assert.equal(bad.ok === false && bad.error.kind, "invalid-input");
  const limited = await askAssistant("hi", "all", undefined, { fetchImpl: respond(429, { error: "RATE_LIMITED" }, { "retry-after": "17" }) });
  assert.equal(limited.ok, false);
  if (limited.ok) return;
  assert.equal(limited.error.kind, "rate-limited");
  assert.equal(limited.error.retryAfterSeconds, 17);
  assert.match(limited.error.message, /wait/);
});

test("an unparseable Retry-After is ignored, not trusted", async () => {
  const r = await askAssistant("hi", "all", undefined, { fetchImpl: respond(429, { error: "RATE_LIMITED" }, { "retry-after": "soon<script>" }) });
  assert.equal(r.ok === false && r.error.retryAfterSeconds, undefined);
});

test("400/429 with an unexpected body, and other statuses, are 'http' with fixed text", async () => {
  for (const [status, body] of [[400, "<html>"], [429, { error: "SOMETHING" }], [500, "SECRET-BODY"], [503, {}], [404, {}]] as const) {
    const r = await askAssistant("hi", "all", undefined, { fetchImpl: respond(status, body) });
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.equal(r.error.kind, "http", String(status));
    assert.equal(r.error.status, status);
    assert.equal(JSON.stringify(r).includes("SECRET-BODY"), false);
  }
});

test("replies that break the contract are invalid-response", async () => {
  const breaks = [
    "not json",
    { ...OK_BODY, source: "magic" },
    { ...OK_BODY, answer: "" },
    { ...OK_BODY, evidence: [{ serverId: "not-a-uuid", observedAt: "x" }] },
    { answer: "only" },
  ];
  for (const body of breaks) {
    const r = await askAssistant("hi", "all", undefined, { fetchImpl: respond(200, body) });
    assert.equal(r.ok === false && r.error.kind, "invalid-response", JSON.stringify(body).slice(0, 40));
  }
});

test("oversized replies are refused", async () => {
  const r = await askAssistant("hi", "all", undefined, { fetchImpl: respond(200, " ".repeat(ASSISTANT_MAX_BYTES + 1)) });
  assert.equal(r.ok === false && r.error.kind, "invalid-response");
});

test("timeout, network failure and caller abort are distinguished; nothing throws", async () => {
  const hang = ((_u: string, init?: RequestInit) => new Promise((_r, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as unknown as typeof fetch;

  const timeout = await askAssistant("hi", "all", undefined, { fetchImpl: hang, timeoutMs: 30 });
  assert.equal(timeout.ok === false && timeout.error.kind, "timeout");

  const network = await askAssistant("hi", "all", undefined, { fetchImpl: (async () => { throw new TypeError("connect ECONNREFUSED"); }) as typeof fetch });
  assert.equal(network.ok === false && network.error.kind, "network");

  const controller = new AbortController();
  const pending = askAssistant("hi", "all", controller.signal, { fetchImpl: hang, timeoutMs: 5000 });
  controller.abort();
  const aborted = await pending;
  assert.equal(aborted.ok === false && aborted.error.kind, "aborted");

  const pre = new AbortController();
  pre.abort();
  let called = false;
  const r = await askAssistant("hi", "all", pre.signal, { fetchImpl: (async () => { called = true; return new Response("{}"); }) as typeof fetch });
  assert.equal(r.ok === false && r.error.kind, "aborted");
  assert.equal(called, false);
});

test("the default client timeout is above the server's 20 s AI timeout", () => {
  assert.ok(ASSISTANT_TIMEOUT_MS > 20_000);
});
