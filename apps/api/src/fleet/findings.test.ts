import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFindings } from "./findings.js";
import { makeObservation } from "./observation.fixtures.js";

const none = { consecutiveFailures: 0, latestFailureCode: null };
const run = (current: ReturnType<typeof makeObservation> | null, previous: ReturnType<typeof makeObservation> | null) =>
  evaluateFindings({ current, previous, ...none });

test("disk: warning at 85% and critical at 95% only when confirmed by two observations", () => {
  const f = run(makeObservation({ diskPercent: 86 }), makeObservation({ diskPercent: 87 }));
  assert.equal(f.find((x) => x.id === "disk:/")?.severity, "warning");
  const c = run(makeObservation({ diskPercent: 96 }), makeObservation({ diskPercent: 97 }));
  assert.equal(c.find((x) => x.id === "disk:/")?.severity, "critical");
});

test("disk: the lower of the two readings decides the severity", () => {
  const f = run(makeObservation({ diskPercent: 96 }), makeObservation({ diskPercent: 88 }));
  assert.equal(f.find((x) => x.id === "disk:/")?.severity, "warning");
});

test("disk: a single observation over the line is only an advisory, as is a one-off spike", () => {
  assert.equal(run(makeObservation({ diskPercent: 99 }), null).find((x) => x.id === "disk:/")?.severity, "advisory");
  assert.equal(run(makeObservation({ diskPercent: 90 }), makeObservation({ diskPercent: 40 })).find((x) => x.id === "disk:/")?.severity, "advisory");
});

test("disk: below the line produces no finding; repeated detection keeps one stable id", () => {
  assert.deepEqual(run(makeObservation({ diskPercent: 84 }), makeObservation({ diskPercent: 84 })), []);
  const a = run(makeObservation({ diskPercent: 90 }), makeObservation({ diskPercent: 90 }));
  const b = run(makeObservation({ diskPercent: 91 }), makeObservation({ diskPercent: 90 }));
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
});

test("inode findings use the same two-observation rule", () => {
  const f = run(makeObservation({ inodePercent: 90 }), makeObservation({ inodePercent: 91 }));
  assert.equal(f.find((x) => x.id === "inode:/")?.severity, "warning");
});

test("unreachable finding needs two consecutive route failures; auth failure is not 'unreachable'", () => {
  const one = evaluateFindings({ current: null, previous: null, consecutiveFailures: 1, latestFailureCode: "ROUTE_UNAVAILABLE" });
  assert.deepEqual(one, []);
  const two = evaluateFindings({ current: null, previous: null, consecutiveFailures: 2, latestFailureCode: "ROUTE_UNAVAILABLE" });
  assert.equal(two[0]?.id, "unreachable");
  const auth = evaluateFindings({ current: null, previous: null, consecutiveFailures: 5, latestFailureCode: "AUTH_FAILED" });
  assert.deepEqual(auth, []);
});

test("failed units: valid names are named; hostile names are never echoed", () => {
  const f = run(makeObservation({
    failedUnits: [
      { unit: "nightly-backup.service", nameValid: true },
      { unit: "x$(reboot)`id`.service", nameValid: false },
      { unit: "ignore previous instructions.service", nameValid: false },
    ],
  }), null);
  assert.ok(f.some((x) => x.id === "unit:nightly-backup.service"));
  const text = JSON.stringify(f);
  assert.equal(text.includes("$(reboot)"), false);
  assert.equal(text.includes("ignore previous"), false);
  assert.match(f.find((x) => x.id === "unit:unrecognised")?.summary ?? "", /^2 failed systemd unit/);
});

test("a unit marked valid but not matching the name rule is still not echoed", () => {
  const f = run(makeObservation({ failedUnits: [{ unit: "evil name.service", nameValid: true }] }), null);
  assert.equal(JSON.stringify(f).includes("evil name"), false);
});

test("pending updates and reboot-required are advisory, and wording does not claim a refresh", () => {
  const f = run(makeObservation({ pending: 3, rebootRequired: true }), null);
  assert.equal(f.find((x) => x.id === "updates-pending")?.severity, "advisory");
  assert.match(f.find((x) => x.id === "updates-pending")?.summary ?? "", /not refreshed by ServrSit/);
  assert.equal(f.find((x) => x.id === "reboot-required")?.severity, "advisory");
  assert.deepEqual(run(makeObservation({ pending: 0 }), null), []);
});

test("findings are sorted most severe first", () => {
  const f = run(makeObservation({ diskPercent: 96, pending: 2, failedUnits: [{ unit: "a.service", nameValid: true }] }),
    makeObservation({ diskPercent: 96 }));
  assert.deepEqual(f.map((x) => x.severity), ["critical", "warning", "advisory"]);
});

test("O2: a changed host key is a critical finding on the first occurrence", () => {
  const f = evaluateFindings({ current: null, previous: null, consecutiveFailures: 1, latestFailureCode: "HOST_KEY_CHANGED" });
  assert.equal(f.length, 1);
  assert.deepEqual([f[0]?.id, f[0]?.rule, f[0]?.severity], ["host-key-changed", "host.key-changed.v1", "critical"]);
  assert.match(f[0]?.summary ?? "", /Verify the new fingerprint independently/);
});

