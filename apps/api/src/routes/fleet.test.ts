import { test } from "node:test";
import assert from "node:assert/strict";
import { signedInServer } from "../auth/testing.js";
import { FleetConfigSchema } from "../fleet/config.js";
import { FleetResponseSchema } from "../fleet/schema.js";
import { FleetService } from "../fleet/service.js";
import { makeObservation } from "../fleet/observation.fixtures.js";

const config = FleetConfigSchema.parse({
  healthIntervalMinutes: 15,
  hosts: [
    { id: "11111111-1111-4111-a111-111111111111", name: "Alpha", access: "ssh", address: "alpha", port: 22, user: "spotty", identityFile: "~/.ssh/id_ed25519_secret_name", role: null, production: true, collect: true },
    { id: "22222222-2222-4222-a222-222222222222", name: "Gamma", access: "ssh", address: "gamma", port: 22, user: "spotty", role: null, production: true, collect: true },
    { id: "33333333-3333-4333-a333-333333333333", name: "Local", access: "local", role: "Dev host", production: false, collect: true },
  ],
});

function service() {
  const contacted: string[] = [];
  const s = new FleetService({
    config, knownHostsFile: "/x/known_hosts",
    pinChecker: async (h) => (h.access === "local" || h.address === "alpha" ? "pinned" : "not-pinned"),
    collector: async (h) => {
      contacted.push(h.name);
      return { ok: true, observation: makeObservation({ collectedAt: new Date().toISOString() }) };
    },
  });
  return { s, contacted };
}

test("GET /health returns 200 with status ok and a timestamp", async () => {
  const { app, inject } = await signedInServer({ config, fleetService: service().s, startChecks: false, logger: false });
  const res = await inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { status: string; timestamp: string };
  assert.equal(body.status, "ok");
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  await app.close();
});

test("live mode: schema-valid, per-server source live, unverified host reported and never contacted", async () => {
  const { s, contacted } = service();
  const { app, inject } = await signedInServer({ config, fleetService: s, mode: "live", startChecks: false, logger: false });
  await s.refreshAll();
  const res = await inject({ method: "GET", url: "/api/fleet" });
  assert.equal(res.statusCode, 200);
  const body = FleetResponseSchema.parse(res.json());
  assert.equal(body.mode, "live");
  assert.ok(body.servers.every((x) => x.source !== "fixture"), "no fixture data in live mode");
  const by = Object.fromEntries(body.servers.map((x) => [x.name, x]));
  assert.equal(by["Alpha"]?.status, "fresh");
  assert.equal(by["Gamma"]?.status, "unverified-host");
  assert.equal(by["Gamma"]?.source, "none", "a card with no observation is never badged live (O1)");
  assert.equal(by["Alpha"]?.source, "live");
  assert.equal(by["Local"]?.source, "live");
  assert.equal(by["Local"]?.role, "Dev host");
  assert.equal(by["Alpha"]?.role, null, "unknown roles stay null, not invented");
  assert.deepEqual(contacted.sort(), ["Alpha", "Local"]);
  await app.close();
});

test("GET /api/fleet never triggers a collection", async () => {
  const { s, contacted } = service();
  const { app, inject } = await signedInServer({ config, fleetService: s, startChecks: false, logger: false });
  await inject({ method: "GET", url: "/api/fleet" });
  await inject({ method: "GET", url: "/api/fleet" });
  assert.equal(contacted.length, 0);
  await app.close();
});

test("response never exposes key paths or other configuration secrets", async () => {
  const { s } = service();
  const { app, inject } = await signedInServer({ config, fleetService: s, startChecks: false, logger: false });
  await s.refreshAll();
  const text = (await inject({ method: "GET", url: "/api/fleet" })).body;
  for (const needle of ["id_ed25519", ".ssh", "identityFile", "known_hosts"]) {
    assert.equal(text.includes(needle), false, `response must not contain ${needle}`);
  }
  await app.close();
});

test("fixture mode labels every server source 'fixture', tags reasons, and contacts nothing", async () => {
  const { s, contacted } = service();
  const { app, inject } = await signedInServer({ config, fleetService: s, mode: "fixture", startChecks: true, logger: false });
  const body = FleetResponseSchema.parse((await inject({ method: "GET", url: "/api/fleet" })).json());
  assert.equal(body.mode, "fixture");
  assert.ok(body.servers.every((x) => x.source === "fixture"));
  assert.ok(body.servers.every((x) => x.statusReason.startsWith("[FIXTURE DATA]")));
  assert.equal(contacted.length, 0);
  await app.close();
});

test("stopping the server stops the refresh timer", async () => {
  const { s } = service();
  const { app, inject } = await signedInServer({ config, fleetService: s, startChecks: true, logger: false });
  await app.close();
  assert.equal(s.snapshot().nextCheckAt, null);
});
