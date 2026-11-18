/**
 * T-069 server registration through the API. No real server is contacted:
 * the key scan, TCP probe, DNS and first-check collector are injected, and
 * every address is from the documentation ranges or the CGNAT range.
 * Keys are made by the real ssh-keygen in a temporary directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteServerStore } from "@servrsit/store";
import { classifySudo, type CollectionResult, type PrivilegeProbeResult } from "@servrsit/ssh";
import { buildServer } from "../server.js";
import { FleetConfigSchema, type FleetConfig } from "../fleet/config.js";
import { enrolOwner, setupTokenSink } from "../auth/testing.js";
import { makeObservation } from "../fleet/observation.fixtures.js";
import { ADDRESS_REASONS } from "../servers/address.js";
import { createKeyVault, fingerprintOf, type ScanResult } from "../servers/ssh-tools.js";
import { syntheticEd25519 } from "../servers/keys.fixtures.js";

const ORIGIN = "http://100.104.220.8:5173";
const IMPORTED = "11111111-1111-4111-a111-111111111111";
const LOCAL = "44444444-4444-4444-a444-444444444444";

function config(over: Partial<FleetConfig["registration"]> = {}, hosts?: unknown[]): FleetConfig {
  return FleetConfigSchema.parse({
    healthIntervalMinutes: 15,
    hosts: hosts ?? [
      { id: IMPORTED, name: "Imported One", access: "ssh", address: "203.0.113.20", port: 22, user: "owner", identityFile: "/home/owner/.ssh/owner_key", role: "Web", production: true, collect: true },
      { id: LOCAL, name: "Local", access: "local", role: null, production: false, collect: true },
    ],
    registration: { controllerAddress: "100.104.0.1", enrolledRoutes: ["100.64.0.0/10"], ...over },
  });
}

class Clock {
  t = new Date("2026-11-17T10:00:00.000Z").getTime();
  now = () => new Date(this.t);
  advance(ms: number) { this.t += ms; }
}

interface Harness {
  readonly app: Awaited<ReturnType<typeof buildServer>>;
  readonly clock: Clock;
  readonly keysDir: string;
  readonly store: SqliteServerStore;
  readonly hostKey: string;
  readonly dns: Record<string, string[]>;
  scan: (address: string, port: number) => Promise<ScanResult>;
  collect: () => Promise<CollectionResult>;
  privilege: () => Promise<PrivilegeProbeResult>;
  readonly contacted: string[];
  req(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: any; text: string }>;
}

async function start(opts: { config?: FleetConfig; store?: SqliteServerStore; sweepIntervalMs?: number } = {}): Promise<Harness> {
  const clock = new Clock();
  const keysDir = join(mkdtempSync(join(tmpdir(), "servrsit-reg-")), "server-keys");
  const store = opts.store ?? new SqliteServerStore({ path: ":memory:" });
  const sink = setupTokenSink();
  const hostKey = syntheticEd25519();
  const contacted: string[] = [];
  const dns: Record<string, string[]> = { "web.example": ["203.0.113.30"] };
  const h = {
    clock, keysDir, store, hostKey, dns, contacted,
    scan: async (address: string, _port: number): Promise<ScanResult> => {
      contacted.push(`scan ${address}`);
      return { ok: true, key: { algorithm: "ED25519", keyType: "ssh-ed25519", keyBase64: hostKey, fingerprint: fingerprintOf(hostKey) } };
    },
    collect: async (): Promise<CollectionResult> => ({ ok: true, observation: makeObservation() }),
    privilege: async (): Promise<PrivilegeProbeResult> => ({ ok: true, privilege: { level: "no-sudo-rules", broad: false, summary: "This account has no sudo rules." } }),
  } as unknown as Harness;
  const app = await buildServer({
    config: opts.config ?? config(),
    startChecks: false,
    logger: false,
    auth: { onSetupToken: sink.onSetupToken },
    servers: {
      store,
      vault: createKeyVault(keysDir),
      scanner: (a, p) => h.scan(a, p),
      probe: async (a) => { contacted.push(`probe ${a}`); return true; },
      collector: async (t) => { contacted.push(`collect ${t.host}`); return h.collect(); },
      privilegeProbe: async (t) => { contacted.push(`privilege ${t.host}`); return h.privilege(); },
      resolver: async (name) => { const r = dns[name]; if (r === undefined) throw new Error("ENOTFOUND"); return r; },
      selfAddresses: () => [],
      now: clock.now,
      ...(opts.sweepIntervalMs === undefined ? {} : { sweepIntervalMs: opts.sweepIntervalMs }),
    },
  });
  const owner = await enrolOwner(app as never, sink.token());
  const good = owner.headers(true);
  (h as unknown as { owner: unknown }).owner = owner;
  h.req = async (method, url, body, headers = good) => {
    const r = await app.inject({
      method, url,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    return { status: r.statusCode, json: r.body === "" ? null : r.json(), text: r.body };
  };
  (h as { app: unknown }).app = app;
  return h;
}

const DRAFT = { address: "100.101.102.103", port: 22, user: "servrsit", name: "Web 1.EU", role: "Client site", production: true };

async function toKeyIssued(h: Harness, body: Record<string, unknown> = DRAFT) {
  const d = await h.req("POST", "/api/servers/drafts", body);
  assert.equal(d.status, 201, d.text);
  const id = d.json.id as string;
  const scanned = await h.req("POST", `/api/servers/drafts/${id}/host-key`);
  assert.equal(scanned.status, 200, scanned.text);
  const confirmed = await h.req("POST", `/api/servers/drafts/${id}/host-key/confirm`, { fingerprint: scanned.json.hostKey.fingerprint });
  assert.equal(confirmed.status, 200, confirmed.text);
  const key = await h.req("POST", `/api/servers/drafts/${id}/access-key`);
  assert.equal(key.status, 200, key.text);
  return { id, draft: key.json };
}

async function toChecked(h: Harness, body: Record<string, unknown> = DRAFT) {
  const { id } = await toKeyIssued(h, body);
  const started = await h.req("POST", `/api/servers/drafts/${id}/first-check`);
  assert.equal(started.status, 202, started.text);
  await waitFinished(h, id);
  return id;
}

async function waitFinished(h: Harness, id: string) {
  for (let i = 0; i < 50; i++) {
    const r = await h.req("GET", `/api/servers/drafts/${id}/first-check`);
    if (r.json.finished === true) return r.json;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("first check did not finish");
}

test("full flow: draft, scan, confirm, a key for this server, first check, activate, rename, disconnect", async () => {
  const h = await start();
  try {
    const d = await h.req("POST", "/api/servers/drafts", DRAFT);
    assert.equal(d.status, 201);
    assert.equal(d.json.state, "draft");
    assert.equal(d.json.reachability.reachable, true);
    assert.equal(d.json.duplicateOf, null);
    assert.equal(d.json.expiresAt, "2026-11-18T10:00:00.000Z");
    const id = d.json.id as string;

    const scanned = await h.req("POST", `/api/servers/drafts/${id}/host-key`);
    assert.equal(scanned.json.state, "host-key-seen");
    assert.equal(scanned.json.hostKey.fingerprint, fingerprintOf(h.hostKey));

    const wrong = await h.req("POST", `/api/servers/drafts/${id}/host-key/confirm`, { fingerprint: "SHA256:" + "B".repeat(43) });
    assert.equal(wrong.status, 422);
    assert.equal(wrong.json.error, "FINGERPRINT_MISMATCH");

    const confirmed = await h.req("POST", `/api/servers/drafts/${id}/host-key/confirm`, { fingerprint: fingerprintOf(h.hostKey) });
    assert.equal(confirmed.json.state, "host-key-confirmed");
    assert.equal(readFileSync(join(h.keysDir, id, "known_hosts"), "utf8"), `100.101.102.103 ssh-ed25519 ${h.hostKey}\n`, "only the confirmed key is pinned");

    const key = await h.req("POST", `/api/servers/drafts/${id}/access-key`);
    assert.equal(key.json.state, "key-issued");
    const line = key.json.accessKey.authorizedKeysLine as string;
    assert.match(line, /^restrict,from="100\.104\.0\.1" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/=]+ servrsit-web-1-eu$/);
    assert.equal(line.split(" ")[2], readFileSync(join(h.keysDir, id, "id_ed25519.pub"), "utf8").split(" ")[1], "the returned line is this server's own key");
    assert.equal(key.json.accessKey.controllerAddress, "100.104.0.1");
    assert.doesNotMatch(key.text, /PRIVATE KEY|id_ed25519|server-keys/, "no private key and no key path in the response");
    const again = await h.req("POST", `/api/servers/drafts/${id}/access-key`);
    assert.equal(again.json.accessKey.authorizedKeysLine, line, "asking again returns the same key, not a new one");

    const started = await h.req("POST", `/api/servers/drafts/${id}/first-check`);
    assert.equal(started.status, 202);
    assert.equal(started.json.finished, false);
    const fc = await waitFinished(h, id);
    assert.deepEqual(fc.steps.map((s: { id: string; state: string }) => [s.id, s.state]), [
      ["connect", "done"], ["auth", "done"], ["host", "done"], ["services", "done"], ["clock", "done"], ["packages", "done"], ["privilege", "done"],
    ]);
    assert.deepEqual(fc.privilege, { level: "no-sudo-rules", broad: false, summary: "This account has no sudo rules." });
    assert.equal(fc.steps.at(-1).label, "Checking sudo rules (sudo -n -l)");
    assert.deepEqual(fc.platform, { supported: true, name: "Ubuntu 24.04.5 LTS" });
    assert.equal(fc.coverage.total, 16);
    assert.equal((await h.req("GET", `/api/servers/drafts/${id}`)).json.state, "checked");

    const act = await h.req("POST", `/api/servers/drafts/${id}/activate`);
    assert.equal(act.status, 201);
    assert.deepEqual(act.json, { serverId: id });
    assert.equal((await h.req("GET", `/api/servers/drafts/${id}`)).status, 404, "the draft is gone");

    const fleet = await h.req("GET", "/api/fleet");
    const added = fleet.json.servers.find((s: { id: string }) => s.id === id);
    assert.equal(added.name, "Web 1.EU");
    assert.equal(added.production, true);

    const plan = await h.req("POST", "/api/plans", { operation: "apply.packages.v1", serverId: id });
    assert.deepEqual(plan.json.blockers.map((b: { code: string }) => b.code), ["WRITES_DISABLED"], "a registered server has writes disabled");

    const renamed = await h.req("PATCH", `/api/servers/${id}`, { name: "Web One", role: null, production: false });
    assert.deepEqual(renamed.json, { id, name: "Web One", role: null, production: false, productionStatus: "no" });
    assert.equal((await h.req("PATCH", `/api/servers/${id}`, { writesEnabled: true })).status, 400);
    assert.equal((await h.req("PATCH", `/api/servers/${id}`, {})).status, 400);

    const off = await h.req("POST", `/api/servers/${id}/disconnect`);
    assert.equal(off.status, 200);
    assert.equal(off.json.remoteKeyRemoved, false);
    assert.equal(off.json.schedulesStopped, true);
    assert.equal(off.json.controllerKeyDeleted, true);
    assert.equal(off.json.authorizedKeysLine, line);
    assert.ok(off.json.remoteSteps.some((s: string) => s.includes("servrsit-web-1-eu")));
    assert.equal(existsSync(join(h.keysDir, id)), false, "ServrSit's key for this server is deleted");
    assert.equal((await h.req("GET", "/api/fleet")).json.servers.some((s: { id: string }) => s.id === id), false);
    assert.equal((await h.req("POST", `/api/servers/${id}/disconnect`)).status, 404);
    assert.deepEqual(h.store.listEvents(id).map((e) => e.type), ["registered", "updated", "disconnected", "controller-key-deleted"]);
  } finally { await h.app.close(); }
});

test("steps out of order are refused with the contract's codes", async () => {
  const h = await start();
  try {
    const id = (await h.req("POST", "/api/servers/drafts", DRAFT)).json.id as string;
    assert.equal((await h.req("POST", `/api/servers/drafts/${id}/access-key`)).json.error, "HOST_KEY_NOT_CONFIRMED");
    assert.equal((await h.req("POST", `/api/servers/drafts/${id}/host-key/confirm`, { fingerprint: "SHA256:" + "A".repeat(43) })).json.error, "STATE_CONFLICT");
    assert.equal((await h.req("POST", `/api/servers/drafts/${id}/first-check`)).json.error, "STATE_CONFLICT");
    assert.equal((await h.req("GET", `/api/servers/drafts/${id}/first-check`)).json.error, "STATE_CONFLICT");
    assert.equal((await h.req("POST", `/api/servers/drafts/${id}/activate`)).json.error, "STATE_CONFLICT");
    await h.req("POST", `/api/servers/drafts/${id}/host-key`);
    await h.req("POST", `/api/servers/drafts/${id}/host-key/confirm`, { fingerprint: fingerprintOf(h.hostKey) });
    assert.equal((await h.req("POST", `/api/servers/drafts/${id}/host-key`)).json.error, "STATE_CONFLICT", "no rescan after confirmation");
    assert.equal((await h.req("POST", `/api/servers/drafts/${id}/activate`)).status, 409);
    assert.equal(existsSync(join(h.keysDir, id, "id_ed25519")), false, "no key is made before it is asked for");
    assert.deepEqual(h.contacted.filter((c) => c.startsWith("collect")), [], "nothing was collected");
  } finally { await h.app.close(); }
});

test("every route needs a signed-in owner; state-changing ones also the session's CSRF token and an allowed Origin", async () => {
  const h = await start();
  try {
    const o = (h as unknown as { owner: { cookie: string; headers(w?: boolean): Record<string, string> } }).owner;
    assert.equal((await h.req("POST", "/api/servers/drafts", DRAFT, {})).status, 401, "no session");
    const bad = [{ cookie: o.cookie, "x-csrf-token": "nope", origin: ORIGIN }, { ...o.headers(true), origin: "https://evil.example" }, { cookie: o.cookie }];
    for (const headers of bad) {
      assert.equal((await h.req("POST", "/api/servers/drafts", DRAFT, headers)).status, 403);
    }
    const id = (await h.req("POST", "/api/servers/drafts", DRAFT)).json.id as string;
    for (const [method, url, body] of [
      ["DELETE", `/api/servers/drafts/${id}`, undefined], ["POST", `/api/servers/drafts/${id}/host-key`, undefined],
      ["PATCH", `/api/servers/${IMPORTED}`, { name: "X" }], ["POST", `/api/servers/${IMPORTED}/disconnect`, undefined],
    ] as const) {
      assert.equal((await h.req(method, url, body, { cookie: o.cookie })).status, 403, `${method} ${url}`);
      assert.equal((await h.req(method, url, body, {})).status, 401, `${method} ${url}`);
    }
    assert.equal((await h.req("GET", `/api/servers/drafts/${id}`, undefined, o.headers())).status, 200);
    assert.equal((await h.req("GET", `/api/servers/drafts/${id}`, undefined, {})).status, 401);
    assert.equal(h.contacted.filter((c) => c.startsWith("scan")).length, 0);
  } finally { await h.app.close(); }
});

test("rejected addresses give ADDRESS_REJECTED with a fixed reason and no echo of the input", async () => {
  const h = await start();
  try {
    for (const [address, reason] of [
      ["169.254.169.254", ADDRESS_REASONS.metadata], ["127.0.0.1", ADDRESS_REASONS.loopback], ["192.168.1.5", ADDRESS_REASONS.privateOutsideRoute],
      ["100.104.0.1", ADDRESS_REASONS.controller], ["missing.example", ADDRESS_REASONS.unresolved],
    ] as const) {
      const r = await h.req("POST", "/api/servers/drafts", { ...DRAFT, address });
      assert.equal(r.status, 422, address);
      assert.deepEqual(r.json, { error: "ADDRESS_REJECTED", reason });
    }
    for (const address of ["ssh://x", "u@x", "x;id", "x y"]) {
      const r = await h.req("POST", "/api/servers/drafts", { ...DRAFT, address });
      assert.ok(r.status === 400 || r.status === 422, address);
      assert.ok(!r.text.includes(address), "the input is not echoed");
    }
    assert.equal((await h.req("POST", "/api/servers/drafts", { ...DRAFT, port: 2222 })).json.reason, ADDRESS_REASONS.port);
    assert.equal((await h.req("POST", "/api/servers/drafts", { ...DRAFT, user: "root;id" })).status, 400);
    assert.equal((await h.req("POST", "/api/servers/drafts", { ...DRAFT, privateKey: "-----BEGIN" })).status, 400, "no field can carry a key");
    assert.deepEqual(h.contacted, [], "nothing was contacted for a rejected address");
  } finally { await h.app.close(); }
});

test("DNS is checked again before the scan and before the first check (rebinding)", async () => {
  const h = await start();
  try {
    const d = await h.req("POST", "/api/servers/drafts", { ...DRAFT, address: "web.example" });
    assert.equal(d.status, 201);
    const id = d.json.id as string;
    h.dns["web.example"] = ["169.254.169.254"];
    assert.deepEqual((await h.req("POST", `/api/servers/drafts/${id}/host-key`)).json, { error: "ADDRESS_REJECTED", reason: ADDRESS_REASONS.resolvedBlocked });
    assert.equal(h.contacted.some((c) => c.startsWith("scan")), false);

    h.dns["web.example"] = ["203.0.113.30"];
    const scanned = await h.req("POST", `/api/servers/drafts/${id}/host-key`);
    assert.equal(h.contacted.at(-1), "scan 203.0.113.30", "the scan goes to the address that was just validated");
    await h.req("POST", `/api/servers/drafts/${id}/host-key/confirm`, { fingerprint: scanned.json.hostKey.fingerprint });
    await h.req("POST", `/api/servers/drafts/${id}/access-key`);
    h.dns["web.example"] = ["127.0.0.1"];
    assert.equal((await h.req("POST", `/api/servers/drafts/${id}/first-check`)).json.error, "ADDRESS_REJECTED");
    assert.equal(h.contacted.some((c) => c.startsWith("collect")), false);
  } finally { await h.app.close(); }
});

test("duplicates: the same address and port, or the same host key, cannot be activated twice", async () => {
  const h = await start();
  try {
    const dup = await h.req("POST", "/api/servers/drafts", { ...DRAFT, name: "Again", address: "203.0.113.20" });
    assert.deepEqual(dup.json.duplicateOf, { id: IMPORTED, name: "Imported One" });

    const first = await toChecked(h);
    assert.equal((await h.req("POST", `/api/servers/drafts/${first}/activate`)).status, 201);
    // A second address that presents the same host key (an alias of the same machine).
    const alias = await toChecked(h, { ...DRAFT, name: "Alias", address: "100.101.102.104" });
    const r = await h.req("POST", `/api/servers/drafts/${alias}/activate`);
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "DUPLICATE_SERVER");
    assert.equal((await h.req("POST", "/api/servers/drafts", { ...DRAFT, address: "100.101.102.105" })).json.reason, "A server with this name already exists.");
  } finally { await h.app.close(); }
});

test("a failed first check says which step failed, runs nothing after it, and can be retried", async () => {
  const h = await start();
  try {
    h.collect = async () => ({ ok: false, failure: { code: "AUTH_FAILED", message: "x" }, attemptedAt: "2026-11-17T10:00:00.000Z", contacted: true });
    const { id } = await toKeyIssued(h);
    await h.req("POST", `/api/servers/drafts/${id}/first-check`);
    const fc = await waitFinished(h, id);
    assert.equal(fc.failureCode, "AUTH_FAILED");
    assert.deepEqual(fc.steps.map((s: { id: string; state: string }) => [s.id, s.state]), [
      ["connect", "done"], ["auth", "failed"], ["host", "unavailable"], ["services", "unavailable"], ["clock", "unavailable"], ["packages", "unavailable"], ["privilege", "unavailable"],
    ]);
    assert.equal(h.contacted.some((c) => c.startsWith("privilege")), false, "no sudo listing after a failed sign-in");
    assert.equal(fc.steps[1].reason, "The host rejected the configured credentials.");
    assert.equal((await h.req("GET", `/api/servers/drafts/${id}`)).json.state, "check-failed");
    assert.equal((await h.req("POST", `/api/servers/drafts/${id}/activate`)).status, 409);

    // Partial: packages unreadable; the check still finishes and the server can be added.
    h.collect = async () => {
      const o = makeObservation();
      return { ok: true, observation: { ...o, packages: { ...o.packages, pendingCount: { status: "unavailable", reason: "x" } } } };
    };
    await h.req("POST", `/api/servers/drafts/${id}/first-check`);
    const retry = await waitFinished(h, id);
    assert.equal(retry.steps.find((s: { id: string }) => s.id === "packages").state, "unavailable");
    assert.equal(retry.coverage.passed, 15);
    assert.equal((await h.req("POST", `/api/servers/drafts/${id}/activate`)).status, 201);
  } finally { await h.app.close(); }
});

test("drafts expire after 24 hours; deleting a draft removes its unused key", async () => {
  const h = await start();
  try {
    const { id } = await toKeyIssued(h);
    assert.equal(existsSync(join(h.keysDir, id, "id_ed25519")), true);
    assert.equal((await h.req("DELETE", `/api/servers/drafts/${id}`)).status, 204);
    assert.equal(existsSync(join(h.keysDir, id)), false);

    const other = await toKeyIssued(h, { ...DRAFT, name: "Later" });
    h.clock.advance(24 * 3600_000);
    assert.equal((await h.req("GET", `/api/servers/drafts/${other.id}`)).status, 410);
    await h.req("POST", "/api/servers/drafts", { ...DRAFT, name: "Sweeper" });
    assert.equal(existsSync(join(h.keysDir, other.id)), false, "an expired draft's key is swept");
    assert.equal((await h.req("GET", `/api/servers/drafts/${other.id}`)).status, 404);
  } finally { await h.app.close(); }
});

test("without ServrSit's own address configured, no access key can be made", async () => {
  const h = await start({ config: config({ controllerAddress: null }) });
  try {
    const d = await h.req("POST", "/api/servers/drafts", DRAFT);
    const id = d.json.id as string;
    const s = await h.req("POST", `/api/servers/drafts/${id}/host-key`);
    await h.req("POST", `/api/servers/drafts/${id}/host-key/confirm`, { fingerprint: s.json.hostKey.fingerprint });
    const r = await h.req("POST", `/api/servers/drafts/${id}/access-key`);
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "STATE_CONFLICT");
  } finally { await h.app.close(); }
});

test("disconnecting an imported server never touches the owner's key file and never claims the remote line is gone", async () => {
  const h = await start();
  try {
    const off = await h.req("POST", `/api/servers/${IMPORTED}/disconnect`);
    assert.equal(off.status, 200);
    assert.equal(off.json.controllerKeyDeleted, false);
    assert.equal(off.json.remoteKeyRemoved, false);
    assert.equal(off.json.authorizedKeysLine, null);
    assert.ok(off.json.remoteSteps[0].includes("did not make a key"));
    assert.equal((await h.req("GET", "/api/fleet")).json.servers.some((s: { id: string }) => s.id === IMPORTED), false);
    const local = await h.req("POST", `/api/servers/${LOCAL}/disconnect`);
    assert.deepEqual(local.json.remoteSteps, ["ServrSit read this machine directly. There is no remote key to remove."]);
    assert.equal((await h.req("PATCH", `/api/servers/${IMPORTED}`, { name: "Back" })).status, 404, "a disconnected server cannot be edited");
  } finally { await h.app.close(); }
});

test("hosts.json is a one-time import: a restart with a changed file keeps the registry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "servrsit-import-"));
  const path = join(dir, "servers.db");
  const a = await start({ store: new SqliteServerStore({ path }) });
  try {
    assert.equal((await a.req("PATCH", `/api/servers/${IMPORTED}`, { name: "Renamed In App" })).status, 200);
  } finally { await a.app.close(); }
  const changed = config({}, [{ id: "55555555-5555-4555-a555-555555555555", name: "New In File", access: "local", role: null, production: false, collect: true }]);
  const b = await start({ config: changed, store: new SqliteServerStore({ path }) });
  try {
    const names = (await b.req("GET", "/api/fleet")).json.servers.map((s: { name: string }) => s.name).sort();
    assert.deepEqual(names, ["Local", "Renamed In App"]);
  } finally { await b.app.close(); }
});

test("T-081 R-2: broad passwordless sudo is reported with a warning; a failed probe is unavailable, never 'no rules'", async () => {
  const h = await start();
  try {
    // Recorded-style output, classified by the product's own parser.
    const recorded = "User fixture may run the following commands on fixture-host:\n    (ALL) NOPASSWD: ALL";
    h.privilege = async () => ({ ok: true, privilege: classifySudo(recorded, 0) });
    const { id } = await toKeyIssued(h);
    await h.req("POST", `/api/servers/drafts/${id}/first-check`);
    const fc = await waitFinished(h, id);
    assert.deepEqual([fc.privilege.level, fc.privilege.broad], ["passwordless-sudo", true]);
    assert.match(fc.steps.at(-1).reason, /^Warning:/);

    h.privilege = async () => ({ ok: false, code: "TIMEOUT", message: "x" });
    await h.req("POST", `/api/servers/drafts/${id}/first-check`);
    const again = await waitFinished(h, id);
    assert.equal(again.privilege, null);
    assert.equal(again.steps.at(-1).state, "unavailable");
    assert.equal(again.finished, true);
    assert.equal((await h.req("GET", `/api/servers/drafts/${id}`)).json.state, "checked", "the privilege check never blocks the server");
  } finally { await h.app.close(); }
});

test("T-081 R-1: 'not sure' is accepted and treated as production; it can be changed later", async () => {
  const h = await start();
  try {
    const d = await h.req("POST", "/api/servers/drafts", { ...DRAFT, production: true, productionStatus: "not_sure" });
    assert.deepEqual([d.json.production, d.json.productionStatus], [true, "not_sure"]);
    const id = await toChecked(h, { ...DRAFT, name: "Unsure", address: "100.101.102.110", production: true, productionStatus: "not_sure" });
    await h.req("POST", `/api/servers/drafts/${id}/activate`);
    const fleet = (await h.req("GET", "/api/fleet")).json.servers.find((s: { id: string }) => s.id === id);
    assert.equal(fleet.production, true, "the fleet treats it as production");
    const plan = await h.req("POST", "/api/plans", { operation: "apply.packages.v1", serverId: id });
    assert.ok(plan.json.requiredAcknowledgements.length > 0, "plans ask for the production acknowledgements");
    const upd = await h.req("PATCH", `/api/servers/${id}`, { production: false });
    assert.deepEqual([upd.json.production, upd.json.productionStatus], [false, "no"]);
    assert.equal((await h.req("POST", "/api/servers/drafts", { ...DRAFT, production: "maybe" })).status, 400);
    assert.equal((await h.req("POST", "/api/servers/drafts", { ...DRAFT, production: false, productionStatus: "not_sure" })).status, 400, "they must agree");
  } finally { await h.app.close(); }
});

test("T-081 D-R2: re-registering a server under its own name points to it; D-R1: a very long id gets the contract's error, no echo", async () => {
  const h = await start();
  try {
    const d = await h.req("POST", "/api/servers/drafts", { ...DRAFT, name: "Imported One", address: "203.0.113.20" });
    assert.equal(d.status, 201);
    assert.deepEqual(d.json.duplicateOf, { id: IMPORTED, name: "Imported One" });
    const long = "a".repeat(500);
    for (const url of [`/api/servers/${long}/disconnect`, `/api/servers/drafts/${long}`]) {
      const r = await h.req(url.endsWith("disconnect") ? "POST" : "GET", url);
      assert.equal(r.status, 404, url);
      assert.ok(!r.text.includes(long), "the path is not echoed");
      assert.match(r.json.error, /^(SERVER_NOT_FOUND|DRAFT_NOT_FOUND)$/);
    }
  } finally { await h.app.close(); }
});

test("T-081 D-R3: the sweeper removes an abandoned draft's key without waiting for another registration", async () => {
  const h = await start({ sweepIntervalMs: 20 });
  try {
    const { id } = await toKeyIssued(h);
    assert.equal(existsSync(join(h.keysDir, id, "id_ed25519")), true);
    h.clock.advance(24 * 3600_000 + 1);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(existsSync(join(h.keysDir, id)), false, "the key is gone");
    assert.equal((await h.req("GET", `/api/servers/drafts/${id}`)).status, 404);
  } finally { await h.app.close(); }
});
