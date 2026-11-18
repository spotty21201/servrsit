/**
 * [SIMULATED TARGET] Care loop through the API. Real hosts come from the real
 * config and must stay blocked; only an injected simulated server can be
 * approved and dispatched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSigner, PRODUCTION_ACK } from "@servrsit/domain";
import { MemoryIntentStore, SqliteCareStore } from "@servrsit/store";
import { Dispatcher, SimulatedTarget, type WriteTarget } from "@servrsit/worker";
import { buildServer } from "../server.js";
import { FleetConfigSchema, loadFleetConfig } from "../fleet/config.js";
import { enrolOwner, setupTokenSink } from "../auth/testing.js";
import { FleetService } from "../fleet/service.js";
import { makeObservation } from "../fleet/observation.fixtures.js";
import type { ControllerClock } from "@servrsit/contracts";

const SIM = "00000000-0000-4000-8000-0000005e0a01";
const NABIRE = "22222222-2222-4222-a222-222222222222";
const ORIGIN = "http://100.104.220.8:5173";

class Clock {
  t = new Date("2026-11-17T10:00:00.000Z").getTime();
  now = () => new Date(this.t);
  advance(ms: number) { this.t += ms; }
}

async function start(opts: { production?: boolean; clock?: { value: ControllerClock } } = {}) {
  const clock = new Clock();
  const config = await loadFleetConfig();
  const signer = createSigner("key-1");
  const sim = new SimulatedTarget({
    serverId: SIM, installationId: "inst", hostKeyFingerprint: "SHA256:sim",
    trustedKeys: { [signer.keyId]: signer.publicKeyPem },
    installed: { "openssl:amd64": "3.0.13-0ubuntu3.4" },
    upgrades: [{ name: "openssl", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5" }],
    now: clock.now, runMs: 1000,
  });
  const store = new SqliteCareStore({ path: join(mkdtempSync(join(tmpdir(), "servrsit-care-")), "care.db") });
  const sink = setupTokenSink();
  const fleet = new FleetService({
    config, knownHostsFile: "/x/known_hosts", pinChecker: async () => "pinned", collector: async () => ({ ok: true, observation: makeObservation() }),
    ...(opts.clock === undefined ? {} : { controllerClock: () => opts.clock!.value }),
  });
  const app = await buildServer({
    config, fleetService: fleet, startChecks: false, logger: false,
    auth: { onSetupToken: sink.onSetupToken },
    care: {
      store, now: clock.now,
      simulated: [{ server: { id: SIM, name: "Sim One", production: opts.production ?? false, kind: "simulated", writesEnabled: true }, target: sim }],
    },
  });
  const dispatcher = new Dispatcher({
    store, intents: new MemoryIntentStore(), targets: new Map<string, WriteTarget>([[SIM, sim]]),
    writesEnabled: (id) => id === SIM, signer, installationId: "inst", workerId: "w1", now: clock.now,
  });
  // T-053: every request here is made by a signed-in owner, through the real setup flow.
  const owner = await enrolOwner(app, sink.token());
  const csrf = { token: owner.csrfToken };
  const goodHeaders = { "x-csrf-token": csrf.token, origin: ORIGIN };
  const post = (url: string, body: unknown, headers: Record<string, string> = goodHeaders) =>
    app.inject({ method: "POST", url, headers: { "content-type": "application/json", cookie: owner.cookie, ...headers }, payload: JSON.stringify(body) });
  const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie: owner.cookie } });
  const plan = async (serverId = SIM) => (await post("/api/plans", { operation: "apply.packages.v1", serverId })).json() as {
    id: string; version: number; digest: string; blockers: Array<{ code: string }>; approvable: boolean;
    requiredAcknowledgements: string[]; target: { kind: string; simulated: boolean };
  };
  const approve = (p: { id: string; version: number; digest: string }, over: Record<string, unknown> = {}, headers: Record<string, string> = goodHeaders) =>
    post(`/api/plans/${p.id}/approvals`, { planVersion: p.version, planDigest: p.digest, idempotencyKey: "idem-key-0000000001", acknowledgements: [], ...over }, headers);
  return { app, clock, store, sim, csrf, dispatcher, post, get, plan, approve, goodHeaders, owner };
}

// ---- the hard gate for real servers ------------------------------------------

test("real server: the plan is blocked WRITES_DISABLED, the server is not contacted, and approval is refused", async () => {
  const h = await start();
  try {
    const p = await h.plan(NABIRE);
    assert.deepEqual(p.blockers.map((b) => b.code), ["WRITES_DISABLED"]);
    assert.equal(p.approvable, false);
    assert.equal(p.target.kind, "ssh");
    assert.equal((p as unknown as { preconditions: { previewDigest: string } }).preconditions.previewDigest, "none", "no preview was requested from the real server");
    const r = await h.approve(p);
    assert.equal(r.statusCode, 409);
    assert.deepEqual(r.json(), { error: "PLAN_BLOCKED", blockers: ["WRITES_DISABLED"] });
    assert.equal(h.store.unresolvedFor(NABIRE), null);
  } finally { await h.app.close(); }
});

test("every real host in the shipped config has writes disabled", async () => {
  const h = await start();
  try {
    for (const host of (await loadFleetConfig()).hosts) {
      assert.equal(host.writesEnabled, false, host.name);
      assert.deepEqual((await h.plan(host.id)).blockers.map((b) => b.code), ["WRITES_DISABLED"], host.name);
    }
  } finally { await h.app.close(); }
});

test("configuration cannot enable writes for a real server", () => {
  const host = { id: "11111111-1111-4111-a111-111111111111", name: "One", access: "local", role: null, production: true, collect: true, writesEnabled: true };
  assert.throws(() => FleetConfigSchema.parse({ healthIntervalMinutes: 15, hosts: [host] }), /writesEnabled must be false for real servers/);
});

test("no API can set writesEnabled: no such routes, and request bodies cannot carry it", async () => {
  const h = await start();
  try {
    for (const [method, url] of [["PATCH", `/api/servers/${NABIRE}`], ["PUT", `/api/servers/${NABIRE}`], ["POST", `/api/servers/${NABIRE}/writes`], ["PATCH", "/api/config"]] as const) {
      const r = await h.app.inject({ method, url, headers: { "content-type": "application/json", cookie: h.owner.cookie, ...h.goodHeaders }, payload: JSON.stringify({ writesEnabled: true }) });
      assert.equal(r.statusCode, 404, `${method} ${url}`);
    }
    assert.equal((await h.post("/api/plans", { operation: "apply.packages.v1", serverId: NABIRE, writesEnabled: true })).statusCode, 400);
    const p = await h.plan(NABIRE);
    assert.equal((await h.approve(p, { writesEnabled: true })).statusCode, 400);
    assert.deepEqual((await h.plan(NABIRE)).blockers.map((b) => b.code), ["WRITES_DISABLED"], "still disabled");
  } finally { await h.app.close(); }
});

test("simulated servers can only be injected with a fake id and can never shadow a real server", async () => {
  const config = await loadFleetConfig();
  const signer = createSigner("k");
  const mk = (id: string, name: string) => ({
    server: { id, name, production: false, kind: "simulated" as const, writesEnabled: true },
    target: new SimulatedTarget({ serverId: id, installationId: "i", hostKeyFingerprint: "f", trustedKeys: { k: signer.publicKeyPem }, installed: {}, upgrades: [], now: () => new Date() }),
  });
  await assert.rejects(() => buildServer({ config, startChecks: false, logger: false, care: { simulated: [mk(NABIRE, "Shadow")] } }), /fake id/);
  await assert.rejects(() => buildServer({ config, startChecks: false, logger: false, care: { simulated: [mk("00000000-0000-4000-8000-0000005e0a09", "Nabire")] } }), /shadow/);
  await assert.rejects(() => buildServer({ config, startChecks: false, logger: false, care: { simulated: [mk("12345678-1234-4123-8123-123456789abc", "Odd")] } }), /fake id/);
});

// ---- the full loop on a simulated server -------------------------------------

test("simulated: plan -> approve -> dispatch -> verified success, every step labelled simulated", async () => {
  const h = await start();
  try {
    const p = await h.plan();
    assert.equal(p.approvable, true);
    assert.equal(p.target.simulated, true);
    const r = await h.approve(p);
    assert.equal(r.statusCode, 201);
    const { operationId, state } = r.json() as { operationId: string; state: string };
    assert.equal(state, "queued");
    for (let i = 0; i < 6; i++) { await h.dispatcher.runOnce(); h.clock.advance(1500); }
    const view = (await h.get(`/api/operations/${operationId}`)).json() as {
      operation: { state: string; simulated: boolean; targetKind: string }; events: Array<{ type: string; seq: number }>;
    };
    assert.equal(view.operation.state, "succeeded");
    assert.equal(view.operation.simulated, true);
    assert.equal(view.operation.targetKind, "simulated");
    assert.deepEqual(view.events.map((e) => e.seq), [1, 2, 3, 4, 5], "append-only, ordered");
    assert.equal(h.sim.snapshot().installed["openssl:amd64"], "3.0.13-0ubuntu3.5");
  } finally { await h.app.close(); }
});

test("idempotency: the same key returns the same operation (200); a different key is refused", async () => {
  const h = await start();
  try {
    const p = await h.plan();
    const first = await h.approve(p);
    const again = await h.approve(p);
    assert.equal(first.statusCode, 201);
    assert.equal(again.statusCode, 200);
    assert.equal((first.json() as { operationId: string }).operationId, (again.json() as { operationId: string }).operationId);
    assert.equal((again.json() as { replayed: boolean }).replayed, true);
    const other = await h.approve(p, { idempotencyKey: "idem-key-0000000002" });
    assert.deepEqual([other.statusCode, other.json()], [409, { error: "ALREADY_APPROVED" }]);
  } finally { await h.app.close(); }
});

test("CSRF: a missing or wrong token, a foreign origin and a cross-site request are refused", async () => {
  const h = await start();
  try {
    const p = await h.plan();
    const cases: Array<[string, Record<string, string>]> = [
      ["no token", { origin: ORIGIN }],
      ["wrong token", { origin: ORIGIN, "x-csrf-token": "0".repeat(64) }],
      ["short token", { origin: ORIGIN, "x-csrf-token": "abc" }],
      ["foreign origin", { origin: "https://evil.example", "x-csrf-token": h.csrf.token }],
      ["cross-site fetch", { "sec-fetch-site": "cross-site", "x-csrf-token": h.csrf.token }],
    ];
    for (const [label, headers] of cases) {
      const r = await h.approve(p, {}, headers);
      assert.deepEqual([r.statusCode, r.json()], [403, { error: "CSRF_INVALID" }], label);
    }
    assert.equal(h.store.unresolvedFor(SIM), null, "nothing was approved");
    const token = (await h.get("/api/csrf")).json() as { token: string; header: string };
    assert.equal(token.token, h.csrf.token);
    assert.equal(token.header, "x-csrf-token");
    assert.equal((await h.approve(p)).statusCode, 201);
  } finally { await h.app.close(); }
});

test("invariant 4 via the API: a stale version, a wrong digest and an expired plan are refused", async () => {
  const h = await start();
  try {
    const v1 = await h.plan();
    assert.deepEqual((await h.approve(v1, { planDigest: `sha256:${"0".repeat(64)}` })).json(), { error: "PLAN_CHANGED" });
    const v2 = (await h.post(`/api/plans/${v1.id}/revisions`, {})).json() as typeof v1;
    assert.equal(v2.version, 2);
    assert.equal(v2.id, v1.id);
    assert.deepEqual((await h.approve(v1)).json(), { error: "PLAN_CHANGED" }, "a revision invalidates the old version");
    h.clock.advance(15 * 60_000);
    assert.deepEqual((await h.approve(v2, { idempotencyKey: "idem-key-0000000003" })).json(), { error: "PLAN_EXPIRED" });
  } finally { await h.app.close(); }
});

test("production servers require the explicit production acknowledgement", async () => {
  const h = await start({ production: true });
  try {
    const p = await h.plan();
    assert.deepEqual(p.requiredAcknowledgements, [PRODUCTION_ACK]);
    const r = await h.approve(p);
    assert.deepEqual([r.statusCode, r.json()], [422, { error: "ACK_REQUIRED" }]);
    assert.equal((await h.approve(p, { acknowledgements: [PRODUCTION_ACK] })).statusCode, 201);
  } finally { await h.app.close(); }
});

test("one unresolved operation per server: a second plan is blocked TARGET_BUSY and cannot be approved", async () => {
  const h = await start();
  try {
    assert.equal((await h.approve(await h.plan())).statusCode, 201);
    const second = await h.plan();
    assert.ok(second.blockers.some((b) => b.code === "TARGET_BUSY"));
    const r = await h.approve(second, { idempotencyKey: "idem-key-0000000004" });
    assert.equal(r.statusCode, 409);
  } finally { await h.app.close(); }
});

test("invariant 5 via the API: restart, reboot and anything else outside the catalog cannot be planned", async () => {
  const h = await start();
  try {
    for (const operation of ["restart.service.v1", "reboot.host.v1", "prepare.directories.v1", "run.shell", "apply.packages.v2"]) {
      assert.equal((await h.post("/api/plans", { operation, serverId: SIM })).statusCode, 400, operation);
    }
  } finally { await h.app.close(); }
});

test("invariant 1: chat assent ('yes', 'do it', 'approve the plan') never approves anything", async () => {
  const h = await start();
  try {
    await h.plan();
    for (const message of ["yes", "do it", "approve the plan", "Yes, go ahead and update Sim One"]) {
      const r = await h.post("/api/assistant/messages", { message, scope: "all" });
      assert.equal(r.statusCode, 200, message);
    }
    assert.equal(h.store.unresolvedFor(SIM), null, "no operation was created from chat");
  } finally { await h.app.close(); }
});

test("unknown plans and operations are 404, with no detail", async () => {
  const h = await start();
  try {
    assert.equal((await h.get("/api/plans/nope")).statusCode, 404);
    assert.equal((await h.get("/api/operations/nope")).statusCode, 404);
    assert.equal((await h.post("/api/plans", { operation: "apply.packages.v1", serverId: "99999999-9999-4999-a999-999999999999" })).statusCode, 404);
    const r = await h.post("/api/plans/nope/approvals", { planVersion: 1, planDigest: `sha256:${"0".repeat(64)}`, idempotencyKey: "idem-key-0000000005", acknowledgements: [] }, h.goodHeaders);
    assert.equal(r.statusCode, 404);
  } finally { await h.app.close(); }
});

test("T-062 via the API: a simulated server's Docker updates are listed as excluded and not planned", async () => {
  const h = await start();
  try {
    h.sim.addUpgrade({ name: "docker-ce", arch: "amd64", from: "5:29.9.3-1~ubuntu.24.04~noble", to: "5:29.10.0-1~ubuntu.24.04~noble", origin: "Docker CE:noble" });
    const p = (await h.plan()) as unknown as { scope: { packages: Array<{ name: string }>; excludedPackages: Array<{ name: string; origin: string; reason: string }> }; approvable: boolean };
    assert.deepEqual(p.scope.packages.map((c) => c.name), ["openssl"], "the simulated Ubuntu update is planned");
    assert.deepEqual(p.scope.excludedPackages, [{ name: "docker-ce", arch: "amd64", from: "5:29.9.3-1~ubuntu.24.04~noble", to: "5:29.10.0-1~ubuntu.24.04~noble", origin: "Docker CE:noble", reason: "outside-ubuntu-archive" }]);
    assert.equal(p.approvable, true);
  } finally { await h.app.close(); }
});

// ---- T-063: ServrSit's own clock ----------------------------------------------------

const CLOCK = (status: "trusted" | "untrusted"): ControllerClock => ({
  status, checkedAt: "2026-11-17T10:00:00.000Z", ntpSynchronized: status === "trusted",
  offsetSeconds: status === "trusted" ? 0 : 25200, uncertaintySeconds: 2, basis: "https-date", sources: [], reason: "test",
});

test("T-063 via the API: an untrusted controller clock blocks planning, and approval is re-checked against it", async () => {
  // Enrol while the clock is trusted (T-066 refuses enrolment on an untrusted clock), then it goes wrong.
  const clock = { value: CLOCK("trusted") };
  const h = await start({ clock });
  clock.value = CLOCK("untrusted");
  try {
    const blocked = await h.plan();
    assert.deepEqual(blocked.blockers.map((b) => b.code), ["CONTROLLER_CLOCK_UNTRUSTED"]);
    assert.equal(blocked.approvable, false);

    clock.value = CLOCK("trusted");
    const p = await h.plan();
    assert.equal(p.approvable, true);
    clock.value = CLOCK("untrusted"); // goes wrong between planning and approval
    const r = await h.approve(p);
    assert.deepEqual([r.statusCode, r.json()], [409, { error: "PLAN_BLOCKED", blockers: ["CONTROLLER_CLOCK_UNTRUSTED"] }]);
    assert.equal(h.store.unresolvedFor(SIM), null, "nothing was approved");

    clock.value = CLOCK("trusted");
    assert.equal((await h.approve(p)).statusCode, 201);
  } finally { await h.app.close(); }
});
