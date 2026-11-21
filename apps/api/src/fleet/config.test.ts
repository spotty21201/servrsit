import { test } from "node:test";
import assert from "node:assert/strict";
import { FleetConfigSchema, loadFleetConfig } from "./config.js";

const host = { id: "11111111-1111-4111-a111-111111111111", name: "One", access: "local", role: null, production: true, collect: true };

test("DEF-L1: the shipped config sets the owner's time zone to Asia/Jakarta", async () => {
  assert.equal((await loadFleetConfig()).ownerTimeZone, "Asia/Jakarta");
});

test("ownerTimeZone defaults to Asia/Jakarta when the config omits it", () => {
  assert.equal(FleetConfigSchema.parse({ healthIntervalMinutes: 15, hosts: [host] }).ownerTimeZone, "Asia/Jakarta");
});

test("an invalid time zone is rejected at load, not discovered in an answer", () => {
  for (const tz of ["Not/AZone", "", "Asia/Jakarta; rm -rf /"]) {
    assert.throws(() => FleetConfigSchema.parse({ healthIntervalMinutes: 15, ownerTimeZone: tz, hosts: [host] }), tz);
  }
  assert.equal(FleetConfigSchema.parse({ healthIntervalMinutes: 15, ownerTimeZone: "Asia/Jayapura", hosts: [host] }).ownerTimeZone, "Asia/Jayapura");
});

// ---- T-047: per-host identities ----------------------------------------------

test("T-047: Sentani and Timika use their dedicated keys; Timika and Sentani are enabled; Nabire is unchanged", async () => {
  const hosts = Object.fromEntries((await loadFleetConfig()).hosts.map((h) => [h.name, h]));
  for (const name of ["Sentani", "Timika"]) {
    const h = hosts[name]!;
    assert.equal(h.access, "ssh");
    if (h.access !== "ssh") continue;
    assert.equal(h.identityFile, `~/.ssh/servrsit/id_ed25519_${name.toLowerCase()}`, name);
    assert.equal(h.writesEnabled, false, `${name}: read-only collection only`);
  }
  // Timika: key installed by the owner and login verified by Orchestrator.
  assert.equal(hosts["Timika"]!.collect, true);
  assert.equal(hosts["Timika"]!.collectDisabledReason, undefined);
  // Sentani: key installed by the owner; login verified by Orchestrator.
  assert.equal(hosts["Sentani"]!.collect, true);
  assert.equal(hosts["Sentani"]!.collectDisabledReason, undefined);
  const nabire = hosts["Nabire"]!;
  assert.equal(nabire.access === "ssh" && nabire.identityFile, "~/.ssh/id_ed25519_nabire");
  assert.equal(nabire.collect, true);
});

test("T-047: each identity reaches ssh only as '-i <path>' with IdentitiesOnly=yes", async () => {
  const { buildSshArgv } = await import("@servrsit/ssh");
  for (const h of (await loadFleetConfig()).hosts) {
    if (h.access !== "ssh" || h.identityFile === undefined) continue;
    const argv = buildSshArgv({ host: h.address, port: h.port, user: h.user, identityFile: h.identityFile }, { knownHostsFile: "/x/known_hosts" });
    const i = argv.indexOf("-i");
    assert.ok(i > 0, h.name);
    assert.ok(argv[i + 1]!.endsWith(h.identityFile.slice(1)), `${h.name}: -i is the expanded path`);
    assert.ok(argv.includes("IdentitiesOnly=yes"), h.name);
    assert.ok(argv.includes("IdentityAgent=none"), h.name);
  }
});

// ---- T-050: founder roles (ADR-015) and important services ---------------------

test("T-050: roles and production flags are the founder's (ADR-015)", async () => {
  const hosts = Object.fromEntries((await loadFleetConfig()).hosts.map((h) => [h.name, h]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(hosts).map(([n, h]) => [n, [h.role, h.production]])),
    {
      Timika: ["Client-facing VPS (Europe)", true],
      Nabire: ["Development server", false],
      // ADR-021: Sentani is now the disposable test server.
      Sentani: ["Disposable test server", false],
      Merauke: ["Development server (dev host)", false],
    },
  );
  for (const h of Object.values(hosts)) assert.deepEqual(h.importantServices, [], `${h.name}: none selected yet`);
});

test("T-050: important services are plain unit names; a bare name means .service", () => {
  const base = { id: "11111111-1111-4111-a111-111111111111", name: "One", access: "local", role: null, production: true, collect: true };
  const ok = FleetConfigSchema.parse({ healthIntervalMinutes: 15, hosts: [{ ...base, importantServices: ["nginx", "postgresql.service", "backup.timer"] }] });
  assert.deepEqual(ok.hosts[0]!.importantServices, ["nginx.service", "postgresql.service", "backup.timer"]);
  for (const bad of ["nginx; rm -rf /", "a b", "$(reboot)", "x".repeat(250)]) {
    assert.throws(() => FleetConfigSchema.parse({ healthIntervalMinutes: 15, hosts: [{ ...base, importantServices: [bad] }] }), bad);
  }
});
