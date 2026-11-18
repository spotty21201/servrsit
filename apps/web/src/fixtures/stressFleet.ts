/**
 * [FIXTURE DATA] Stress fixtures for the Overview and server pages (T-075):
 * 0, 1, 3, 6 and 20 servers; very long names, roles and package names. Every
 * server is synthetic and labelled "Fixture". Used by /fixtures/overview and
 * by the audit scripts; nothing here describes a real machine.
 */
import type { FleetResponse, FleetServer, InspectionObservation } from "@servrsit/contracts";
import { fixtureFleet, fixtureServer } from "../api/fleet.fixtures";

const LONG_NAME = "Fixture-production-application-server-eu-central-1-blue-green-deployment-0";
const LONG_ROLE = "Client-facing application and reverse-proxy server for the European customer portal (primary)";
const LONG_PKG = "libreoffice-l10n-extra-supplementary-dictionary-bundle-with-a-very-long-package-name";
const LONG_VERSION = "4:24.2.7-0ubuntu0.24.04.2+security.long.version.string~rc1+really.long.build.metadata.0123456789";

const STATUSES: ReadonlyArray<FleetServer["status"]> = ["fresh", "fresh", "partial", "stale", "unreachable", "fresh", "not-yet-checked", "unverified-host", "fresh", "access-denied"];

const ok = <T,>(value: T) => ({ status: "ok" as const, value });

export function stressObservation(long: boolean, collectedAt: string): InspectionObservation {
  return {
    schemaVersion: 1, collectedAt, source: "ssh", durationMs: 900, truncated: false, truncatedSections: [],
    host: {
      collector: "inspect.host.v1", hostname: ok("fixture-host"), os: ok({ id: "ubuntu", prettyName: "Ubuntu 24.04.1 LTS", versionId: "24.04" }), architecture: ok("x86_64"),
      bootId: ok("d7c54a08-c253-4dc9-9791-f8015b9cdac0"), uptimeSeconds: ok(1_234_567), load: ok({ one: 3.2, five: 2.1, fifteen: 1.4 }), cpuCount: ok(4),
      memory: ok({ totalKib: 8_131_772, availableKib: 1_085_188, swapTotalKib: 2_097_152, swapFreeKib: 1_900_000 }),
      filesystems: ok({ entries: [
        { filesystem: "/dev/mapper/vg0-root", mount: "/", sizeKib: 100_476_656, usedKib: 90_205_616, availKib: 10_254_656, usedPercent: 90 },
        { filesystem: "/dev/sdb1", mount: long ? "/srv/very/long/mount/point/for/application/data/volume/number/one/with/more/segments" : "/srv", sizeKib: 2_000_000_000, usedKib: 400_000_000, availKib: 1_600_000_000, usedPercent: 20 },
      ], skippedLineCount: 0 }),
      inodes: ok({ entries: [{ filesystem: "/dev/mapper/vg0-root", mount: "/", inodes: 6_400_000, inodesUsed: 6_000_000, inodesFree: 400_000, usedPercent: 94 }], skippedLineCount: 0 }),
      clock: ok({ targetEpochSeconds: 1_794_950_016, skewSeconds: 3, uncertaintySeconds: 2 }),
    },
    services: { collector: "inspect.services.v1", failedUnits: ok({ units: [], unparsedLineCount: 0 }) },
    packages: {
      collector: "inspect.packages.v1", pendingCount: ok(long ? 48 : 3), heldBackCount: ok(0),
      pendingOutsideUbuntu: ok({ count: long ? 2 : 0, packages: long ? [{ name: LONG_PKG, origin: "Some Very Long Third-Party Repository Name:noble-updates-extra" }, { name: "docker-ce", origin: "Docker CE:noble" }] : [] }),
      metadataUpdatedAt: ok(collectedAt), metadataClock: "in-sync", rebootRequired: ok(false),
    },
  };
}

export function stressServers(count: number, long: boolean, now: Date): FleetServer[] {
  return Array.from({ length: count }, (_, i): FleetServer => {
    const status = STATUSES[i % STATUSES.length] ?? "fresh";
    const hasData = status === "fresh" || status === "partial" || status === "stale";
    const ago = (min: number): string => new Date(now.getTime() - min * 60_000).toISOString();
    const n = i + 1;
    return fixtureServer({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      name: long && i % 3 === 0 ? `${LONG_NAME}${n}` : `Fixture ${String(n).padStart(2, "0")}`,
      role: long && i % 2 === 0 ? LONG_ROLE : i % 4 === 0 ? null : "Web server",
      production: i % 5 === 0,
      status,
      source: hasData ? "fixture" : "none",
      statusReason: `[FIXTURE DATA] Synthetic ${status} server.`,
      observedAt: hasData ? ago(5 + i * 17) : null,
      freshUntil: hasData ? ago(5 + i * 17 - 30) : null,
      coverage: status === "partial" ? { passed: 13, total: 16, unavailable: [{ check: "memory", reason: "/proc/meminfo is not readable" }] } : hasData ? { passed: 16, total: 16, unavailable: [] } : null,
      latestAttempt: status === "unreachable" ? { at: ago(4), succeeded: false, failure: { code: "ROUTE_UNAVAILABLE", message: "The host could not be reached." }, consecutiveFailures: 3 } : null,
      findings: hasData && i % 2 === 0 ? [{ id: `disk:${n}`, rule: "disk.usage.v1", severity: i % 4 === 0 ? "critical" : "warning", summary: `Disk space on / is at ${90 + (i % 8)} %` }] : [],
      observation: hasData ? stressObservation(long, ago(5 + i * 17)) : null,
    });
  });
}

export function stressFleet(count: number, long: boolean, now: Date = new Date()): FleetResponse {
  return fixtureFleet({ servers: stressServers(count, long, now), nextCheckAt: new Date(now.getTime() + 8 * 60_000).toISOString() });
}

export const STRESS = { LONG_NAME, LONG_ROLE, LONG_PKG, LONG_VERSION } as const;
