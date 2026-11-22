/**
 * [FIXTURE DATA] T-089: the controller write gate (config/writes.json) and the
 * care loop for Sentani through the API, against a FAKE server.
 *
 * Everything lives in temporary directories: writes.json, test-bench.json,
 * the signing and maintenance keys, the registry. ssh is never started: the
 * write target gets a fake command runner that plays Sentani's inspect script
 * and helper gateway. The shipped config/writes.json is not touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestOf, verifyManifestSignature, type SignedManifest } from "@servrsit/domain";
import type { RunRequest, RunResult } from "@servrsit/ssh";
import { SqliteCareStore, SqliteServerStore, type NewServer } from "@servrsit/store";
import { buildServer } from "../server.js";
import { loadFleetConfig, type FleetHost } from "../fleet/config.js";
import { FleetService } from "../fleet/service.js";
import { makeObservation } from "../fleet/observation.fixtures.js";
import { enrolOwner, setupTokenSink } from "../auth/testing.js";
import { loadOrCreateMaintenanceKey, loadOrCreateSigningKey } from "../helper-bench/keys.js";
import { WriteGate } from "./write-gate.js";
import { startDispatchLoop } from "./dispatch-loop.js";

const SENTANI = "00000000-0000-4000-8000-0000000089b1";
const ADDRESS = "100.101.102.103";
const FP = "SHA256:fixture-sentani";
const MID = "0123456789abcdef0123456789abcdef";
const ORIGIN = "http://100.104.220.8:5173";
const INSTALL = "servrsit-fixture-install";

const tmp = () => mkdtempSync(join(tmpdir(), "servrsit-t089-api-"));

function sentaniRow(knownHostsFile: string | null, over: Partial<NewServer> = {}): NewServer {
  return {
    id: SENTANI, source: "registration", access: "ssh", name: "Sentani", role: null, productionStatus: "no", address: ADDRESS, port: 22, user: "spotty",
    identityFile: "/keys/inspect/id_ed25519", knownHostsFile, importantServices: [], collect: true, collectDisabledReason: null,
    hostKey: { algorithm: "ED25519", fingerprint: FP, observedAt: "2026-11-21T00:00:00.000Z", confirmedAt: "2026-11-21T00:00:00.000Z", confirmedBy: "owner" },
    accessKey: null, createdAt: "2026-11-21T00:00:00.000Z", ...over,
  };
}

/** A bench directory: writes.json, test-bench.json, keys, Sentani's own known_hosts and a registry. */
function bench(writesEnabled: boolean) {
  const dir = tmp();
  const helperDir = join(dir, "helper");
  const signer = loadOrCreateSigningKey(helperDir).signer;
  loadOrCreateMaintenanceKey("sentani", helperDir);
  const configPath = join(dir, "writes.json");
  const setWrites = (on: boolean, extra: Record<string, unknown> = {}) =>
    writeFileSync(configPath, JSON.stringify({ servers: { sentani: { writesEnabled: on }, ...extra } }));
  setWrites(writesEnabled);
  const benchPath = join(dir, "test-bench.json");
  writeFileSync(benchPath, JSON.stringify({ installationId: INSTALL, servers: { sentani: { founderSshTarget: "spotty@sentani", account: "servrsit", homeUser: "spotty", from: "100.104.220.8" } } }));
  const knownHostsFile = join(dir, "sentani_known_hosts");
  writeFileSync(knownHostsFile, `${ADDRESS} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureSentani\n`);
  const registry = new SqliteServerStore({ path: ":memory:" });
  const gate = new WriteGate({ configPath, benchPath, helperDir });
  return { dir, helperDir, signer, configPath, setWrites, benchPath, knownHostsFile, registry, gate };
}

