/**
 * T-079 settings through the API. Synthetic hosts, injected collector and a
 * fake AI provider; nothing is contacted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildPlan, PRODUCTION_ACKS, type TransactionPreview } from "@servrsit/domain";
import { SqliteCareStore, SqliteSettingsStore } from "@servrsit/store";
import { FleetConfigSchema } from "../fleet/config.js";
import { FleetService } from "../fleet/service.js";
import { makeObservation } from "../fleet/observation.fixtures.js";
import { signedInServer } from "../auth/testing.js";
import { AssistantResponder, type ModelProvider } from "@servrsit/ai";

const A = "11111111-1111-4111-a111-111111111111";
const config = FleetConfigSchema.parse({
  healthIntervalMinutes: 15,
  ownerTimeZone: "Asia/Jakarta",
  hosts: [{ id: A, name: "Alpha", access: "ssh", address: "alpha.example", port: 22, user: "u", role: null, production: true, collect: true }],
});
const AI = { available: true, providerLabel: "An OpenAI-compatible model service (model test).", route: "HTTPS to models.example.", region: null };

let modelCalls = 0;
/** A fake model that only counts calls; it never answers usefully. */
const fakeProvider: ModelProvider = {
  id: "openai_compatible",
  requestedModel: "fake",
  call: async () => { modelCalls++; return { ok: false, reason: "provider_error" } as never; },
  complete: async () => { modelCalls++; return { ok: false, reason: "provider_error" } as never; },
};

async function start(settingsPath = ":memory:", ai = AI) {
  const service = new FleetService({ config, knownHostsFile: "/x/k", pinChecker: async () => "pinned", collector: async () => ({ ok: true, observation: makeObservation() }) });
  const care = new SqliteCareStore({ path: ":memory:" });
  const settings = new SqliteSettingsStore({ path: settingsPath });
  const s = await signedInServer({ config, fleetService: service, startChecks: false, logger: false, aiDescription: ai, assistant: new AssistantResponder(fakeProvider), care: { store: care }, findings: { settings } });
  const j = async (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => {
    const r = await s.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: r.statusCode, body: r.json() };
  };
  return { ...s, j, service, care, settings };
}

test("GET shows the schedule, AI, retention and server access, with defaults from the config", async () => {
  const h = await start();
  try {
    const d = (await h.j("GET", "/api/settings")).body;
    assert.deepEqual(d.schedule, { intervalMinutes: 15, dailyTime: "03:00", dailyTimeInEffect: false, timeZone: "Asia/Jakarta", paused: false, pausedSince: null });
    assert.equal(d.ai.enabled, true);
    assert.equal(d.ai.route, "HTTPS to models.example.");
    assert.deepEqual(d.retention, { observationsDays: 30, operationRecordsDays: 90, exportsDays: 7 });
    assert.deepEqual(d.servers.map((s: { name: string; keyKind: string; connected: boolean }) => [s.name, s.keyKind, s.connected]), [["Alpha", "owner key", true]]);
  } finally { await h.app.close(); }
});

