import { test } from "node:test";
import assert from "node:assert/strict";
import { createServersClient, type CsrfSource } from "./servers";
import { getSession, resetAuthClientState } from "./auth";

/** [FIXTURE DATA] A draft as the API returns it after the host-key scan. Synthetic values. */
const DRAFT = {
  id: "00000000-0000-4000-8000-000000000d01",
  state: "host-key-seen",
  address: "100.101.102.103",
  port: 22,
  user: "servrsit",
  name: "Fixture Web",
  role: null,
  production: false,
  duplicateOf: null,
  reachability: { reachable: true, note: "The network path is open. This does not test signing in." },
  hostKey: { algorithm: "ED25519", fingerprint: "SHA256:" + "A".repeat(43), observedAt: "2026-11-17T10:00:00.000Z" },
  hostKeyConfirmedAt: null,
  accessKey: null,
  createdAt: "2026-11-17T10:00:00.000Z",
  expiresAt: "2026-11-18T10:00:00.000Z",
};

interface Seen { url: string; method: string; headers: Record<string, string>; body?: string }

function fake(respond: (s: Seen) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const s: Seen = { url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, ...(init?.body ? { body: String(init.body) } : {}) };
    seen.push(s);
    return respond(s);
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const csrf: CsrfSource = { headers: async () => ({ "x-csrf-token": "session-token" }) };

test("each call goes to the contract's path and method; GET carries no CSRF header", async () => {
  const f = fake((s) => (s.method === "DELETE" ? new Response(null, { status: 204 }) : json(DRAFT)));
  const c = createServersClient({ fetchImpl: f.fetchImpl, csrf });
  const id = DRAFT.id;
  await c.getDraft(id);
  await c.scanHostKey(id);
  await c.confirmHostKey(id, { fingerprint: DRAFT.hostKey.fingerprint });
  await c.issueAccessKey(id);
  await c.deleteDraft(id);
  assert.deepEqual(f.seen.map((s) => `${s.method} ${s.url}`), [
    `GET /api/servers/drafts/${id}`,
    `POST /api/servers/drafts/${id}/host-key`,
    `POST /api/servers/drafts/${id}/host-key/confirm`,
    `POST /api/servers/drafts/${id}/access-key`,
    `DELETE /api/servers/drafts/${id}`,
  ]);
  assert.equal(f.seen[0]!.headers["x-csrf-token"], undefined);
  assert.equal(f.seen[1]!.headers["x-csrf-token"], "session-token");
  assert.equal(f.seen[2]!.body, JSON.stringify({ fingerprint: DRAFT.hostKey.fingerprint }));
  assert.equal(f.seen[1]!.headers["Content-Type"], undefined, "no body, no content type");
});

test("ids are encoded into the path", async () => {
  const f = fake(() => json(DRAFT));
  await createServersClient({ fetchImpl: f.fetchImpl, csrf }).getDraft("../../api/csrf");
  assert.equal(f.seen[0]!.url, "/api/servers/drafts/..%2F..%2Fapi%2Fcsrf");
});

test("a contract error comes back typed; an unknown body is INVALID_RESPONSE and never shown", async () => {
  const c1 = createServersClient({ fetchImpl: fake(() => json({ error: "FINGERPRINT_MISMATCH", reason: "That fingerprint is not the one the server presented." }, 422)).fetchImpl, csrf });
  assert.deepEqual(await c1.confirmHostKey(DRAFT.id, { fingerprint: DRAFT.hostKey.fingerprint }), {
    ok: false, error: { error: "FINGERPRINT_MISMATCH", reason: "That fingerprint is not the one the server presented." },
  });
  const c2 = createServersClient({ fetchImpl: fake(() => json({ error: "WHATEVER", reason: "<script>" }, 500)).fetchImpl, csrf });
  assert.deepEqual(await c2.getDraft(DRAFT.id), { ok: false, error: { error: "INVALID_RESPONSE" } });
  const c3 = createServersClient({ fetchImpl: fake(() => json({ ...DRAFT, privateKey: "x" })).fetchImpl, csrf });
  assert.deepEqual(await c3.getDraft(DRAFT.id), { ok: false, error: { error: "INVALID_RESPONSE" } }, "strict: an unexpected field is refused");
  const c4 = createServersClient({ fetchImpl: fake(() => json({ error: "UNAUTHENTICATED" }, 401)).fetchImpl, csrf });
  assert.deepEqual(await c4.getDraft(DRAFT.id), { ok: false, error: { error: "UNAUTHENTICATED" } });
});

test("a refused CSRF token is refreshed and the call retried once; a second refusal is returned", async () => {
  let token = "t1";
  let refusals = 1;
  const source: CsrfSource = { headers: async () => ({ "x-csrf-token": token }), refresh: async () => { token = "t2"; } };
  const f = fake((s) => {
    if (refusals > 0) { refusals--; return json({ error: "CSRF_INVALID" }, 403); }
    return json(DRAFT, 201);
  });
  const c = createServersClient({ fetchImpl: f.fetchImpl, csrf: source });
  const r = await c.createDraft({ address: DRAFT.address, port: 22, user: "servrsit", name: "Fixture Web", role: null, production: false });
  assert.equal(r.ok, true);
  assert.deepEqual(f.seen.map((s) => s.headers["x-csrf-token"]), ["t1", "t2"]);
  const always = createServersClient({ fetchImpl: fake(() => json({ error: "CSRF_INVALID" }, 403)).fetchImpl, csrf: source });
  assert.deepEqual(await always.scanHostKey(DRAFT.id), { ok: false, error: { error: "CSRF_INVALID" } });
});

test("by default the signed-in session's CSRF token from ./auth is sent", async () => {
  resetAuthClientState();
  const f = fake((s) => (s.url === "/api/auth/session"
    ? json({ authenticated: true, username: "owner", csrfToken: "c".repeat(43), csrfHeader: "x-csrf-token", idleExpiresAt: "2026-11-17T11:00:00.000Z", absoluteExpiresAt: "2026-11-17T18:00:00.000Z" })
    : json(DRAFT)));
  await getSession({ fetchImpl: f.fetchImpl });
  await createServersClient({ fetchImpl: f.fetchImpl }).scanHostKey(DRAFT.id);
  const sent = f.seen.at(-1)!.headers;
  assert.equal(Object.values(sent).includes("c".repeat(43)), true, JSON.stringify(sent));
  resetAuthClientState();
});

test("disconnect validates that remoteKeyRemoved is false; update and network failures are explicit", async () => {
  const off = { serverId: DRAFT.id, schedulesStopped: true, controllerKeyDeleted: true, remoteKeyRemoved: false, remoteSteps: ["Step."], authorizedKeysLine: null };
  const ok = createServersClient({ fetchImpl: fake(() => json(off)).fetchImpl, csrf });
  assert.equal((await ok.disconnect(DRAFT.id)).ok, true);
  const lying = createServersClient({ fetchImpl: fake(() => json({ ...off, remoteKeyRemoved: true })).fetchImpl, csrf });
  assert.deepEqual(await lying.disconnect(DRAFT.id), { ok: false, error: { error: "INVALID_RESPONSE" } }, "a claim of remote removal is refused");
  const upd = createServersClient({ fetchImpl: fake(() => json({ id: DRAFT.id, name: "Renamed", role: null, production: true })).fetchImpl, csrf });
  const u = await upd.updateServer(DRAFT.id, { name: "Renamed" });
  assert.equal(u.ok && u.data.name, "Renamed");
  const down = createServersClient({ fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch, csrf });
  assert.deepEqual(await down.getDraft(DRAFT.id), { ok: false, error: { error: "NETWORK" } });
  const slow = createServersClient({
    fetchImpl: ((_u: string, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch,
    csrf, timeoutMs: 10,
  });
  assert.deepEqual(await slow.getDraft(DRAFT.id), { ok: false, error: { error: "TIMEOUT" } });
});
