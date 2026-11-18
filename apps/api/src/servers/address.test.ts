import { test } from "node:test";
import assert from "node:assert/strict";
import { ADDRESS_REASONS, AddressPolicy, parseHost, type NetworkScope } from "./address.js";

const SCOPE: NetworkScope = {
  allowedPorts: [22, 2222],
  enrolledRoutes: ["100.64.0.0/10", "10.20.0.0/16"],
  allowPublicAddresses: true,
  operatorAddresses: ["100.70.0.9"],
  controllerAddress: "100.104.0.1",
};

const policy = (over: Partial<NetworkScope> = {}, resolve: Record<string, string[]> = {}) =>
  new AddressPolicy({ ...SCOPE, ...over }, {
    selfAddresses: () => ["127.0.0.1", "192.0.2.200"],
    resolver: async (h) => {
      const r = resolve[h];
      if (r === undefined) throw new Error("ENOTFOUND");
      return r;
    },
  });

test("only plain host names and IP literals are accepted", () => {
  for (const bad of [
    "ssh://host", "user@host", "host:22", "host/path", " host", "host ", "-oProxyCommand=x", "host;id", "$(id)", "`id`",
    "host|x", "a..b", "host.", "127.1", "0x7f000001", "[not-v6]", "", "a".repeat(254), "ho st", "'host'",
  ]) {
    assert.equal(parseHost(bad), null, bad);
  }
  assert.equal(parseHost("Web-1.Example.COM"), "web-1.example.com");
  assert.equal(parseHost("[2001:4860::1]"), "2001:4860::1");
  assert.equal(parseHost("203.0.113.5"), "203.0.113.5");
});

test("Tech Spec 6.2 blocked targets are refused with fixed reasons that never echo the input", async () => {
  const p = policy();
  const cases: Array<[string, string]> = [
    ["127.0.0.1", ADDRESS_REASONS.loopback],
    ["::1", ADDRESS_REASONS.loopback],
    ["localhost", ADDRESS_REASONS.loopback],
    ["169.254.169.254", ADDRESS_REASONS.metadata],
    ["fd00:ec2::254", ADDRESS_REASONS.metadata],
    ["169.254.10.1", ADDRESS_REASONS.reserved],
    ["fe80::1", ADDRESS_REASONS.reserved],
    ["224.0.0.1", ADDRESS_REASONS.reserved],
    ["0.0.0.0", ADDRESS_REASONS.reserved],
    ["::ffff:127.0.0.1", ADDRESS_REASONS.loopback],
    ["100.104.0.1", ADDRESS_REASONS.controller],
    ["192.0.2.200", ADDRESS_REASONS.controller],
    ["100.70.0.9", ADDRESS_REASONS.operator],
    ["192.168.1.10", ADDRESS_REASONS.privateOutsideRoute],
    ["10.30.0.1", ADDRESS_REASONS.privateOutsideRoute],
    ["fd12::1", ADDRESS_REASONS.privateOutsideRoute],
  ];
  for (const [address, reason] of cases) {
    const r = await p.check(address, 22);
    assert.deepEqual(r, { ok: false, reason }, address);
  }
});

test("private and CGNAT addresses pass only inside an enrolled route", async () => {
  const p = policy();
  assert.equal((await p.check("100.101.102.103", 22)).ok, true, "Tailscale range is enrolled");
  assert.equal((await p.check("10.20.5.5", 22)).ok, true);
  const none = policy({ enrolledRoutes: [] });
  assert.deepEqual(await none.check("100.101.102.103", 22), { ok: false, reason: ADDRESS_REASONS.privateOutsideRoute });
});

test("public addresses follow allowPublicAddresses; ports must be approved", async () => {
  assert.equal((await policy().check("203.0.113.5", 22)).ok, true);
  assert.deepEqual(await policy({ allowPublicAddresses: false }).check("203.0.113.5", 22), { ok: false, reason: ADDRESS_REASONS.publicNotAllowed });
  assert.deepEqual(await policy().check("203.0.113.5", 8022), { ok: false, reason: ADDRESS_REASONS.port });
  assert.equal((await policy().check("203.0.113.5", 2222)).ok, true);
});

test("a name is resolved and every result must pass; a later lookup can change the answer", async () => {
  const resolve: Record<string, string[]> = { "web.example": ["203.0.113.5"], "mixed.example": ["203.0.113.5", "127.0.0.1"], "meta.example": ["169.254.169.254"] };
  const p = policy({}, resolve);
  assert.deepEqual(await p.check("web.example", 22), { ok: true, host: "web.example", port: 22, addresses: ["203.0.113.5"] });
  assert.deepEqual(await p.check("mixed.example", 22), { ok: false, reason: ADDRESS_REASONS.resolvedBlocked });
  assert.deepEqual(await p.check("meta.example", 22), { ok: false, reason: ADDRESS_REASONS.resolvedBlocked });
  assert.deepEqual(await p.check("missing.example", 22), { ok: false, reason: ADDRESS_REASONS.unresolved });
  resolve["web.example"] = ["127.0.0.1"]; // rebinding
  assert.deepEqual(await p.check("web.example", 22), { ok: false, reason: ADDRESS_REASONS.resolvedBlocked });
});

test("a malformed enrolled route fails at start-up, not silently", () => {
  assert.throws(() => policy({ enrolledRoutes: ["100.64.0.0/40"] }), /invalid CIDR/);
  assert.throws(() => policy({ enrolledRoutes: ["tailnet"] }), /invalid CIDR/);
});