test("write gate: closed unless writes.json enables Sentani; any other name closes it for everyone", () => {
  const b = bench(false);
  b.registry.register(sentaniRow(b.knownHostsFile), "d1", "owner", new Date());
  const row = () => b.registry.get(SENTANI)!;
  const active = () => b.registry.listActive();
  assert.equal(b.gate.accessFor(row(), active()), null, "writesEnabled false");
  b.setWrites(true);
  const access = b.gate.accessFor(row(), active());
  assert.ok(access !== null);
  assert.equal(access.hostKeyFingerprint, FP);
  assert.deepEqual(access.gateway, { host: ADDRESS, account: "servrsit", identityFile: join(b.helperDir, "sentani", "id_ed25519"), knownHostsFile: b.knownHostsFile });
  assert.deepEqual(access.inspect, { target: { host: ADDRESS, port: 22, user: "spotty", identityFile: "/keys/inspect/id_ed25519" }, options: { knownHostsFile: b.knownHostsFile } });
  for (const other of ["nabire", "timika", "merauke", "other"]) {
    b.setWrites(true, { [other]: { writesEnabled: true } });
    assert.equal(b.gate.accessFor(row(), active()), null, `listing ${other} closes the gate`);
  }
  writeFileSync(b.configPath, "{ not json");
  assert.equal(b.gate.accessFor(row(), active()), null);
  b.setWrites(true);
  assert.notEqual(b.gate.accessFor(row(), active()), null, "re-read when the file changes");
  b.setWrites(false);
  assert.equal(b.gate.accessFor(row(), active()), null, "closing takes effect on the next use");
  assert.notEqual(b.gate.accessFor(row(), active(), false), null, "read-only access to follow an operation already sent");
});

test("write gate: protected names, an imported row, a second Sentani, a missing key or host key all close it", () => {
  const b = bench(true);
  b.registry.register(sentaniRow(b.knownHostsFile), "d1", "owner", new Date());
  for (const name of ["Nabire", "Timika", "Merauke"]) {
    const row = { ...b.registry.get(SENTANI)!, name };
    assert.equal(b.gate.accessFor(row, b.registry.listActive()), null, name);
  }
  assert.equal(b.gate.accessFor({ ...b.registry.get(SENTANI)!, hostKey: null }, b.registry.listActive()), null, "no confirmed host key");
  assert.equal(b.gate.accessFor({ ...b.registry.get(SENTANI)!, knownHostsFile: null }, b.registry.listActive()), null, "shared known_hosts");
  const twin = { ...b.registry.get(SENTANI)!, id: "00000000-0000-4000-8000-0000000089b2" };
  assert.equal(b.gate.accessFor(b.registry.get(SENTANI)!, [...b.registry.listActive(), twin]), null, "two rows named Sentani");
  const noKeys = new WriteGate({ configPath: b.configPath, benchPath: b.benchPath, helperDir: join(tmp(), "empty") });
  assert.equal(noKeys.accessFor(b.registry.get(SENTANI)!, b.registry.listActive()), null, "keys are never created by the gate");
  assert.equal(noKeys.signer(), null);
  writeFileSync(b.knownHostsFile, `${ADDRESS} ssh-ed25519 AAAA1\n100.101.102.104 ssh-ed25519 AAAA2\n`);
  assert.equal(b.gate.accessFor(b.registry.get(SENTANI)!, b.registry.listActive()), null, "known_hosts pins another host");
});

