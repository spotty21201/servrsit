/**
 * T-077 activity history and export through the API. Hosts are synthetic,
 * the collector is injected, and operations are written straight into the
 * care store for a [SIMULATED] server. Nothing is contacted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildPlan, PRODUCTION_ACKS, type TransactionPreview } from "@servrsit/domain";
import type { CollectionResult } from "@servrsit/ssh";
import { SqliteActivityStore, SqliteCareStore, SqliteFindingStore } from "@servrsit/store";
import { REDACTION_STATEMENT } from "@servrsit/contracts";
import { FleetConfigSchema } from "../fleet/config.js";
import { FleetService } from "../fleet/service.js";
import { makeObservation } from "../fleet/observation.fixtures.js";
import { signedInServer } from "../auth/testing.js";

const A = "11111111-1111-4111-a111-111111111111";
const SIM = "00000000-0000-4000-8000-0000005e0a77";
const SECRET = "sk-test-only-not-real-0123456789abcdef";
const config = FleetConfigSchema.parse({
  healthIntervalMinutes: 15,
  hosts: [{ id: A, name: "Alpha", access: "ssh", address: "alpha.example", port: 22, user: "u", role: null, production: true, collect: true }],
});
const preview: TransactionPreview = {
  upgrades: [{ name: "openssl", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5", origin: "Ubuntu:24.04/noble-updates" }],
  removals: [], downgrades: [], held: [], locked: false, stateDigest: "sha256:s",
};

class Clock {
  t = new Date("2026-11-17T10:00:00.000Z").getTime();
  now = () => new Date(this.t);
  advance(ms: number) { this.t += ms; }
}

async function start() {
  const clock = new Clock();
  let next: () => CollectionResult = () => ({ ok: true, observation: makeObservation({ collectedAt: clock.now().toISOString(), diskPercent: 97 }) });
  const service = new FleetService({ config, knownHostsFile: "/x/k", pinChecker: async () => "pinned", now: clock.now, collector: async () => next() });
  const care = new SqliteCareStore({ path: ":memory:" });
  const activity = new SqliteActivityStore({ path: ":memory:" });
  const findings = new SqliteFindingStore({ path: ":memory:" });
  const s = await signedInServer({
    config, fleetService: service, startChecks: false, logger: false, redactSecrets: [SECRET],
    care: { store: care, now: clock.now },
    findings: { store: findings, activity, now: clock.now },
  });
  const pass = async () => {
    await service.refreshAll();
    // The injected service has no pass hook; reads bring the records up to date.
    await s.inject({ method: "GET", url: "/api/activity" });
  };
  const simulatedOperation = () => {
    const plan = buildPlan({
      id: randomUUID(), version: 1, operation: "apply.packages.v1",
      server: { id: SIM, production: false, writesEnabled: true }, preview, unresolved: null, now: clock.now(), controllerClockTrusted: true,
    });
    care.insertPlan(plan);
    const r = care.approve({
      planId: plan.id, planVersion: 1, planDigest: plan.digest, idempotencyKey: `idem-${plan.id}`.slice(0, 32), owner: "owner",
      acknowledgements: [...PRODUCTION_ACKS], writesEnabled: true, targetKind: "simulated", now: clock.now(), newId: () => randomUUID(),
    });
    if (r.kind !== "created") throw new Error(`approve: ${r.kind}`);
    return r.operation.id;
  };
  const list = async (qs = "") => (await s.inject({ method: "GET", url: `/api/activity${qs}` })).json() as {
    records: Array<{ id: string; type: string; result: string; title: string; summary: string; serverName: string; simulated: boolean; href: string | null; at: string }>;
    truncated: boolean;
  };
  return { ...s, clock, service, care, activity, findings, set: (f: () => CollectionResult) => { next = f; }, pass, simulatedOperation, list };
}

test("inspections, findings and operations appear, newest first, from fixed text only", async () => {
  const h = await start();
  try {
    await h.pass();
    h.clock.advance(15 * 60_000);
    h.set(() => ({ ok: false, failure: { code: "ROUTE_UNAVAILABLE", message: "ssh: raw stderr that must never appear" }, attemptedAt: h.clock.now().toISOString(), contacted: true }));
    await h.pass();
    await h.pass(); // a second attempt at the same instant is the same record
    h.clock.advance(60_000);
    const opId = h.simulatedOperation();
    h.care.requestStop(opId, "owner", h.clock.now());

    const all = await h.list();
    const checks = all.records.filter((r) => r.type === "inspection");
    assert.deepEqual(checks.map((r) => r.result), ["failed", "succeeded"]);
    assert.equal(checks[0]!.summary, "The host could not be reached.");
    assert.equal(checks.at(-1)!.summary, "16 of 16 checks ran.");
    const op = all.records.find((r) => r.type === "operation")!;
    assert.deepEqual([op.title, op.result, op.summary, op.simulated, op.href, op.serverName], [
      "Update packages", "cancelled", "Cancelled before anything was sent.", true, `/operations/${opId}`, "Removed server",
    ]);
    assert.ok(all.records.some((r) => r.type === "finding" && r.title.startsWith("Finding opened")));
    assert.equal(all.records[0]!.type, "operation", "newest first");
    const text = JSON.stringify(all);
    assert.doesNotMatch(text, /raw stderr/);
  } finally { await h.app.close(); }
});

test("filters: type, server, result, text, range and limit", async () => {
  const h = await start();
  try {
    await h.pass();
    h.clock.advance(15 * 60_000);
    await h.pass();
    assert.ok((await h.list("?type=inspection")).records.every((r) => r.type === "inspection"));
    assert.equal((await h.list(`?server=${A}&type=inspection`)).records.length, 2);
    assert.equal((await h.list("?result=failed")).records.length, 0);
    assert.ok((await h.list("?q=DISK")).records.every((r) => /disk/i.test(r.summary + r.title)));
    assert.equal((await h.list("?type=inspection&from=2026-11-17T10:10:00.000Z")).records.length, 1);
    const lim = await h.list("?limit=1");
    assert.deepEqual([lim.records.length, lim.truncated], [1, true]);
    for (const bad of ["?type=chat", "?server=x", "?limit=0", "?from=yesterday", "?extra=1"]) {
      assert.equal((await h.inject({ method: "GET", url: `/api/activity${bad}` })).statusCode, 400, bad);
    }
  } finally { await h.app.close(); }
});

test("exports are built on the server, scrubbed, downloadable as attachments, listed until they expire", async () => {
  const h = await start();
  try {
    await h.pass();
    h.simulatedOperation();
    const req = { from: "2026-11-17T00:00:00.000Z", to: "2026-11-18T00:00:00.000Z", timeZone: "Asia/Jakarta" };
    const rep = await h.inject({ method: "POST", url: "/api/exports", payload: { ...req, format: "report" } });
    assert.equal(rep.statusCode, 201, rep.body);
    const meta = rep.json();
    assert.equal(meta.filename, "servrsit-activity-202611171000.txt");
    assert.equal(meta.redaction, REDACTION_STATEMENT);
    assert.equal(meta.expiresAt, "2026-11-24T10:00:00.000Z");
    const dl = await h.inject({ method: "GET", url: meta.downloadUrl });
    assert.equal(dl.headers["content-disposition"], `attachment; filename="${meta.filename}"`);
    assert.match(dl.body, /^ServrSit activity report\n/);
    assert.match(dl.body, /Created: 17\/11\/2026, 17:00 GMT\+7/);
    assert.match(dl.body, /\[SIMULATED\]/);
    assert.ok(dl.body.includes(REDACTION_STATEMENT));

    const json = await h.inject({ method: "POST", url: "/api/exports", payload: { ...req, format: "json", type: "inspection" } });
    const body = JSON.parse((await h.inject({ method: "GET", url: json.json().downloadUrl })).body) as { records: Array<{ type: string }> };
    assert.ok(body.records.length > 0 && body.records.every((r) => r.type === "inspection"));

    assert.equal((await h.inject({ method: "GET", url: "/api/exports" })).json().exports.length, 2);
    h.clock.advance(7 * 86_400_000);
    assert.equal((await h.inject({ method: "GET", url: "/api/exports" })).json().exports.length, 0);
    assert.equal((await h.inject({ method: "GET", url: meta.downloadUrl })).statusCode, 410);
    assert.equal((await h.inject({ method: "POST", url: "/api/exports", payload: { ...req, format: "report", timeZone: "Mars/Olympus" } })).statusCode, 400);
    assert.equal((await h.inject({ method: "POST", url: "/api/exports", payload: { ...req, format: "report", from: req.to, to: req.from } })).statusCode, 400);
  } finally { await h.app.close(); }
});

test("a known secret value never reaches an export", async () => {
  const h = await start();
  try {
    await h.pass();
    // Plant the secret where text could come from: a finding summary.
    h.findings.observe(A, { key: "planted", rule: "test.planted.v1", severity: "warning", summary: `token ${SECRET} here` }, h.clock.now().toISOString(), true, () => randomUUID());
    const meta = (await h.inject({ method: "POST", url: "/api/exports", payload: { format: "report", from: "2026-11-17T00:00:00.000Z", to: "2026-11-18T00:00:00.000Z", timeZone: "UTC" } })).json();
    const dl = await h.inject({ method: "GET", url: meta.downloadUrl });
    assert.ok(dl.body.includes("token "), "the record is there");
    assert.ok(!dl.body.includes(SECRET), "its secret is not");
  } finally { await h.app.close(); }
});

test("routes need a session; creating an export needs the CSRF token", async () => {
  const h = await start();
  try {
    assert.equal((await h.app.inject({ method: "GET", url: "/api/activity" })).statusCode, 401);
    assert.equal((await h.app.inject({ method: "GET", url: "/api/exports" })).statusCode, 401);
    const r = await h.app.inject({ method: "POST", url: "/api/exports", headers: { cookie: h.owner.cookie, "content-type": "application/json" }, payload: "{}" });
    assert.equal(r.statusCode, 403);
    assert.equal((await h.inject({ method: "GET", url: "/api/exports/not-an-id/download" })).statusCode, 404);
  } finally { await h.app.close(); }
});
