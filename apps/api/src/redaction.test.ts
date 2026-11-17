import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server.js";
import { FleetConfigSchema } from "./fleet/config.js";
import { FleetService } from "./fleet/service.js";
import { makeObservation } from "./fleet/observation.fixtures.js";

/** An obviously fake credential. It is not, and never was, a real key. */
const FAKE_KEY = "sk-test-FAKE-0000-not-a-real-key-123456";
const UNKNOWN_TOKEN = "unknownTOKENvalue9876543210";

const config = FleetConfigSchema.parse({
  healthIntervalMinutes: 15,
  hosts: [
    { id: "11111111-1111-4111-a111-111111111111", name: "Alpha", access: "ssh", address: "alpha", port: 22, user: "spotty", identityFile: "~/.ssh/id_test", role: null, production: true, collect: true },
    { id: "33333333-3333-4333-a333-333333333333", name: "Local", access: "local", role: "Dev host", production: false, collect: true },
  ],
});

async function start(secrets: readonly string[] = [FAKE_KEY]) {
  const lines: string[] = [];
  const service = new FleetService({
    config, knownHostsFile: "/x/known_hosts",
    pinChecker: async () => "pinned",
    collector: async () => ({ ok: true, observation: makeObservation({ collectedAt: new Date().toISOString() }) }),
  });
  const app = await buildServer({
    config, fleetService: service, startChecks: false, redactSecrets: secrets,
    logStream: { write: (m: string) => { lines.push(m); } },
  });
  app.get("/boom", async () => { throw new Error(`upstream failed using key ${FAKE_KEY} at https://x.test/?k=${FAKE_KEY}`); });
  app.get("/leak", async () => ({ message: `the key is ${FAKE_KEY}`, nested: { also: [FAKE_KEY] } }));
  app.get("/bad-request", async () => { const e = new Error(`bad input ${FAKE_KEY}`) as Error & { statusCode: number }; e.statusCode = 400; throw e; });
  await service.refreshAll();
  return { app, lines, log: () => lines.join("") };
}

test("the key never appears in logs, errors or responses across normal and failing requests", async () => {
  const { app, log } = await start();
  const responses = [
    await app.inject({ method: "GET", url: "/health", headers: { authorization: `Bearer ${FAKE_KEY}`, cookie: "session=abc" } }),
    await app.inject({ method: "GET", url: `/health?token=${encodeURIComponent(FAKE_KEY)}&k=${FAKE_KEY}` }),
    await app.inject({ method: "GET", url: "/api/fleet", headers: { authorization: `Bearer ${FAKE_KEY}` } }),
    await app.inject({ method: "GET", url: `/does-not-exist?x=${FAKE_KEY}` }),
    await app.inject({ method: "GET", url: "/boom" }),
    await app.inject({ method: "GET", url: "/leak" }),
    await app.inject({ method: "GET", url: "/bad-request" }),
  ];
  app.log.info({ headers: { authorization: `Bearer ${FAKE_KEY}` }, url: `/x?k=${FAKE_KEY}`, apiKey: FAKE_KEY }, `deliberately logging ${FAKE_KEY}`);
  app.log.error({ err: new Error(`provider said no to ${FAKE_KEY}`) }, "deliberate error log");
  await app.close();

  for (const r of responses) {
    assert.equal(r.body.includes(FAKE_KEY), false, `response body for ${r.statusCode}`);
    assert.equal(JSON.stringify(r.headers).includes(FAKE_KEY), false, "response headers");
  }
  assert.equal(log().includes(FAKE_KEY), false, "log output");
  assert.equal(log().includes(encodeURIComponent(FAKE_KEY)), false, "log output (URL-encoded)");
  assert.ok(log().includes("[REDACTED]"), "the scrubber actually ran: redaction markers are present");
  assert.ok(log().includes("deliberately logging"), "log lines are kept, only secrets are removed");
});

test("5xx errors return a fixed message; 4xx messages are scrubbed", async () => {
  const { app } = await start();
  const boom = await app.inject({ method: "GET", url: "/boom" });
  assert.equal(boom.statusCode, 500);
  assert.deepEqual(boom.json(), { statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
  const bad = await app.inject({ method: "GET", url: "/bad-request" });
  assert.equal(bad.statusCode, 400);
  const body = bad.json() as { message: string };
  assert.match(body.message, /bad input \[REDACTED\]/);
  await app.close();
});

test("a response that would carry the key is scrubbed on the way out", async () => {
  const { app } = await start();
  const r = await app.inject({ method: "GET", url: "/leak" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.includes(FAKE_KEY), false);
  assert.deepEqual(r.json(), { message: "the key is [REDACTED]", nested: { also: ["[REDACTED]"] } });
  await app.close();
});

test("the Authorization header is censored in logs even when its value is unknown to us", async () => {
  const { app, log } = await start();
  await app.inject({ method: "GET", url: "/health", headers: { authorization: `Bearer ${UNKNOWN_TOKEN}` } });
  app.log.info({ req: { headers: { authorization: `Bearer ${UNKNOWN_TOKEN}`, cookie: "s=1" } } }, `header was Authorization: Bearer ${UNKNOWN_TOKEN}`);
  await app.close();
  assert.equal(log().includes(UNKNOWN_TOKEN), false);
});

test("the normal API contract is unchanged by redaction", async () => {
  const { app } = await start();
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal((health.json() as { status: string }).status, "ok");
  const fleet = await app.inject({ method: "GET", url: "/api/fleet" });
  assert.equal(fleet.statusCode, 200);
  assert.equal((fleet.json() as { mode: string }).mode, "live");
  const missing = await app.inject({ method: "GET", url: "/does-not-exist" });
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test("with no secrets configured the server still runs and still hides 5xx details", async () => {
  const { app } = await start([]);
  const boom = await app.inject({ method: "GET", url: "/boom" });
  assert.equal(boom.statusCode, 500);
  assert.equal((boom.json() as { message: string }).message, "Internal Server Error");
  await app.close();
});

test("the config response never mentions AI settings or credentials", async () => {
  const { app } = await start();
  const text = (await app.inject({ method: "GET", url: "/api/fleet" })).body;
  for (const needle of ["AI_API_KEY", "AI_BASE_URL", "Bearer", "id_test", ".env"]) {
    assert.equal(text.includes(needle), false, needle);
  }
  await app.close();
});