/** A fake Sentani for the runner: inspect script and helper gateway. */
function fakeSentani(trusted: Record<string, string>) {
  const installed: Record<string, string> = { "wget:amd64": "1.21.4-1ubuntu4", "vim-common:all": "2:9.1.0016-1ubuntu7.8" };
  const upgrades: Record<string, { to: string; origin: string }> = {
    "wget:amd64": { to: "1.21.4-1ubuntu4.1", origin: "Ubuntu:24.04/noble-updates" },
    "vim-common:all": { to: "2:9.1.0016-1ubuntu7.9", origin: "Ubuntu:24.04/noble-updates" },
  };
  const ledger = new Map<string, { digest: string; manifest: SignedManifest["manifest"]; state: "running" | "finished" }>();
  const calls = { inspect: 0, submit: 0, query: 0, hosts: new Set<string>() };
  const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false, stdoutTruncated: false, spawnFailed: false });
  const keysOf = (m: SignedManifest["manifest"]) => (m.scope as { readonly packages: ReadonlyArray<{ name: string; arch: string; to: string }> }).packages;
  const runner = async (r: RunRequest): Promise<RunResult> => {
    calls.hosts.add(r.args[r.args.indexOf("--") + 1]!);
    const identity = r.args[r.args.indexOf("-i") + 1] ?? "";
    if (identity.endsWith("/sentani/id_ed25519")) {
      const body = JSON.parse(r.stdin) as { op: string; signed?: SignedManifest; operationId?: string };
      if (body.op === "submit") {
        calls.submit++;
        const m = body.signed!.manifest;
        if (!verifyManifestSignature(body.signed!, trusted) || m.installationId !== INSTALL || m.server.hostKeyFingerprint !== FP) return ok(JSON.stringify({ status: "rejected", code: "MISBOUND" }));
        const pre = digestOf({ installed: Object.fromEntries(keysOf(m).map((c) => `${c.name}:${c.arch}`).sort().map((k) => [k, installed[k] ?? null])) });
        if (pre !== m.preconditionDigest) return ok(JSON.stringify({ status: "rejected", code: "PRECONDITION_CHANGED" }));
        ledger.set(m.operationId, { digest: digestOf(m), manifest: m, state: "running" });
        return ok(JSON.stringify({ status: "accepted", record: { operationId: m.operationId, manifestDigest: digestOf(m), state: "running", exitCode: null } }));
      }
      calls.query++;
      const rec = ledger.get(body.operationId!);
      if (rec === undefined) return ok(JSON.stringify({ found: false, helperVersion: "0.3.0" }));
      if (rec.state === "running") {
        for (const c of keysOf(rec.manifest)) installed[`${c.name}:${c.arch}`] = c.to;
        rec.state = "finished";
      }
      return ok(JSON.stringify({
        found: true, helperVersion: "0.3.0", record: { operationId: body.operationId, manifestDigest: rec.digest, state: "finished", exitCode: 0 },
        outcome: "succeeded", restartNeeded: [], reasonCode: null, keptFiles: [{ path: "/etc/wgetrc", newDefault: "/etc/wgetrc.dpkg-dist" }], evidence: [],
      }));
    }
    calls.inspect++;
    const nonce = r.args.at(-1) ?? ""; // T-091: `sh -s <nonce>`
    let out = "";
    for (const s of [...r.stdin.matchAll(/^section (\w+) /gm)].map((m) => m[1]!)) {
      const body =
        s === "aptsim"
          ? Object.entries(upgrades).filter(([k, u]) => installed[k] !== u.to).map(([k, u]) => `Inst ${k.split(":")[0]} [${installed[k]}] (${u.to} ${u.origin} [${k.split(":")[1]}])`).join("\n")
          : Object.entries(installed).map(([k, v]) => `${k.split(":")[0]} ${k.split(":")[1]} ${v} ii `).join("\n");
      out += `@@BEGIN ${nonce} ${s}@@\n${body}\n@@END ${nonce} ${s} 0@@\n`;
    }
    return ok(out);
  };
  return { runner, calls, installed };
}

