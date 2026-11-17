/**
 * ZT-01 static check: the shipped host configuration must not enable writes on
 * any real host. Runs today, needs no care-loop code, never contacts a server.
 * Source: ADR-014 (writesEnabled=false until disposable-server gates pass and the
 * founder authorizes specific live work), execution-security invariants 11-12.
 *
 * Override the file with CARELOOP_HOSTS_JSON to check another checkout.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const path = process.env["CARELOOP_HOSTS_JSON"] ?? new URL("../../../apps/api/config/hosts.json", import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(path, "utf8")) as { hosts: Record<string, unknown>[] };

test(`CL-08h: no host in ${path.split("/").slice(-4).join("/")} has writesEnabled true`, () => {
  assert.ok(cfg.hosts.length > 0, "no hosts found: wrong file?");
  const enabled = cfg.hosts.filter((h) => h["writesEnabled"] === true).map((h) => String(h["name"]));
  assert.deepEqual(enabled, [], `writes are enabled for real hosts: ${enabled.join(", ")}`);
});

test("CL-08h: any writesEnabled that is present is a boolean false (no strings, numbers or nulls that could be coerced)", () => {
  for (const h of cfg.hosts) {
    if (!("writesEnabled" in h)) continue;
    assert.strictEqual(h["writesEnabled"], false, `${String(h["name"])}: writesEnabled must be exactly false, found ${JSON.stringify(h["writesEnabled"])}`);
  }
});

test("CL-08h: the real hosts the founder named are all present, so this check covers them", () => {
  const names = cfg.hosts.map((h) => String(h["name"]));
  for (const n of ["Sentani", "Nabire", "Timika"]) assert.ok(names.includes(n), `${n} missing from hosts.json`);
});
