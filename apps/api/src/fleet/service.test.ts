import { test } from "node:test";
import assert from "node:assert/strict";
import type { CollectionResult } from "@servrsit/ssh";
import { FleetConfigSchema, type HostConfig } from "./config.js";
import { FleetService, type Collector, type PinChecker } from "./service.js";
import { makeObservation } from "./observation.fixtures.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIN = 60_000;
const config = FleetConfigSchema.parse({
  healthIntervalMinutes: 15,
  hosts: [
    { id: "11111111-1111-4111-a111-111111111111", name: "Alpha", access: "ssh", address: "alpha", port: 22, user: "spotty", role: null, production: true, collect: true },
    { id: "22222222-2222-4222-a222-222222222222", name: "Beta", access: "ssh", address: "beta", port: 22, user: "spotty", role: null, production: true, collect: false, collectDisabledReason: "No key." },
    { id: "33333333-3333-4333-a333-333333333333", name: "Local", access: "local", role: "Dev host", production: false, collect: true },
  ],
});

class Clock {
  constructor(public t = new Date("2026-11-17T08:00:00.000Z")) {}
  now = () => new Date(this.t);
  advance(ms: number) { this.t = new Date(this.t.getTime() + ms); }
}

const success = (at: Date, o = {}): CollectionResult => ({
  ok: true, observation: makeObservation({ collectedAt: at.toISOString(), ...o }),
});
const fail = (code: "ROUTE_UNAVAILABLE" | "AUTH_FAILED" | "HOST_KEY_CHANGED", at: Date, contacted = true): CollectionResult => ({
  ok: false, failure: { code, message: `fixed ${code}` }, attemptedAt: at.toISOString(), contacted,
});

function setup(script: (host: HostConfig, call: number) => CollectionResult, pins: Record<string, "pinned" | "not-pinned"> = { alpha: "pinned", beta: "pinned" }) {
  const clock = new Clock();
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const collector: Collector = async (host) => {
    calls.push(host.name);
    const n = (counts.get(host.name) ?? 0) + 1;
    counts.set(host.name, n);
    return script(host, n);
  };
  const pinChecker: PinChecker = async (host) => (host.access === "ssh" ? pins[host.address] ?? "not-pinned" : "pinned");
  const service = new FleetService({ config, knownHostsFile: "/x/known_hosts", collector, pinChecker, now: clock.now });
  const server = (name: string) => service.snapshot().servers.find((s) => s.name === name)!;
  return { clock, calls, service, server };
}

test("an unpinned ssh host is never passed to the collector and reports 'unverified-host'", async () => {
  const { service, calls, server } = setup((_h, _n) => success(new Date()), { alpha: "not-pinned" });
  await service.refreshAll();
  assert.equal(calls.includes("Alpha"), false);
  assert.equal(server("Alpha").status, "unverified-host");
  assert.equal(server("Alpha").observedAt, null);
  assert.equal(server("Alpha").latestAttempt, null);
});

test("before the first pass finishes, status is 'not-yet-checked', not 'unverified-host'", () => {
  const { server } = setup(() => success(new Date()));
  assert.equal(server("Alpha").status, "not-yet-checked");
});

test("a disabled host is not collected and says why", async () => {
  const { service, calls, server } = setup((_h) => success(new Date()));
  await service.refreshAll();
  assert.equal(calls.includes("Beta"), false);
  assert.deepEqual([server("Beta").status, server("Beta").statusReason], ["collection-disabled", "No key."]);
});

test("successful check: fresh, observedAt set, freshUntil is two intervals later, source live", async () => {
  const { service, clock, server } = setup((_h) => success(new Date("2026-11-17T08:00:00.000Z")));
  await service.refreshAll();
  const s = server("Alpha");
  assert.equal(s.status, "fresh");
  assert.equal(s.source, "live");
  assert.equal(s.observedAt, "2026-11-17T08:00:00.000Z");
  assert.equal(s.freshUntil, "2026-11-17T08:30:00.000Z");
  assert.equal(s.coverage?.passed, s.coverage?.total);
  assert.equal(clock.now().toISOString(), "2026-11-17T08:00:00.000Z");
});

test("data expires after two intervals: status becomes stale without a new attempt", async () => {
  const { service, clock, server } = setup((_h) => success(new Date("2026-11-17T08:00:00.000Z")));
  await service.refreshAll();
  clock.advance(31 * MIN);
  assert.equal(server("Alpha").status, "stale");
});

