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
import { createSigner, PRODUCTION_ACK, PRODUCTION_ACKS } from "@servrsit/domain";
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
    for (const [method, url] of [["PUT", `/api/servers/${NABIRE}`], ["POST", `/api/servers/${NABIRE}/writes`], ["PATCH", "/api/config"]] as const) {
      const r = await h.app.inject({ method, url, headers: { "content-type": "application/json", cookie: h.owner.cookie, ...h.goodHeaders }, payload: JSON.stringify({ writesEnabled: true }) });
      assert.equal(r.statusCode, 404, `${method} ${url}`);
    }
    // T-069: PATCH /api/servers/:id exists for name, role and production only; writesEnabled is refused.
    const patch = await h.app.inject({ method: "PATCH", url: `/api/servers/${NABIRE}`, headers: { "content-type": "application/json", cookie: h.owner.cookie, ...h.goodHeaders }, payload: JSON.stringify({ writesEnabled: true }) });
    assert.equal(patch.statusCode, 400);
    assert.equal(patch.json().error, "INVALID_INPUT");
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

test("T-057: production servers require both acknowledgements (recovery route and interruption risk)", async () => {
  const h = await start({ production: true });
  try {
    const p = await h.plan();
    assert.deepEqual(p.requiredAcknowledgements, [...PRODUCTION_ACKS]);
    const r = await h.approve(p);
    assert.deepEqual([r.statusCode, r.json()], [422, { error: "ACK_REQUIRED" }]);
    // T-057: one of the two is not enough, whichever it is.
    for (const one of PRODUCTION_ACKS) {
      const r1 = await h.approve(p, { acknowledgements: [one] });
      assert.deepEqual([r1.statusCode, r1.json()], [422, { error: "ACK_REQUIRED" }], one);
    }
    assert.deepEqual((await h.approve(p, { acknowledgements: [PRODUCTION_ACK] })).statusCode, 422, "the old single constant alone is refused");
    assert.equal((await h.approve(p, { acknowledgements: [...PRODUCTION_ACKS] })).statusCode, 201);
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

test("invariant 5 via the API: nothing outside the catalog can be planned, and each operation takes only its own parameters", async () => {
  const h = await start();
  try {
    for (const operation of ["run.shell", "apply.packages.v2", "restart.service.v2"]) {
      assert.equal((await h.post("/api/plans", { operation, serverId: SIM })).statusCode, 400, operation);
    }
    for (const body of [
      { operation: "restart.service.v1", serverId: SIM },
      { operation: "prepare.directories.v1", serverId: SIM },
      { operation: "apply.packages.v1", serverId: SIM, unit: "nginx.service" },
      { operation: "reboot.host.v1", serverId: SIM, unit: "nginx.service" },
      { operation: "restart.service.v1", serverId: SIM, unit: "nginx.service", reboot: true },
    ]) {
      assert.equal((await h.post("/api/plans", body)).statusCode, 400, JSON.stringify(body));
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

// ---- T-054: approval re-checks the target ------------------------------------------

test("T-054 (F2): if the target's packages change between plan and approval, approval is refused PLAN_CHANGED and nothing is queued", async () => {
  const h = await start();
  try {
    const stale = await h.plan();
    h.sim.addUpgrade({ name: "curl", arch: "amd64", from: "8.5.0-2ubuntu10.5", to: "8.5.0-2ubuntu10.6", origin: "Ubuntu:24.04/noble-security" });
    const r = await h.approve(stale);
    assert.deepEqual([r.statusCode, r.json()], [409, { error: "PLAN_CHANGED" }]);
    assert.equal(h.store.unresolvedFor(SIM), null, "nothing was approved or queued");
    const fresh = (await h.post(`/api/plans/${stale.id}/revisions`, {})).json() as typeof stale;
    assert.equal((await h.approve(fresh, { idempotencyKey: "idem-key-0000000009" })).statusCode, 201, "a revised plan from the current state can be approved");
  } finally { await h.app.close(); }
});

test("T-054: replaying an approval after its operation ran returns the same operation (the re-check does not apply to a replay)", async () => {
  const h = await start();
  try {
    const p = await h.plan();
    const first = await h.approve(p);
    assert.equal(first.statusCode, 201);
    for (let i = 0; i < 6; i++) { await h.dispatcher.runOnce(); h.clock.advance(1500); }
    const again = await h.approve(p);
    assert.equal(again.statusCode, 200);
    assert.equal((again.json() as { operationId: string }).operationId, (first.json() as { operationId: string }).operationId);
  } finally { await h.app.close(); }
});

// ---- T-055: stop request and reconcile ------------------------------------------------

test("T-055: stop before anything was sent cancels before start; nothing is ever sent", async () => {
  const h = await start();
  try {
    const { operationId } = (await h.approve(await h.plan())).json() as { operationId: string };
    const r = await h.post(`/api/operations/${operationId}/stop-request`, {}, h.goodHeaders);
    assert.equal(r.statusCode, 200);
    const body = r.json() as { operation: { state: string; stopRequested: boolean }; stop: string; events: Array<{ type: string }> };
    assert.deepEqual([body.operation.state, body.operation.stopRequested, body.stop], ["cancelled_before_start", true, "cancelled"]);
    for (let i = 0; i < 3; i++) await h.dispatcher.runOnce();
    assert.equal(h.sim.snapshot().installed["openssl:amd64"], "3.0.13-0ubuntu3.4", "nothing was applied");
    const again = await h.post(`/api/operations/${operationId}/stop-request`, {}, h.goodHeaders);
    assert.deepEqual([again.statusCode, (again.json() as { stop: string }).stop], [200, "already-final"], "repeating is harmless");
  } finally { await h.app.close(); }
});

test("T-055: stop while running only records the request; the work finishes and is verified", async () => {
  const h = await start();
  try {
    const { operationId } = (await h.approve(await h.plan())).json() as { operationId: string };
    await h.dispatcher.runOnce(); // sent and accepted: running
    const r = (await h.post(`/api/operations/${operationId}/stop-request`, {}, h.goodHeaders)).json() as { operation: { state: string; stopRequested: boolean }; events: Array<{ type: string }> };
    assert.deepEqual([r.operation.state, r.operation.stopRequested], ["running", true]);
    assert.equal(r.events.filter((e) => e.type === "stop_requested").length, 1);
    await h.post(`/api/operations/${operationId}/stop-request`, {}, h.goodHeaders);
    for (let i = 0; i < 6; i++) { await h.dispatcher.runOnce(); h.clock.advance(1500); }
    const view = (await h.get(`/api/operations/${operationId}`)).json() as { operation: { state: string }; events: Array<{ type: string }> };
    assert.equal(view.operation.state, "succeeded", "a stop request is not a kill");
    assert.equal(view.events.filter((e) => e.type === "stop_requested").length, 1, "the second request added nothing");
  } finally { await h.app.close(); }
});

test("T-055: reconcile follows the ledger and never sends anything; real servers are never contacted", async () => {
  const h = await start();
  try {
    const { operationId } = (await h.approve(await h.plan())).json() as { operationId: string };
    const queued = (await h.post(`/api/operations/${operationId}/reconcile`, {}, h.goodHeaders)).json() as { operation: { state: string } };
    assert.equal(queued.operation.state, "queued", "a queued operation the target does not hold stays queued: reconcile does not send it");
    assert.equal(h.sim.snapshot().installed["openssl:amd64"], "3.0.13-0ubuntu3.4");
    await h.dispatcher.runOnce();
    h.clock.advance(1500);
    for (let i = 0; i < 4; i++) await h.post(`/api/operations/${operationId}/reconcile`, {}, h.goodHeaders);
    const done = (await h.get(`/api/operations/${operationId}`)).json() as { operation: { state: string } };
    assert.equal(done.operation.state, "succeeded", "reconcile can follow the ledger to verification");
    assert.equal((await h.post("/api/operations/nope/reconcile", {}, h.goodHeaders)).statusCode, 404);
    const noCsrf = await h.post(`/api/operations/${operationId}/reconcile`, {}, { origin: "http://100.104.220.8:5173" });
    assert.equal(noCsrf.statusCode, 403);
  } finally { await h.app.close(); }
});

// ---- T-056: canonical identity ----------------------------------------------------------

async function twoRecords(kind: "alias" | "ambiguous") {
  const clock = new Clock();
  const config = await loadFleetConfig();
  const signer = createSigner("key-1");
  const mkSim = (serverId: string, machineId: string) => new SimulatedTarget({
    serverId, installationId: "inst", hostKeyFingerprint: "SHA256:same-host-key", machineId,
    trustedKeys: { [signer.keyId]: signer.publicKeyPem },
    installed: { "openssl:amd64": "3.0.13-0ubuntu3.4" },
    upgrades: [{ name: "openssl", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5" }],
    now: clock.now, runMs: 1000,
  });
  const A = "00000000-0000-4000-8000-0000005e0a0a";
  const B = "00000000-0000-4000-8000-0000005e0a0b";
  const simA = mkSim(A, "machine-1");
  // An alias is a second record of the SAME machine: it reaches the same simulated target.
  const simB = kind === "alias" ? simA : mkSim(B, "machine-2");
  const store = new SqliteCareStore({ path: join(mkdtempSync(join(tmpdir(), "servrsit-care-")), "care.db") });
  const sink = setupTokenSink();
  const fleet = new FleetService({ config, knownHostsFile: "/x/known_hosts", pinChecker: async () => "pinned", collector: async () => ({ ok: true, observation: makeObservation() }) });
  const app = await buildServer({
    config, fleetService: fleet, startChecks: false, logger: false,
    auth: { onSetupToken: sink.onSetupToken },
    care: {
      store, now: clock.now,
      simulated: [
        { server: { id: A, name: "Sim A", production: false, kind: "simulated", writesEnabled: true }, target: simA },
        { server: { id: B, name: "Sim B alias", production: false, kind: "simulated", writesEnabled: true }, target: simB },
      ],
    },
  });
  const owner = await enrolOwner(app, sink.token());
  const headers = { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken, origin: ORIGIN };
  const plan = async (serverId: string) => (await app.inject({ method: "POST", url: "/api/plans", headers, payload: JSON.stringify({ operation: "apply.packages.v1", serverId }) })).json() as {
    id: string; version: number; digest: string; blockers: Array<{ code: string }>;
  };
  const approve = (p: { id: string; version: number; digest: string }, key: string) =>
    app.inject({ method: "POST", url: `/api/plans/${p.id}/approvals`, headers, payload: JSON.stringify({ planVersion: p.version, planDigest: p.digest, idempotencyKey: key, acknowledgements: [] }) });
  return { app, store, A, B, plan, approve };
}

test("T-056 (F5): a second record of the same machine cannot bypass its lock (CL-03e)", async () => {
  const h = await twoRecords("alias");
  try {
    const pa = await h.plan(h.A);
    const pb = await h.plan(h.B);
    assert.deepEqual([pa.blockers, pb.blockers], [[], []], "both records verify: same host key and machine id");
    assert.equal((await h.approve(pa, "idem-key-alias-0001")).statusCode, 201);
    const r = await h.approve(pb, "idem-key-alias-0002");
    assert.equal(r.statusCode, 409);
    assert.equal((r.json() as { error: string }).error, "TARGET_BUSY", "the alias shares the machine's lock");
    assert.deepEqual((await h.plan(h.B)).blockers.map((b) => b.code), ["TARGET_BUSY"], "a new plan through the alias shows the machine is busy");
    assert.equal(h.store.unresolvedFor(h.B), null);
  } finally { await h.app.close(); }
});

test("T-056 (F5): two records sharing only the host key are ambiguous: write enablement is blocked for both", async () => {
  const h = await twoRecords("ambiguous");
  try {
    for (const id of [h.A, h.B]) {
      const p = await h.plan(id);
      assert.deepEqual(p.blockers.map((b) => b.code), ["IDENTITY_AMBIGUOUS"], id);
    }
  } finally { await h.app.close(); }
});


// ---- T-058 (O2): unreachable target while planning ---------------------------------------

test("T-058 (O2): a target unreachable while planning or at the approval re-check is 503 ROUTE_UNAVAILABLE; nothing is stored", async () => {
  const h = await start();
  try {
    h.sim.faults.failPreviews = 1;
    const r = await h.post("/api/plans", { operation: "apply.packages.v1", serverId: SIM });
    assert.deepEqual([r.statusCode, r.json(), r.headers["retry-after"]], [503, { error: "ROUTE_UNAVAILABLE" }, "30"]);
    const p = await h.plan();
    h.sim.faults.failPreviews = 1;
    const a = await h.approve(p);
    assert.deepEqual([a.statusCode, a.json()], [503, { error: "ROUTE_UNAVAILABLE" }]);
    assert.equal(h.store.unresolvedFor(SIM), null, "nothing was approved");
    assert.equal((await h.approve(p)).statusCode, 201, "once the target answers again, the same plan can be approved");
  } finally { await h.app.close(); }
});


// ---- T-059: restart, reboot and directories on a simulated server -----------------------

async function actionHarness(opts: { faults?: Record<string, unknown> } = {}) {
  const clock = new Clock();
  const config = await loadFleetConfig();
  const signer = createSigner("key-1");
  const sim = new SimulatedTarget({
    serverId: SIM, installationId: "inst", hostKeyFingerprint: "SHA256:sim",
    trustedKeys: { [signer.keyId]: signer.publicKeyPem },
    installed: {}, upgrades: [],
    services: { "nginx.service": { active: true }, "postgresql.service": { active: true } },
    bootId: "boot-0",
    directories: { "/srv/existing": { owner: "spotty", group: "spotty", mode: "0755" } },
    now: clock.now, runMs: 1000,
  });
  Object.assign(sim.faults, opts.faults ?? {});
  const store = new SqliteCareStore({ path: join(mkdtempSync(join(tmpdir(), "servrsit-care-")), "care.db") });
  const sink = setupTokenSink();
  const fleet = new FleetService({ config, knownHostsFile: "/x/known_hosts", pinChecker: async () => "pinned", collector: async () => ({ ok: true, observation: makeObservation() }) });
  const app = await buildServer({
    config, fleetService: fleet, startChecks: false, logger: false,
    auth: { onSetupToken: sink.onSetupToken },
    care: {
      store, now: clock.now,
      simulated: [{ server: { id: SIM, name: "Sim One", production: false, kind: "simulated", writesEnabled: true, selectedServices: ["nginx.service"], user: "spotty" }, target: sim }],
    },
  });
  const dispatcher = new Dispatcher({
    store, intents: new MemoryIntentStore(), targets: new Map<string, WriteTarget>([[SIM, sim]]),
    writesEnabled: (id) => id === SIM, signer, installationId: "inst", workerId: "w1", now: clock.now,
  });
  const owner = await enrolOwner(app, sink.token());
  const headers = { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken, origin: ORIGIN };
  const plan = async (body: Record<string, unknown>) =>
    (await app.inject({ method: "POST", url: "/api/plans", headers, payload: JSON.stringify({ serverId: SIM, ...body }) })).json() as {
      id: string; version: number; digest: string; blockers: Array<{ code: string }>; scope: Record<string, unknown>; approvable: boolean;
    };
  const run = async (p: { id: string; version: number; digest: string }) => {
    const r = await app.inject({ method: "POST", url: `/api/plans/${p.id}/approvals`, headers, payload: JSON.stringify({ planVersion: p.version, planDigest: p.digest, idempotencyKey: `idem-${p.id}`.slice(0, 40).padEnd(16, "x"), acknowledgements: [] }) });
    assert.equal(r.statusCode, 201, r.body);
    const { operationId } = r.json() as { operationId: string };
    for (let i = 0; i < 12; i++) { await dispatcher.runOnce(); clock.advance(2500); }
    return (await app.inject({ method: "GET", url: `/api/operations/${operationId}`, headers: { cookie: owner.cookie } })).json() as { operation: { state: string }; events: Array<{ type: string; payload: Record<string, unknown> }> };
  };
  return { app, sim, plan, run };
}

test("T-059: restart.service.v1 restarts one selected unit, is verified by a new start time, and never reboots", async () => {
  const h = await actionHarness();
  try {
    const p = await h.plan({ operation: "restart.service.v1", unit: "nginx.service" });
    assert.deepEqual([p.blockers, p.scope], [[], { unit: "nginx.service", includesServiceRestart: true, includesReboot: false }]);
    const before = await h.sim.inspectBoot();
    const op = await h.run(p);
    assert.equal(op.operation.state, "succeeded");
    assert.equal((await h.sim.inspectBoot()).bootId, before.bootId, "a restart is not a reboot");
    assert.deepEqual((await h.plan({ operation: "restart.service.v1", unit: "postgresql.service" })).blockers.map((b) => b.code), ["UNIT_NOT_SELECTED"]);
    assert.deepEqual((await h.plan({ operation: "restart.service.v1", unit: "nope.service" })).blockers.map((b) => b.code), ["UNIT_NOT_SELECTED"]);
  } finally { await h.app.close(); }
});

test("T-059: a restart that leaves the unit inactive is failed, not succeeded (exit status is not evidence)", async () => {
  const h = await actionHarness({ faults: { restartLeavesInactive: true } });
  try {
    const op = await h.run(await h.plan({ operation: "restart.service.v1", unit: "nginx.service" }));
    assert.equal(op.operation.state, "failed");
  } finally { await h.app.close(); }
});

test("T-059: reboot.host.v1 is verified by a new boot id; no new boot id is failed", async () => {
  const ok = await actionHarness();
  try {
    const p = await ok.plan({ operation: "reboot.host.v1" });
    assert.deepEqual(p.scope, { includesServiceRestart: false, includesReboot: true });
    assert.equal((await ok.run(p)).operation.state, "succeeded");
    assert.notEqual((await ok.sim.inspectBoot()).bootId, "boot-0");
  } finally { await ok.app.close(); }
  const stuck = await actionHarness({ faults: { rebootKeepsBootId: true } });
  try {
    assert.equal((await stuck.run(await stuck.plan({ operation: "reboot.host.v1" }))).operation.state, "failed");
  } finally { await stuck.app.close(); }
});

test("T-059: prepare.directories.v1 creates only missing allowed paths, leaves existing ones untouched, and verifies owner and mode", async () => {
  const h = await actionHarness({ faults: { directoryCreateFails: ["/srv/b"] } });
  try {
    const d = (path: string) => ({ path, owner: "spotty", group: "spotty", mode: "0750" });
    const p = await h.plan({ operation: "prepare.directories.v1", directories: [d("/srv/a"), d("/srv/b"), d("/srv/existing")] });
    assert.deepEqual([p.blockers, (p.scope as { existing: string[] }).existing], [[], ["/srv/existing"]]);
    const op = await h.run(p);
    assert.equal(op.operation.state, "partially_succeeded", "one created, one failed: partial, with the evidence");
    const evidence = op.events.find((e) => e.type === "verification_recorded")!.payload;
    assert.deepEqual([evidence["verified"], evidence["notVerified"]], [["/srv/a"], ["/srv/b"]]);
    const existing = (await h.sim.inspectDirectories(["/srv/existing"]))[0]!;
    assert.deepEqual([existing.owner, existing.mode], ["spotty", "0755"], "the existing directory was not reowned or rechmodded");
    for (const bad of ["/etc/x", "/home/other/x", "/home/spotty/.ssh"]) {
      assert.deepEqual((await h.plan({ operation: "prepare.directories.v1", directories: [d(bad)] })).blockers.map((b) => b.code), ["DIRECTORY_NOT_ALLOWED"], bad);
    }
    const home = await h.plan({ operation: "prepare.directories.v1", directories: [d("/home/spotty/projects")] });
    assert.deepEqual(home.blockers, [], "the login user's home is allowed");
  } finally { await h.app.close(); }
});

test("T-059: every new kind on a real server is blocked WRITES_DISABLED and never contacts it", async () => {
  const h = await start();
  try {
    for (const body of [
      { operation: "restart.service.v1", unit: "nginx.service" },
      { operation: "reboot.host.v1" },
      { operation: "prepare.directories.v1", directories: [{ path: "/srv/a", owner: "spotty", group: "spotty", mode: "0750" }] },
    ]) {
      const p = (await h.post("/api/plans", { serverId: NABIRE, ...body })).json() as { blockers: Array<{ code: string }>; preconditions: { previewDigest: string } };
      assert.equal(p.blockers.some((b) => b.code === "WRITES_DISABLED"), true, JSON.stringify(body));
      assert.equal(p.preconditions.previewDigest, "none", "no preview from a real server");
    }
  } finally { await h.app.close(); }
});
