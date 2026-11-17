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

test("T-047: Sentani and Timika use their dedicated keys and stay disabled; Nabire is unchanged", async () => {
  const hosts = Object.fromEntries((await loadFleetConfig()).hosts.map((h) => [h.name, h]));
  for (const name of ["Sentani", "Timika"]) {
    const h = hosts[name]!;
    assert.equal(h.access, "ssh");
    if (h.access !== "ssh") continue;
    assert.equal(h.identityFile, `~/.ssh/servrsit/id_ed25519_${name.toLowerCase()}`, name);
    assert.equal(h.collect, false, `${name} must stay disabled until the owner installs the key`);
    assert.match(h.collectDisabledReason ?? "", /waiting for the owner to install it/);
  }
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
