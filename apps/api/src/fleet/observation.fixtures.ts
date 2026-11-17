/**
 * [FIXTURE DATA]
 *
 * Synthetic typed observations for API unit tests. Not real server data.
 */

import { ok, unavailable, type InspectionObservation } from "@servrsit/ssh";

export interface ObservationOptions {
  collectedAt?: string;
  diskPercent?: number;
  inodePercent?: number;
  failedUnits?: Array<{ unit: string; nameValid: boolean }>;
  pending?: number;
  rebootRequired?: boolean;
  unavailableChecks?: boolean;
  /** T-061: target clock minus ServrSit's, in seconds. null = the clock could not be read. Default 0. */
  clockSkewSeconds?: number | null;
}

export function makeObservation(o: ObservationOptions = {}): InspectionObservation {
  const disk = o.diskPercent ?? 10;
  const inode = o.inodePercent ?? 2;
  return {
    schemaVersion: 1,
    collectedAt: o.collectedAt ?? "2026-11-17T08:00:00.000Z",
    source: "ssh",
    durationMs: 900,
    truncated: false,
    truncatedSections: [],
    host: {
      collector: "inspect.host.v1",
      hostname: ok("fixture-host"),
      os: ok({ id: "ubuntu", prettyName: "Ubuntu 24.04.5 LTS", versionId: "24.04" }),
      architecture: ok("x86_64"),
      bootId: ok("fdd6f28c-ae5c-44e1-8d26-0ed581678682"),
      uptimeSeconds: ok(1000),
      load: ok({ one: 0.1, five: 0.1, fifteen: 0.1 }),
      cpuCount: ok(4),
      memory: o.unavailableChecks
        ? unavailable("missing from meminfo: MemAvailable")
        : ok({ totalKib: 100, availableKib: 50, swapTotalKib: 0, swapFreeKib: 0 }),
      filesystems: ok({
        entries: [
          { filesystem: "/dev/sda1", mount: "/", sizeKib: 1000, usedKib: disk * 10, availKib: 1000 - disk * 10, usedPercent: disk },
        ],
        skippedLineCount: 0,
      }),
      inodes: ok({
        entries: [
          { filesystem: "/dev/sda1", mount: "/", inodes: 1000, inodesUsed: inode * 10, inodesFree: 1000 - inode * 10, usedPercent: inode },
        ],
        skippedLineCount: 0,
      }),
      clock:
        o.clockSkewSeconds === null
          ? unavailable("target time not in expected format")
          : ok({
              targetEpochSeconds: Math.floor(Date.parse(o.collectedAt ?? "2026-11-17T08:00:00.000Z") / 1000) + (o.clockSkewSeconds ?? 0),
              skewSeconds: o.clockSkewSeconds ?? 0,
              uncertaintySeconds: 1,
            }),
    },
    services: {
      collector: "inspect.services.v1",
      failedUnits: ok({
        units: (o.failedUnits ?? []).map((u) => ({ ...u, load: "loaded", active: "failed", sub: "failed" })),
        unparsedLineCount: 0,
      }),
    },
    packages: {
      collector: "inspect.packages.v1",
      pendingCount: ok(o.pending ?? 0),
      heldBackCount: ok(0),
      metadataUpdatedAt: ok("2026-11-16T02:00:00.000Z"),
      rebootRequired: ok(o.rebootRequired ?? false),
      metadataClock:
        o.clockSkewSeconds === null ? "unverified" : Math.abs(o.clockSkewSeconds ?? 0) - 1 > 120 ? "corrected" : "in-sync",
    },
  };
}
