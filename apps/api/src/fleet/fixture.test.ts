import { test } from "node:test";
import assert from "node:assert/strict";
import { FleetResponseSchema } from "@servrsit/contracts";
import { buildFixtureFleet, FIXTURE_IDS } from "./fixture.js";
import { FleetConfigSchema, loadFleetConfig } from "./config.js";
import { coverageOf, deriveStatus } from "./status.js";

const NOW = new Date("2026-11-17T09:00:00.000Z");

test("fixture mode never reuses a configured host id or name (D5)", async () => {
  const real = await loadFleetConfig();
  const fleet = buildFixtureFleet(real, NOW);
  const realIds = new Set(real.hosts.map((h) => h.id));
  const realNames = new Set(real.hosts.map((h) => h.name.toLowerCase()));
  for (const s of fleet.servers) {
    assert.equal(realIds.has(s.id), false, `fixture id ${s.id} must not be a real host id`);
    assert.equal(realNames.has(s.name.toLowerCase()), false, `fixture name ${s.name} must not be a real host name`);
  }
  const text = JSON.stringify(fleet).toLowerCase();
  for (const name of realNames) assert.equal(text.includes(name), false, `no trace of real host '${name}'`);
});

test("fixture output does not depend on the configured hosts at all", () => {
  const a = FleetConfigSchema.parse({ healthIntervalMinutes: 15, hosts: [{ id: "11111111-1111-4111-a111-111111111111", name: "One", access: "local", role: null, production: true, collect: true }] });
  const b = FleetConfigSchema.parse({ healthIntervalMinutes: 15, hosts: [{ id: "22222222-2222-4222-a222-222222222222", name: "Two", access: "local", role: "x", production: false, collect: true }] });
  assert.deepEqual(buildFixtureFleet(a, NOW), buildFixtureFleet(b, NOW));
});

test("fixture ids are fixed, obviously synthetic, and a collision is refused", () => {
  for (const id of Object.values(FIXTURE_IDS)) assert.match(id, /^00000000-0000-4000-8000-0000000000[0-9a-f]{2}$/);
  const clash = FleetConfigSchema.parse({ healthIntervalMinutes: 15, hosts: [{ id: FIXTURE_IDS.a, name: "Clash", access: "local", role: null, production: true, collect: true }] });
  assert.throws(() => buildFixtureFleet(clash, NOW), /collides/);
});

test("every fixture server is labelled, schema-valid, and fixture mode is declared", async () => {
  const fleet = FleetResponseSchema.parse(buildFixtureFleet(await loadFleetConfig(), NOW));
  assert.equal(fleet.mode, "fixture");
  for (const s of fleet.servers) {
    assert.equal(s.source, "fixture");
    assert.ok(s.statusReason.startsWith("[FIXTURE DATA]"), s.name);
    assert.ok(s.role?.startsWith("[FIXTURE]"), s.name);
    assert.equal(s.production, false, "no fixture pretends to be production");
  }
});

test("observedAt exists exactly when an observation exists (fixes the T-044 evidence mismatch)", async () => {
  for (const s of buildFixtureFleet(await loadFleetConfig(), NOW).servers) {
    assert.equal(s.observedAt === null, s.observation === null, s.name);
    assert.equal(s.freshUntil === null, s.observation === null, s.name);
    if (s.observation !== null) assert.equal(s.observedAt, s.observation.collectedAt, s.name);
  }
});

test("each fixture status is the status live rules would derive from its own data", async () => {
  const config = await loadFleetConfig();
  const intervalMs = config.healthIntervalMinutes * 60_000;
  for (const s of buildFixtureFleet(config, NOW).servers) {
    const derived = deriveStatus({
      collect: true,
      collectDisabledReason: undefined,
      pin: s.status === "unverified-host" ? "not-pinned" : "pinned",
      latestAttempt: s.latestAttempt === null ? null : { at: new Date(s.latestAttempt.at), succeeded: s.latestAttempt.succeeded, failure: s.latestAttempt.failure },
      lastSuccessAt: s.observedAt === null ? null : new Date(s.observedAt),
      lastSuccessCoverageComplete: s.observation === null ? false : coverageOf(s.observation).unavailable.length === 0,
      healthIntervalMs: intervalMs,
      now: NOW,
    });
    assert.equal(derived.status, s.status, s.name);
  }
});

test("the set covers fresh, partial, unreachable (with last success kept) and a no-data card", async () => {
  const servers = buildFixtureFleet(await loadFleetConfig(), NOW).servers;
  assert.deepEqual(servers.map((s) => s.status), ["fresh", "partial", "unreachable", "unverified-host"]);
  const unreachable = servers[2]!;
  assert.equal(unreachable.latestAttempt?.succeeded, false);
  assert.notEqual(unreachable.observation, null, "the last success is shown next to the failure");
  assert.ok(unreachable.findings.some((f) => f.id === "unreachable"));
  assert.ok(servers[1]!.findings.some((f) => f.id === "disk:/" && f.severity === "warning"));
  assert.deepEqual(servers[1]!.coverage?.unavailable.map((u) => u.check), ["memory"]);
});