async function app(writesEnabled: boolean) {
  const b = bench(writesEnabled);
  const base = await loadFleetConfig();
  // The shipped hosts.json is imported as usual, without its Sentani entry (this test registers its own).
  const config = { ...base, hosts: base.hosts.filter((h) => h.name !== "Sentani") };
  b.registry.register(sentaniRow(b.knownHostsFile), "d1", "owner", new Date());
  const sentaniHost: FleetHost = { id: SENTANI, name: "Sentani", role: null, production: false, importantServices: [], collect: true, writesEnabled: false, access: "ssh", address: ADDRESS, port: 22, user: "spotty" };
  const obs = makeObservation();
  const fleet = new FleetService({
    config, knownHostsFile: "/x/known_hosts", hosts: () => [sentaniHost], pinChecker: async () => "pinned",
    collector: async () => ({ ok: true, observation: { ...obs, host: { ...obs.host, machineId: { status: "ok" as const, value: MID } } } }),
  });
  await fleet.refreshAll();
  const server = fakeSentani({ [b.signer.keyId]: b.signer.publicKeyPem });
  const sink = setupTokenSink();
  const fastify = await buildServer({
    config, fleetService: fleet, startChecks: false, logger: false,
    auth: { onSetupToken: sink.onSetupToken },
    servers: { store: b.registry },
    care: { store: new SqliteCareStore({ path: ":memory:" }), writeGate: b.gate, sshRunner: server.runner },
  });
  const owner = await enrolOwner(fastify, sink.token());
  const headers = { "content-type": "application/json", cookie: owner.cookie, "x-csrf-token": owner.csrfToken, origin: ORIGIN };
  const post = (url: string, body: unknown) => fastify.inject({ method: "POST", url, headers, payload: JSON.stringify(body) });
  const get = (url: string) => fastify.inject({ method: "GET", url, headers: { cookie: owner.cookie } });
  return { b, fastify, server, post, get };
}

type PlanJson = { id: string; version: number; digest: string; approvable: boolean; blockers: Array<{ code: string }>; preconditions: { previewDigest: string }; scope: { packages: Array<{ name: string }> }; requiredAcknowledgements: string[] };

test("API: Sentani with writes.json open: plan from the read-only preview, approve, dispatch through the helper, verified", async () => {
  const h = await app(true);
  try {
    const plan = (await h.post("/api/plans", { operation: "apply.packages.v1", serverId: SENTANI })).json() as PlanJson;
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.approvable, true);
    assert.deepEqual(plan.scope.packages.map((c) => c.name), ["vim-common", "wget"]);
    assert.equal(plan.preconditions.previewDigest, digestOf({ installed: { "vim-common:all": "2:9.1.0016-1ubuntu7.8", "wget:amd64": "1.21.4-1ubuntu4" } }));
    assert.equal(h.server.calls.submit, 0, "planning never submits");
    const a = await h.post(`/api/plans/${plan.id}/approvals`, { planVersion: plan.version, planDigest: plan.digest, idempotencyKey: "idem-key-0000000089", acknowledgements: plan.requiredAcknowledgements });
    assert.equal(a.statusCode, 201, a.body);
    const { operationId } = a.json() as { operationId: string };
    assert.ok(h.fastify.careDispatcher !== null);
    const r = await h.fastify.careDispatcher.drain();
    assert.equal(r.status, "final");
    const view = (await h.get(`/api/operations/${operationId}`)).json() as { operation: { state: string; simulated: boolean }; events: Array<{ type: string; payload: Record<string, unknown> }> };
    assert.equal(view.operation.state, "succeeded");
    assert.equal(view.operation.simulated, false);
    assert.deepEqual(view.events.find((e) => e.type === "remote_finished")?.payload["helperReport"], {
      helperVersion: "0.3.0", outcome: "succeeded", reasonCode: null, restartNeeded: [], keptFiles: [{ path: "/etc/wgetrc", newDefault: "/etc/wgetrc.dpkg-dist" }],
    });
    assert.equal(h.server.calls.submit, 1);
    assert.equal(h.server.installed["wget:amd64"], "1.21.4-1ubuntu4.1");
    assert.deepEqual([...h.server.calls.hosts], [ADDRESS], "only Sentani's address was ever named to ssh");
  } finally {
    await h.fastify.close();
  }
});