test("a failed latest check is shown alongside the last success", async () => {
  const { service, clock, server } = setup((_h, n) =>
    n === 1 ? success(new Date("2026-11-17T08:00:00.000Z"), { diskPercent: 42 }) : fail("ROUTE_UNAVAILABLE", clock.now()));
  await service.refreshAll();
  clock.advance(15 * MIN);
  await service.refreshAll();
  const s = server("Alpha");
  assert.equal(s.status, "unreachable");
  assert.equal(s.latestAttempt?.succeeded, false);
  assert.equal(s.latestAttempt?.failure?.code, "ROUTE_UNAVAILABLE");
  assert.equal(s.observedAt, "2026-11-17T08:00:00.000Z", "last success is kept, labelled by its own time");
  assert.notEqual(s.observation, null);
});

test("two consecutive route failures create an 'unreachable' finding", async () => {
  const { service, clock, server } = setup((_h) => fail("ROUTE_UNAVAILABLE", clock.now()));
  await service.refreshAll();
  assert.equal(server("Alpha").findings.length, 0);
  await service.refreshAll();
  assert.equal(server("Alpha").findings[0]?.id, "unreachable");
});

test("rejected credentials are not retried automatically", async () => {
  const { service, calls, server } = setup((_h) => fail("AUTH_FAILED", new Date()));
  await service.refreshAll();
  await service.refreshAll();
  assert.equal(calls.filter((c) => c === "Alpha").length, 1);
  assert.equal(server("Alpha").status, "access-denied");
});

test("a changed host key blocks the host until restart", async () => {
  const { service, calls, server } = setup((_h) => fail("HOST_KEY_CHANGED", new Date()));
  await service.refreshAll();
  await service.refreshAll();
  assert.equal(calls.filter((c) => c === "Alpha").length, 1);
  assert.equal(server("Alpha").status, "host-key-changed");
  assert.equal(server("Alpha").findings[0]?.id, "host-key-changed", "O2: raised as a finding, and it persists");
  assert.equal(server("Alpha").findings[0]?.severity, "critical");
});

test("a recovered host clears its failure count", async () => {
  const { service, clock, server } = setup((_h, n) =>
    n === 1 ? fail("ROUTE_UNAVAILABLE", clock.now()) : success(clock.now()));
  await service.refreshAll();
  clock.advance(MIN);
  await service.refreshAll();
  assert.equal(server("Alpha").status, "fresh");
  assert.equal(server("Alpha").latestAttempt?.consecutiveFailures, 0);
});

test("two successive observations feed the disk rule: warning only after confirmation", async () => {
  const { service, clock, server } = setup((_h, n) => success(clock.now(), { diskPercent: n === 1 ? 90 : 91 }));
  await service.refreshAll();
  assert.equal(server("Alpha").findings.find((f) => f.id === "disk:/")?.severity, "advisory");
  clock.advance(15 * MIN);
  await service.refreshAll();
  assert.equal(server("Alpha").findings.find((f) => f.id === "disk:/")?.severity, "warning");
});

test("the local host is collected without a pin check and never goes through ssh", async () => {
  const { service, server } = setup((_h) => success(new Date("2026-11-17T08:00:00.000Z")));
  await service.refreshAll();
  assert.equal(server("Local").access, "local");
  assert.equal(server("Local").role, "Dev host");
  assert.equal(server("Local").status, "fresh");
});

test("overlapping refreshes coalesce into one pass", async () => {
  const { service, calls } = setup((_h) => success(new Date()));
  await Promise.all([service.refreshAll(), service.refreshAll(), service.refreshAll()]);
  assert.equal(calls.filter((c) => c === "Alpha").length, 1);
});

test("O1: source is 'none' for every card without an observation, and 'live' only with one", async () => {
  const { service, clock, server } = setup((_h, n) => (n === 1 ? success(clock.now()) : fail("ROUTE_UNAVAILABLE", clock.now())), { alpha: "pinned", beta: "pinned" });
  assert.equal(server("Alpha").source, "none", "before any check");
  assert.equal(server("Local").source, "none", "before any check");
  await service.refreshAll();
  assert.equal(server("Alpha").source, "live");
  assert.equal(server("Beta").source, "none", "collection-disabled has no data");
  clock.advance(15 * MIN);
  await service.refreshAll();
  assert.equal(server("Alpha").status, "unreachable");
  assert.equal(server("Alpha").source, "live", "the last success is real data, shown as historical by its status");
});

