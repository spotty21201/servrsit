import { test } from "node:test";
import assert from "node:assert/strict";
import type { FleetServer, InspectionObservation } from "@servrsit/contracts";
import { fixtureServer } from "../api/fleet.fixtures";
import { DASH, formatKib, formatUptime, toServerDetailVM } from "./serverDetailViewModel";

const NOW = new Date("2026-11-17T03:00:00Z"); // 10:00 WIB
const TZ = "Asia/Jakarta";
const ok = <T,>(value: T) => ({ status: "ok" as const, value });
const na = (reason: string) => ({ status: "unavailable" as const, reason });

/** [FIXTURE DATA] A synthetic observation. */
function obs(over: Partial<InspectionObservation["host"]> = {}, pk: Partial<InspectionObservation["packages"]> = {}): InspectionObservation {
  return {
    schemaVersion: 1, collectedAt: "2026-11-17T02:56:00Z", source: "ssh", durationMs: 800, truncated: false, truncatedSections: [],
    host: {
      collector: "inspect.host.v1", hostname: ok("fixture-host"), os: ok({ id: "ubuntu", prettyName: "Ubuntu 24.04.1 LTS", versionId: "24.04" }),
      architecture: ok("x86_64"), bootId: ok("d7c54a08-c253-4dc9-9791-f8015b9cdac0"), uptimeSeconds: ok(311771.11),
      load: ok({ one: 0.42, five: 0.31, fifteen: 0.28 }), cpuCount: ok(4),
      memory: ok({ totalKib: 8131772, availableKib: 7085188, swapTotalKib: 0, swapFreeKib: 0 }),
      filesystems: ok({ entries: [{ filesystem: "/dev/sda1", mount: "/", sizeKib: 100476656, usedKib: 8205616, availKib: 92254656, usedPercent: 9 }], skippedLineCount: 0 }),
      inodes: ok({ entries: [{ filesystem: "/dev/sda1", mount: "/", inodes: 6400000, inodesUsed: 190000, inodesFree: 6210000, usedPercent: 3 }], skippedLineCount: 0 }),
      clock: ok({ targetEpochSeconds: 1794950016, skewSeconds: -25200, uncertaintySeconds: 5 }),
      ...over,
    },
    services: { collector: "inspect.services.v1", failedUnits: ok({ units: [], unparsedLineCount: 0 }) },
    packages: {
      collector: "inspect.packages.v1", pendingCount: ok(5), heldBackCount: ok(0),
      pendingOutsideUbuntu: ok({ count: 2, packages: [{ name: "docker-ce", origin: "Docker CE:noble" }, { name: "containerd.io", origin: "Docker CE:noble" }] }),
      metadataUpdatedAt: ok("2026-11-17T01:00:00Z"), metadataClock: "in-sync", rebootRequired: ok(false), ...pk,
    },
  };
}

function server(over: Partial<FleetServer> = {}): FleetServer {
  return fixtureServer({ name: "Fixture Timika", role: "Client-facing VPS", production: true, source: "live", status: "fresh", observation: obs(), coverage: { passed: 16, total: 16, unavailable: [] }, importantServices: ["nginx"], ...over });
}

test("units and uptime", () => {
  assert.equal(formatKib(8131772), "7.8 GiB");
  assert.equal(formatKib(512), "512 KiB");
  assert.equal(formatKib(100476656), "96 GiB");
  assert.equal(formatUptime(311771.11), "3 days 14 h");
  assert.equal(formatUptime(300), "5 min");
});

