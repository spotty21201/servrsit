import { test } from "node:test";
import assert from "node:assert/strict";
import { askAssistant } from "./assistant";
import { csrfHeaders, getSession, login, logout, resetAuthClientState, verifySecondFactor } from "./auth";

/** [FIXTURE DATA] A synthetic session. Not a real token. */
const SESSION = {
  authenticated: true,
  username: "owner",
  csrfToken: "fixture-csrf-token-not-real-0000000000000000",
  csrfHeader: "x-csrf-token",
  idleExpiresAt: "2026-11-17T11:00:00.000Z",
  absoluteExpiresAt: "2026-11-17T18:00:00.000Z",
};

function recorder(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("the TOTP step stores the session's CSRF token in memory; POSTs then carry it; logout clears it", async () => {
  resetAuthClientState();
  const f = recorder([{ status: 200, body: { next: "totp" } }, { status: 200, body: SESSION }, { status: 200, body: { answer: "x", source: "deterministic", model: null, evidence: [], notice: null } }, { status: 204 }]);
  const step1 = await login("owner", "pw", { fetchImpl: f.fetchImpl });
  assert.deepEqual(step1, { ok: true, data: { next: "totp" } });
  assert.deepEqual(csrfHeaders(), {}, "no token after the password step");
  const step2 = await verifySecondFactor({ code: "123456" }, { fetchImpl: f.fetchImpl });
  assert.equal(step2.ok, true);
  assert.deepEqual(csrfHeaders(), { "x-csrf-token": SESSION.csrfToken });
  await askAssistant("How is it?", "all", undefined, { fetchImpl: f.fetchImpl });
  assert.equal((f.calls[2]!.init.headers as Record<string, string>)["x-csrf-token"], SESSION.csrfToken);
  assert.equal(f.calls[2]!.init.credentials, "same-origin");
  const out = await logout({ fetchImpl: f.fetchImpl });
  assert.equal(out.ok, true);
  assert.equal((f.calls[3]!.init.headers as Record<string, string>)["x-csrf-token"], SESSION.csrfToken);
  assert.deepEqual(csrfHeaders(), {});
});

test("typed errors: lockout carries retry-after; a signed-out session clears the token", async () => {
  resetAuthClientState();
  const f = recorder([{ status: 429, body: { error: "LOCKED_OUT", retryAfterSeconds: 30 } }, { status: 200, body: SESSION }, { status: 200, body: { authenticated: false } }]);
  assert.deepEqual(await login("owner", "pw", { fetchImpl: f.fetchImpl }), { ok: false, error: { kind: "LOCKED_OUT", status: 429, retryAfterSeconds: 30 } });
  await getSession({ fetchImpl: f.fetchImpl });
  assert.ok(csrfHeaders()["x-csrf-token"]);
  await getSession({ fetchImpl: f.fetchImpl });
  assert.deepEqual(csrfHeaders(), {});
});

test("an unexpected body is INVALID_RESPONSE, never trusted", async () => {
  resetAuthClientState();
  const f = recorder([{ status: 200, body: { authenticated: true } }, { status: 401, body: { error: "SOMETHING_ELSE" } }]);
  assert.deepEqual(await getSession({ fetchImpl: f.fetchImpl }), { ok: false, error: { kind: "INVALID_RESPONSE", status: 200 } });
  assert.deepEqual(csrfHeaders(), {});
  assert.deepEqual(await verifySecondFactor({ code: "123456" }, { fetchImpl: f.fetchImpl }), { ok: false, error: { kind: "INVALID_RESPONSE", status: 401 } });
});