test("O1: an unverified host is 'none'", async () => {
  const { service, server } = setup(() => success(new Date()), { alpha: "not-pinned" });
  await service.refreshAll();
  assert.deepEqual([server("Alpha").status, server("Alpha").source], ["unverified-host", "none"]);
});

// ---- T-063: the fleet view puts the clock skew on the right machine -------------------

test("T-063: three servers agree they are 7 h behind ServrSit, and ServrSit has no internet time: ServrSit is blamed, not them", async () => {
  const three = FleetConfigSchema.parse({
    healthIntervalMinutes: 15,
    hosts: ["Timika", "Nabire", "Sentani"].map((name, i) => ({
      id: `${i + 1}${i + 1}${i + 1}${i + 1}${i + 1}${i + 1}${i + 1}${i + 1}-1111-4111-a111-111111111111`, name, access: "ssh", address: name.toLowerCase(), port: 22, user: "spotty", role: null, production: false, collect: true,
    })),
  });
  const blind = {
    status: "untrusted" as const, checkedAt: "2026-11-18T03:34:00.000Z", ntpSynchronized: false, offsetSeconds: null,
    uncertaintySeconds: null, basis: "none" as const, sources: [], reason: "ServrSit's own clock is not synchronised with a time server.",
  };
  const service = new FleetService({
    config: three, knownHostsFile: "/x/known_hosts", pinChecker: async () => "pinned",
    collector: async () => ({ ok: true, observation: makeObservation({ clockSkewSeconds: -25202 }) }),
    controllerClock: () => blind,
  });
  await service.refreshAll();
  const snap = service.snapshot();
  assert.deepEqual([snap.controlPlane.clock.basis, snap.controlPlane.clock.offsetSeconds], ["target-agreement", 25202]);
  assert.deepEqual(snap.controlPlane.findings.map((f) => f.rule), ["control.clock.v1"]);
  for (const s of snap.servers) assert.equal(s.findings.some((f) => f.id === "clock-skew"), false, `${s.name} is not blamed`);
});

test("T-063: without a controller clock source the control plane says not checked, with no finding", () => {
  const { service } = setup(() => success(new Date()));
  assert.deepEqual([service.snapshot().controlPlane.clock.status, service.snapshot().controlPlane.findings], ["not-checked", []]);
});

test("T-069: the host list is read on every pass; a removed server is no longer checked or shown, and refreshHost checks only one", async () => {
  const clock = new Clock();
  const calls: string[] = [];
  let hosts = [...config.hosts];
  const svc = new FleetService({
    config,
    hosts: () => hosts,
    knownHostsFile: "/x/known_hosts",
    collector: async (h) => { calls.push(h.name); return success(clock.now()); },
    pinChecker: async () => "pinned",
    now: clock.now,
  });
  await svc.refreshAll();
  assert.deepEqual(calls, ["Alpha", "Local"]);
  hosts = hosts.filter((h) => h.name !== "Alpha");
  assert.deepEqual(svc.snapshot().servers.map((s) => s.name), ["Beta", "Local"]);
  calls.length = 0;
  await svc.refreshAll();
  assert.deepEqual(calls, ["Local"]);
  calls.length = 0;
  await svc.refreshHost("33333333-3333-4333-a333-333333333333");
  await svc.refreshHost("11111111-1111-4111-a111-111111111111");
  assert.deepEqual(calls, ["Local"], "only the named, still-listed server is checked");
});

test("T-069: a registered server's own known_hosts file is used for its pin check and its collection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "servrsit-kh-"));
  const own = join(dir, "known_hosts");
  writeFileSync(own, "alpha ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture\n");
  const seen: string[] = [];
  const svc = new FleetService({
    config,
    hosts: () => [{ ...config.hosts[0]!, knownHostsFile: own }],
    knownHostsFile: join(dir, "missing_shared_known_hosts"),
    collector: async (h) => { seen.push(h.knownHostsFile ?? "shared"); return success(new Date()); },
  });
  await svc.refreshAll();
  assert.deepEqual(seen, [own], "pinned through its own file, then collected with it");
});