test("API: writes.json closed: Sentani's plan is WRITES_DISABLED and nothing is run on it; other real servers likewise", async () => {
  const h = await app(false);
  try {
    const plan = (await h.post("/api/plans", { operation: "apply.packages.v1", serverId: SENTANI })).json() as PlanJson;
    assert.deepEqual(plan.blockers.map((b) => b.code), ["WRITES_DISABLED"]);
    assert.equal(plan.preconditions.previewDigest, "none");
    const nabire = (await h.post("/api/plans", { operation: "apply.packages.v1", serverId: "22222222-2222-4222-a222-222222222222" })).json() as PlanJson;
    assert.deepEqual(nabire.blockers.map((b) => b.code), ["WRITES_DISABLED"]);
    assert.deepEqual(h.server.calls, { inspect: 0, submit: 0, query: 0, hosts: new Set() });
  } finally {
    await h.fastify.close();
  }
});

test("API: closing writes.json after approval stops the dispatch before anything is sent", async () => {
  const h = await app(true);
  try {
    const plan = (await h.post("/api/plans", { operation: "apply.packages.v1", serverId: SENTANI })).json() as PlanJson;
    const a = await h.post(`/api/plans/${plan.id}/approvals`, { planVersion: plan.version, planDigest: plan.digest, idempotencyKey: "idem-key-0000000090", acknowledgements: plan.requiredAcknowledgements });
    const { operationId } = a.json() as { operationId: string };
    h.b.setWrites(false);
    await h.fastify.careDispatcher!.drain();
    const view = (await h.get(`/api/operations/${operationId}`)).json() as { operation: { state: string } };
    assert.equal(view.operation.state, "cancelled_before_start");
    assert.equal(h.server.calls.submit, 0);
  } finally {
    await h.fastify.close();
  }
});

test("API: no route can reach the write gate or its file", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../routes/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(src, /WriteGate|write-gate|DEFAULT_WRITES_CONFIG_PATH|writeFile|readFile[^(]*\([^)]*writes/, f);
  }
});

test("dispatch loop: one step at a time, errors logged and survived, stops cleanly", async () => {
  let steps = 0;
  let inFlight = 0;
  const errors: string[] = [];
  const stop = startDispatchLoop(
    {
      runOnce: async () => {
        inFlight++;
        assert.equal(inFlight, 1, "never overlapping");
        steps++;
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        if (steps === 2) throw new Error("boom");
        return { status: "idle" as const };
      },
    },
    { intervalMs: 1, log: { error: (_o, m) => errors.push(m), info: () => undefined } },
  );
  await new Promise((r) => setTimeout(r, 80));
  stop();
  const at = steps;
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(at >= 3, `ran ${at} steps`);
  assert.ok(steps <= at + 1, "no new step after stop");
  assert.deepEqual(errors, ["writes: dispatcher step failed"]);
});

test("O-T1: approving a blocked reboot, restart or directories plan on Sentani answers PLAN_BLOCKED with its blockers", async () => {
  const h = await app(true);
  try {
    for (const body of [
      { operation: "reboot.host.v1", serverId: SENTANI },
      { operation: "restart.service.v1", serverId: SENTANI, unit: "ssh.service" },
      { operation: "prepare.directories.v1", serverId: SENTANI, directories: [{ path: "/srv/app", owner: "spotty", group: "spotty", mode: "0755" }] },
    ]) {
      const plan = (await h.post("/api/plans", body)).json() as PlanJson;
      assert.ok(plan.blockers.length > 0, body.operation);
      const r = await h.post(`/api/plans/${plan.id}/approvals`, { planVersion: plan.version, planDigest: plan.digest, idempotencyKey: `idem-key-ot1-${body.operation.replace(/\./g, "-")}`, acknowledgements: plan.requiredAcknowledgements });
      assert.equal(r.statusCode, 409, body.operation);
      assert.deepEqual(r.json(), { error: "PLAN_BLOCKED", blockers: plan.blockers.map((b) => b.code) }, body.operation);
    }
    assert.equal(h.server.calls.submit, 0);
  } finally {
    await h.fastify.close();
  }
});
