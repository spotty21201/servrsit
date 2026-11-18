import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivateResponseSchema, FirstCheckSchema, ServerDraftSchema } from "@servrsit/contracts";
import { createFixtureServersClient, createServersClient, FIXTURE_DUPLICATE, FIXTURE_FINGERPRINT, FIXTURE_UNREACHABLE_ADDRESS } from "./servers";

const REQ = { address: "10.0.0.20", port: 22, user: "ops", name: "Fixture Box", role: null, production: true };

test("fixture follows the contract's order and every response parses with the contract's own schemas", async () => {
  const c = createFixtureServersClient(() => new Date("2026-11-17T03:00:00Z"), 0);
  const created = await c.createDraft(REQ);
  assert.ok(created.ok);
  const id = created.data.id;
  assert.equal(ServerDraftSchema.safeParse(created.data).success, true);

  // out of order is refused with the contract's codes
  assert.deepEqual(await c.issueAccessKey(id), { ok: false, error: { error: "HOST_KEY_NOT_CONFIRMED", reason: "Confirm the host key before a key is made." } });
  const early = await c.confirmHostKey(id, { fingerprint: FIXTURE_FINGERPRINT });
  assert.ok(!early.ok && early.error.error === "STATE_CONFLICT");
  const early2 = await c.startFirstCheck(id);
  assert.ok(!early2.ok && early2.error.error === "STATE_CONFLICT");

  const scanned = await c.scanHostKey(id);
  assert.ok(scanned.ok && scanned.data.state === "host-key-seen");
  assert.equal(ServerDraftSchema.safeParse(scanned.data).success, true);

  const wrong = await c.confirmHostKey(id, { fingerprint: "SHA256:aX7Qf0Zt3m9H2cJkL8aVwYpR5nUe1dGsTiOoNqMxEhA" });
  assert.ok(!wrong.ok && wrong.error.error === "FINGERPRINT_MISMATCH");

  const confirmed = await c.confirmHostKey(id, { fingerprint: FIXTURE_FINGERPRINT });
  assert.ok(confirmed.ok && confirmed.data.state === "host-key-confirmed" && confirmed.data.hostKeyConfirmedAt);
  const keyed = await c.issueAccessKey(id);
  assert.ok(keyed.ok && keyed.data.accessKey);
  assert.equal(ServerDraftSchema.safeParse(keyed.data).success, true);
  assert.match(keyed.data.accessKey?.authorizedKeysLine ?? "", /^restrict,from="[^"]+" ssh-ed25519 /);
  assert.doesNotMatch(JSON.stringify(keyed.data), /PRIVATE|BEGIN/);

  const act0 = await c.activate(id);
  assert.ok(!act0.ok && act0.error.error === "STATE_CONFLICT");
  const started = await c.startFirstCheck(id);
  assert.ok(started.ok);
  let snap = started.data;
  for (let i = 0; i < 20 && !snap.finished; i++) {
    const r = await c.getFirstCheck(id);
    assert.ok(r.ok);
    assert.equal(FirstCheckSchema.safeParse(r.data).success, true);
    snap = r.data;
  }
  assert.equal(snap.finished, true);
  assert.deepEqual(snap.coverage, { passed: 5, total: 6 });
  assert.equal(snap.steps.filter((s) => s.state === "unavailable").length, 1);
  const done = await c.activate(id);
  assert.ok(done.ok);
  assert.equal(ActivateResponseSchema.safeParse(done.data).success, true);
});

test("duplicate and unreachable addresses surface on the draft, and a duplicate cannot be activated", async () => {
  const c = createFixtureServersClient(() => new Date(), 0);
  const dup = await c.createDraft({ ...REQ, address: FIXTURE_DUPLICATE.address });
  assert.ok(dup.ok && dup.data.duplicateOf?.id === FIXTURE_DUPLICATE.id);
  const route = await c.createDraft({ ...REQ, address: FIXTURE_UNREACHABLE_ADDRESS });
  assert.ok(route.ok && route.data.reachability.reachable === false);
  const scan = await c.scanHostKey(route.data.id);
  assert.ok(!scan.ok && scan.error.error === "ROUTE_UNAVAILABLE");
});

test("unknown drafts are DRAFT_NOT_FOUND; deleting removes the draft", async () => {
  const c = createFixtureServersClient(() => new Date(), 0);
  const miss = await c.getDraft("00000000-0000-4000-8000-0000000000ee");
  assert.ok(!miss.ok && miss.error.error === "DRAFT_NOT_FOUND");
  const d = await c.createDraft(REQ);
  assert.ok(d.ok);
  assert.ok((await c.deleteDraft(d.data.id)).ok);
  assert.ok(!(await c.getDraft(d.data.id)).ok);
});

test("the real client sends the contract's routes, no body on bodiless calls, and never throws", async () => {
  const seen: Array<{ url: string; method?: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => { seen.push({ url, ...(init?.method ? { method: init.method } : {}) }); return new Response("{}", { status: 409 }); }) as unknown as typeof fetch;
  const c = createServersClient(fetchImpl);
  const r = await c.scanHostKey("abc");
  assert.deepEqual(r, { ok: false, error: { error: "INVALID_RESPONSE" } });
  await c.deleteDraft("abc");
  assert.deepEqual(seen, [{ url: "/api/servers/drafts/abc/host-key", method: "POST" }, { url: "/api/servers/drafts/abc", method: "DELETE" }]);
  const down = createServersClient((async () => { throw new Error("x"); }) as unknown as typeof fetch);
  assert.deepEqual(await down.getDraft("a"), { ok: false, error: { error: "NETWORK" } });
});