test("status facts carry units, sample time and short boot id", () => {
  const vm = toServerDetailVM(server(), 0, NOW, TZ);
  assert.equal(vm.facts.memory.value, "1022 MiB used of 7.8 GiB (13 %), 6.8 GiB available");
  assert.equal(vm.facts.swap.value, "No swap configured");
  assert.equal(vm.facts.load.value, "0.42 · 0.31 · 0.28 (1, 5, 15 min) on 4 CPUs");
  assert.equal(vm.facts.platform.value, "Ubuntu 24.04.1 LTS");
  assert.equal(vm.facts.bootId.value, "d7c54a08");
  assert.equal(vm.sampleText, "Sampled 09:56 WIB (4 min ago)");
  assert.equal(vm.facts.mounts[0]?.space.value, "7.8 GiB used of 96 GiB (9 %), 88 GiB free");
  assert.equal(vm.facts.mounts[0]?.inodes.value, "3 % of 6,400,000 inodes used");
  assert.match(vm.facts.clock.value, /^Off: about 7 h behind ServrSit's clock/);
});

test("unavailable data is an em dash with the reason, never zero", () => {
  const vm = toServerDetailVM(server({ observation: obs({ memory: na("/proc/meminfo is not readable"), load: na("no load average") }, { rebootRequired: na("needs root"), pendingCount: na("apt is locked") }) }), 0, NOW, TZ);
  for (const s of [vm.facts.memory, vm.facts.swap, vm.facts.load, vm.care.reboot, vm.care.pending]) {
    assert.equal(s.value, DASH);
    assert.ok(s.why && s.why.length > 0);
  }
  assert.equal(vm.facts.memory.why, "/proc/meminfo is not readable");
  assert.equal(vm.care.ubuntu.value, DASH); // not derivable from an unknown total
});

test("no observation: every metric is an em dash with a reason; findings text does not claim health", () => {
  const vm = toServerDetailVM(server({ observation: null, coverage: null, source: "none", status: "not-yet-checked" }), 0, NOW, TZ);
  assert.equal(vm.hasObservation, false);
  assert.equal(vm.facts.memory.value, DASH);
  assert.equal(vm.facts.mounts.length, 0);
  assert.ok(vm.facts.mountsWhy);
  assert.match(vm.findingsEmpty, /^—/);
  assert.doesNotMatch(vm.findingsEmpty, /No findings from/);
  assert.equal(vm.care.pending.value, DASH);
  assert.equal(vm.sampleText, null);
});

test("findings come sorted by severity, and 'no findings' names how many checks ran", () => {
  const vm = toServerDetailVM(server({ findings: [
    { id: "a", rule: "r", severity: "advisory", summary: "Load is high" },
    { id: "b", rule: "r", severity: "critical", summary: "Disk full" },
    { id: "c", rule: "r", severity: "warning", summary: "Updates pending" },
  ] }), 0, NOW, TZ);
  assert.deepEqual(vm.findings.map((f) => f.severity), ["critical", "warning", "advisory"]);
  assert.equal(toServerDetailVM(server(), 0, NOW, TZ).findingsEmpty, "No findings from the 16 of 16 checks that ran.");
});

test("care: Ubuntu and third-party updates listed separately; Review updates reason is the writes-off sentence", () => {
  const vm = toServerDetailVM(server(), 0, NOW, TZ);
  assert.equal(vm.care.pending.value, "5");
  assert.equal(vm.care.ubuntu.value, "3");
  assert.equal(vm.care.outside.value, "2");
  assert.deepEqual(vm.care.outsideList.map((p) => p.name), ["docker-ce", "containerd.io"]);
  assert.equal(vm.care.packageInfoAge.value, "08:00 WIB (2 h ago)");
  assert.equal(vm.care.reboot.value, "No reboot flagged by the server");
  assert.equal(vm.care.reviewDisabledReason, "Changes are switched off for this server until testing on a disposable server is complete.");
});

test("package info age is marked when the server's clock was wrong or unreadable", () => {
  assert.match(toServerDetailVM(server({ observation: obs({}, { metadataClock: "corrected" }) }), 0, NOW, TZ).care.packageInfoCaveat ?? "", /Corrected/);
  assert.match(toServerDetailVM(server({ observation: obs({}, { metadataClock: "unverified" }) }), 0, NOW, TZ).care.packageInfoCaveat ?? "", /may be wrong/);
  assert.equal(toServerDetailVM(server(), 0, NOW, TZ).care.packageInfoCaveat, null);
});

test("ServrSit clock untrusted: ages carry ≈", () => {
  const vm = toServerDetailVM(server(), 0, NOW, TZ, true);
  assert.equal(vm.sampleText, "Sampled 09:56 WIB (≈ 4 min ago)");
});

test("settings: key and address are not invented; classification and important services shown", () => {
  const vm = toServerDetailVM(server(), 0, NOW, TZ);
  assert.equal(vm.settings.address.value, DASH);
  assert.equal(vm.settings.keyInUse.value, DASH);
  assert.doesNotMatch(JSON.stringify(vm.settings), /\.ssh|id_ed25519|\/home\//);
  assert.equal(vm.settings.classification, "Production");
  assert.equal(vm.settings.importantServices.value, "nginx");
  assert.equal(toServerDetailVM(server({ role: null }), 0, NOW, TZ).settings.role.value, DASH);
  assert.equal(vm.facts.importantServices[0]?.note, "No failure reported");
});

test("access is read-only and says so", () => {
  const vm = toServerDetailVM(server(), 0, NOW, TZ);
  assert.equal(vm.accessLabel, "Read-only · SSH");
  assert.match(vm.accessNote, /cannot change anything/);
});