test("saving the schedule changes the interval and time zone now and after a restart; it is validated", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "servrsit-settings-")), "s.db");
  const h = await start(path);
  try {
    const r = await h.j("PUT", "/api/settings/schedule", { intervalMinutes: 30, dailyTime: "04:30", timeZone: "Asia/Jayapura" });
    assert.equal(r.status, 200);
    assert.equal(r.body.schedule.intervalMinutes, 30);
    assert.equal(h.service.schedulerState().intervalMs, 30 * 60_000);
    assert.equal((await h.j("GET", "/api/fleet")).body.ownerTimeZone, "Asia/Jayapura");
    for (const bad of [{ intervalMinutes: 7, dailyTime: "04:30", timeZone: "UTC" }, { intervalMinutes: 15, dailyTime: "25:00", timeZone: "UTC" }, { intervalMinutes: 15, dailyTime: "04:30", timeZone: "Mars/Base" }, { intervalMinutes: 15, dailyTime: "04:30", timeZone: "UTC", install: true }]) {
      assert.equal((await h.j("PUT", "/api/settings/schedule", bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal(h.settings.history("schedule").length, 1);
  } finally { await h.app.close(); }
  const h2 = await start(path);
  try {
    assert.equal(h2.service.schedulerState().intervalMs, 30 * 60_000, "the saved interval survives a restart");
    assert.equal((await h2.j("GET", "/api/settings")).body.schedule.timeZone, "Asia/Jayapura");
  } finally { await h2.app.close(); }
});

test("pause from settings is the same pause as the scheduler's", async () => {
  const h = await start();
  try {
    const p = (await h.j("POST", "/api/settings/schedule/pause", { paused: true })).body;
    assert.equal(p.schedule.paused, true);
    assert.equal((await h.j("GET", "/api/scheduler")).body.status, "paused");
    assert.equal((await h.j("POST", "/api/settings/schedule/pause", { paused: false })).body.schedule.paused, false);
  } finally { await h.app.close(); }
});

test("AI off stops new inference at the next message; it cannot be turned on without a provider", async () => {
  const h = await start();
  try {
    await h.service.refreshAll();
    const ask = () => h.j("POST", "/api/assistant/messages", { message: "Why is Alpha slow today?", scope: "all" });
    modelCalls = 0;
    await ask();
    assert.ok(modelCalls > 0, "with AI on, the model is asked");
    const off = await h.j("PUT", "/api/settings/ai", { enabled: false });
    assert.equal(off.body.ai.enabled, false);
    modelCalls = 0;
    const answer = await ask();
    assert.equal(answer.status, 200);
    assert.equal(modelCalls, 0, "with AI off, nothing is sent to the model");
    assert.equal((await h.j("PUT", "/api/settings/ai", { enabled: true })).body.ai.enabled, true);
  } finally { await h.app.close(); }
  const none = await start(":memory:", { available: false, providerLabel: "None: answers come from the checks only.", route: "No external service.", region: null });
  try {
    assert.equal((await none.j("GET", "/api/settings")).body.ai.enabled, false);
    const r = await none.j("PUT", "/api/settings/ai", { enabled: true });
    assert.deepEqual([r.status, r.body.error], [409, "NOT_ALLOWED"]);
  } finally { await none.app.close(); }
});

test("disconnect preview lists unresolved work; disconnect is refused while it exists", async () => {
  const h = await start();
  try {
    assert.deepEqual((await h.j("GET", `/api/servers/${A}/disconnect-preview`)).body, { queued: [], active: [], canDisconnect: true });
    // An operation for the real host, written straight to the store (the API itself can never approve one).
    const preview: TransactionPreview = { upgrades: [{ name: "x", arch: "amd64", from: "1", to: "2", origin: "Ubuntu:24.04/noble-updates" }], removals: [], downgrades: [], held: [], locked: false, stateDigest: "d" };
    const plan = buildPlan({ id: randomUUID(), version: 1, operation: "apply.packages.v1", server: { id: A, production: true, writesEnabled: true }, preview, unresolved: null, now: new Date(), controllerClockTrusted: true });
    h.care.insertPlan(plan);
    const r = h.care.approve({ planId: plan.id, planVersion: 1, planDigest: plan.digest, idempotencyKey: "idem-key-settings-01", owner: "o", acknowledgements: [...PRODUCTION_ACKS], writesEnabled: true, targetKind: "ssh", now: new Date(), newId: () => randomUUID() });
    assert.equal(r.kind, "created");
    const p = (await h.j("GET", `/api/servers/${A}/disconnect-preview`)).body;
    assert.deepEqual([p.queued.map((w: { title: string }) => w.title), p.active, p.canDisconnect], [["Update packages"], [], false]);
    assert.equal((await h.j("POST", `/api/servers/${A}/disconnect`)).status, 409);
    assert.equal((await h.j("GET", "/api/servers/00000000-0000-4000-8000-000000000999/disconnect-preview")).status, 404);
  } finally { await h.app.close(); }
});

test("routes need a session; changes need the CSRF token", async () => {
  const h = await start();
  try {
    assert.equal((await h.app.inject({ method: "GET", url: "/api/settings" })).statusCode, 401);
    assert.equal((await h.app.inject({ method: "PUT", url: "/api/settings/ai", headers: { cookie: h.owner.cookie, "content-type": "application/json" }, payload: '{"enabled":false}' })).statusCode, 403);
  } finally { await h.app.close(); }
});