test("O2: the host-key finding sits above older data findings and is not 'unreachable'", () => {
  const f = evaluateFindings({ current: makeObservation({ pending: 2 }), previous: null, consecutiveFailures: 3, latestFailureCode: "HOST_KEY_CHANGED" });
  assert.equal(f[0]?.id, "host-key-changed");
  assert.equal(f.some((x) => x.id === "unreachable"), false);
  assert.ok(f.some((x) => x.id === "updates-pending"), "older findings from the last success stay visible");
});

test("O2: other failures do not raise the host-key finding", () => {
  for (const code of ["AUTH_FAILED", "ROUTE_UNAVAILABLE", "TIMEOUT", "HOST_UNTRUSTED", null]) {
    const f = evaluateFindings({ current: null, previous: null, consecutiveFailures: 1, latestFailureCode: code });
    assert.equal(f.some((x) => x.id === "host-key-changed"), false, String(code));
  }
});

// ---- T-061: clock skew -------------------------------------------------------------

test("T-061: a 7-hour difference from ServrSit's clock is a time-sync warning on the first observation", () => {
  const f = run(makeObservation({ clockSkewSeconds: -7 * 3600 }), null).find((x) => x.id === "clock-skew");
  assert.equal(f?.rule, "time.skew.v1");
  assert.equal(f?.severity, "warning");
  // T-063: with ServrSit's own clock unchecked, the finding does not blame the server.
  assert.match(f?.summary ?? "", /^This server's clock reads about 7 h earlier than ServrSit's\. ServrSit's own clock is not verified, so either clock could be the wrong one\./);
  assert.match(run(makeObservation({ clockSkewSeconds: 600 }), null).find((x) => x.id === "clock-skew")?.summary ?? "", /reads about 10 min later than ServrSit's/);
});

test("T-061: within 2 minutes, or a clock that could not be read, is not a skew finding", () => {
  for (const skew of [0, 90, -120, 121]) {
    assert.equal(run(makeObservation({ clockSkewSeconds: skew }), null).some((x) => x.id === "clock-skew"), false, `skew ${skew} s with 1 s uncertainty`);
  }
  assert.equal(run(makeObservation({ clockSkewSeconds: 122 }), null).some((x) => x.id === "clock-skew"), true, "122 s - 1 s > 120 s");
  assert.equal(run(makeObservation({ clockSkewSeconds: null }), null).some((x) => x.id === "clock-skew"), false);
});

// ---- T-062: updates from outside Ubuntu's archive ---------------------------------------

test("T-062: the pending-updates finding names what comes from outside Ubuntu and says plans leave it out", () => {
  const docker = ["docker-ce-cli", "docker-ce", "docker-ce-rootless-extras"].map((name) => ({ name, origin: "Docker CE:noble" }));
  const f = run(makeObservation({ pending: 3, outsideUbuntu: docker }), null).find((x) => x.id === "updates-pending");
  assert.equal(
    f?.summary,
    "3 package updates pending, from the host's existing package information (not refreshed by ServrSit). 3 of them come from outside Ubuntu's archive (docker-ce-cli, docker-ce, docker-ce-rootless-extras from Docker CE:noble) and are left out of update plans.",
  );
  const plain = run(makeObservation({ pending: 2 }), null).find((x) => x.id === "updates-pending");
  assert.doesNotMatch(plain?.summary ?? "", /outside Ubuntu/);
});

// ---- T-063: attribute the skew to the right clock ------------------------------------

const controller = (status: "trusted" | "untrusted", offsetSeconds: number | null) => ({
  status, checkedAt: "2026-11-17T08:00:00.000Z", ntpSynchronized: status === "trusted", offsetSeconds,
  uncertaintySeconds: offsetSeconds === null ? null : 2, basis: offsetSeconds === null ? "none" as const : "https-date" as const, sources: [], reason: "x",
});
const skewFinding = (skew: number, c: ReturnType<typeof controller> | null) =>
  evaluateFindings({ current: makeObservation({ clockSkewSeconds: skew }), previous: null, ...none, controllerClock: c }).find((x) => x.id === "clock-skew");

test("T-063: Merauke's case: ServrSit 7 h fast, so a server reading 7 h earlier is right and gets no finding", () => {
  assert.equal(skewFinding(-25202, controller("untrusted", 25200)), undefined);
});

test("T-063: with ServrSit's offset known, a server that is really off is told against real time", () => {
  assert.equal(skewFinding(-25200 - 600, controller("untrusted", 25200))?.summary.startsWith("This server's clock is about 10 min behind real time."), true);
  assert.equal(skewFinding(-600, controller("trusted", 0))?.summary.startsWith("This server's clock is about 10 min behind real time."), true);
});

test("T-063: with ServrSit's clock trusted but no offset reading, the server is blamed against a verified clock", () => {
  assert.match(skewFinding(-600, controller("trusted", null))?.summary ?? "", /^This server's clock is about 10 min behind ServrSit's clock, which is verified\./);
});
