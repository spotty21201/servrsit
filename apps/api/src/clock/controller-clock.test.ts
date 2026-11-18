/**
 * T-063: ServrSit checks its own clock. Pure logic plus the monitor with a fake probe:
 * no process is started and no network is used.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributeToController,
  ControllerClockMonitor,
  controllerClockFindings,
  evaluateControllerClock,
  NOT_CHECKED_CLOCK,
  type ClockProbe,
} from "./controller-clock.js";

const AT = new Date("2026-11-18T03:34:00.000Z");
const SEVEN_H = 7 * 3600 * 1000;
/** A source whose Date header is `remoteMs`, answering in 200 ms. */
const reading = (localSentMs: number, remoteMs: number) => ({ sentMs: localSentMs, receivedMs: localSentMs + 200, remoteMs });

test("T-063: Merauke's case: time sync off and both sources 7 h behind the local clock -> untrusted, about 7 h fast", () => {
  const local = AT.getTime();
  const c = evaluateControllerClock({
    checkedAt: AT,
    ntpSynchronized: false,
    sources: [
      { name: "google.com", reading: reading(local, local - SEVEN_H) },
      { name: "cloudflare.com", reading: reading(local, local - SEVEN_H + 1000) },
    ],
  });
  assert.equal(c.status, "untrusted");
  assert.equal(c.basis, "https-date");
  assert.ok(Math.abs((c.offsetSeconds ?? 0) - 25200) <= 1, String(c.offsetSeconds));
  assert.equal(c.reason, "ServrSit's own clock is about 7 h fast and time synchronisation is not working.");
  const [f] = controllerClockFindings(c);
  assert.equal(f?.rule, "control.clock.v1");
  assert.equal(f?.severity, "critical");
  assert.match(f?.summary ?? "", /plan approval is blocked until the clock is fixed\. ServrSit does not change the system clock\./);
});

test("T-063: synchronised and within 2 minutes is trusted; no finding", () => {
  const local = AT.getTime();
  const c = evaluateControllerClock({ checkedAt: AT, ntpSynchronized: true, sources: [{ name: "a", reading: reading(local, local + 900) }, { name: "b", reading: reading(local, local) }] });
  assert.equal(c.status, "trusted");
  assert.deepEqual(controllerClockFindings(c), []);
});

test("T-063: untrusted when not synchronised (even if close), when sources disagree, or when nothing can verify it", () => {
  const local = AT.getTime();
  assert.equal(evaluateControllerClock({ checkedAt: AT, ntpSynchronized: false, sources: [{ name: "a", reading: reading(local, local) }] }).status, "untrusted");
  const disagree = evaluateControllerClock({ checkedAt: AT, ntpSynchronized: true, sources: [{ name: "a", reading: reading(local, local) }, { name: "b", reading: reading(local, local - 600_000) }] });
  assert.deepEqual([disagree.status, disagree.offsetSeconds, disagree.basis], ["untrusted", null, "none"]);
  const blind = evaluateControllerClock({ checkedAt: AT, ntpSynchronized: null, sources: [{ name: "a", reading: null }, { name: "b", reading: null }] });
  assert.deepEqual([blind.status, blind.offsetSeconds], ["untrusted", null]);
  assert.match(blind.reason, /could not verify/);
  // NTP synchronised with no internet source reachable is still trusted.
  assert.equal(evaluateControllerClock({ checkedAt: AT, ntpSynchronized: true, sources: [{ name: "a", reading: null }] }).status, "trusted");
});

test("T-063: with no internet offset, servers that agree with each other put the skew on ServrSit", () => {
  const blind = evaluateControllerClock({ checkedAt: AT, ntpSynchronized: false, sources: [] });
  const three = [{ skewSeconds: -25202, uncertaintySeconds: 4 }, { skewSeconds: -25199, uncertaintySeconds: 2 }, { skewSeconds: -25210, uncertaintySeconds: 3 }];
  const c = attributeToController(blind, three);
  assert.deepEqual([c.status, c.basis, c.offsetSeconds], ["untrusted", "target-agreement", 25202]);
  assert.match(c.reason, /about 7 h fast: 3 of 3 servers agree with each other/);
  // One odd server out of three does not move the blame to ServrSit.
  const oneOff = attributeToController(blind, [{ skewSeconds: -25200, uncertaintySeconds: 2 }, { skewSeconds: 1, uncertaintySeconds: 2 }, { skewSeconds: 0, uncertaintySeconds: 2 }]);
  assert.deepEqual([oneOff.basis, oneOff.offsetSeconds], ["none", null]);
  // An offset from the internet is never overridden, and "not checked" stays not checked.
  assert.equal(attributeToController(NOT_CHECKED_CLOCK, three), NOT_CHECKED_CLOCK);
});

test("T-063: the monitor is untrusted until its first check, then reflects the probe; it never changes the clock", async () => {
  const calls: string[] = [];
  const local = AT.getTime();
  const probe: ClockProbe = {
    ntpSynchronized: async () => { calls.push("ntp"); return false; },
    httpsDate: async (url) => { calls.push(url); return reading(local, local - SEVEN_H); },
  };
  const m = new ControllerClockMonitor({ probe, intervalMs: 60_000, now: () => AT });
  assert.equal(m.current().status, "untrusted");
  assert.match(m.current().reason, /has not checked its own clock yet/);
  await m.check();
  assert.equal(m.current().status, "untrusted");
  assert.ok(Math.abs((m.current().offsetSeconds ?? 0) - 25200) <= 1);
  assert.deepEqual(calls.sort(), ["https://www.cloudflare.com/", "https://www.google.com/", "ntp"]);
  await m.stop();
});

test("T-063: the probe's source can only read the clock: one fixed timedatectl query, no set-time, no sudo", async () => {
  const { readFileSync } = await import("node:fs");
  // Code only: comments may say what the code must never do.
  const src = readFileSync(new URL("./controller-clock.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(src.includes('["show", "--property=NTPSynchronized", "--value"]'));
  for (const forbidden of [/set-time/, /set-ntp/, /\bsudo\b/, /hwclock/, /date -s/, /settimeofday/, /shell: true/]) {
    assert.equal(forbidden.test(src), false, `forbidden: ${forbidden}`);
  }
  assert.equal((src.match(/execFile\(/g) ?? []).length, 1, "exactly one process call");
});
