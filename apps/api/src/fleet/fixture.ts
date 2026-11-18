/**
 * [FIXTURE DATA]
 *
 * Fixture-mode response, used only when SERVRSIT_FLEET_MODE=fixture.
 *
 * Fully independent of the real fleet (D5): fixed fake IDs from an obviously
 * synthetic range, made-up names, and synthetic observations. Nothing is taken
 * from the configured hosts, so a fixture card can never be mistaken for, or
 * merged with, a real server by id or name.
 *
 * Internally consistent: a server has `observedAt` only when it has an
 * observation, and coverage and findings are computed from that observation
 * with the same rules as live mode.
 */

import { NOT_CHECKED_CLOCK } from "../clock/controller-clock.js";
import { ok, unavailable, type InspectionObservation } from "@servrsit/ssh";
import type { FleetConfig } from "./config.js";
import { evaluateFindings } from "./findings.js";
import type { FleetResponse, FleetServer } from "./schema.js";
import { coverageOf, freshUntil } from "./status.js";

const TAG = "[FIXTURE DATA] ";

/** Fixed fake IDs. Valid UUID v4 syntax, but obviously synthetic. */
export const FIXTURE_IDS = {
  a: "00000000-0000-4000-8000-0000000000a1",
  b: "00000000-0000-4000-8000-0000000000b2",
  c: "00000000-0000-4000-8000-0000000000c3",
  d: "00000000-0000-4000-8000-0000000000d4",
} as const;

const MIN = 60_000;

interface ObservationShape {
  readonly at: Date;
  readonly hostname: string;
  readonly diskPercent: number;
  readonly pending: number;
  readonly memoryUnavailable?: boolean;
}

function syntheticObservation(o: ObservationShape): InspectionObservation {
  const sizeKib = 100 * 1024 * 1024;
  const usedKib = Math.round((sizeKib * o.diskPercent) / 100);
  return {
    schemaVersion: 1,
    collectedAt: o.at.toISOString(),
    source: "ssh",
    durationMs: 900,
    truncated: false,
    truncatedSections: [],
    host: {
      collector: "inspect.host.v1",
      hostname: ok(o.hostname),
      os: ok({ id: "ubuntu", prettyName: "Ubuntu 24.04.5 LTS", versionId: "24.04" }),
      architecture: ok("x86_64"),
      bootId: ok("00000000-0000-4000-8000-00000000b007"),
      uptimeSeconds: ok(5 * 86400),
      load: ok({ one: 0.2, five: 0.15, fifteen: 0.1 }),
      cpuCount: ok(4),
      memory: o.memoryUnavailable === true
        ? unavailable("missing from meminfo: MemAvailable")
        : ok({ totalKib: 8 * 1024 * 1024, availableKib: 5 * 1024 * 1024, swapTotalKib: 0, swapFreeKib: 0 }),
      filesystems: ok({
        entries: [
          { filesystem: "/dev/fixture1", mount: "/", sizeKib, usedKib, availKib: sizeKib - usedKib, usedPercent: o.diskPercent },
        ],
        skippedLineCount: 0,
      }),
      inodes: ok({
        entries: [
          { filesystem: "/dev/fixture1", mount: "/", inodes: 6_000_000, inodesUsed: 120_000, inodesFree: 5_880_000, usedPercent: 2 },
        ],
        skippedLineCount: 0,
      }),
      clock: ok({ targetEpochSeconds: Math.floor(o.at.getTime() / 1000), skewSeconds: 0, uncertaintySeconds: 1 }),
    },
    services: {
      collector: "inspect.services.v1",
      failedUnits: ok({ units: [], unparsedLineCount: 0 }),
    },
    packages: {
      collector: "inspect.packages.v1",
      pendingCount: ok(o.pending),
      heldBackCount: ok(0),
      pendingOutsideUbuntu: ok({ count: 0, packages: [] }),
      metadataUpdatedAt: ok(new Date(o.at.getTime() - 6 * 60 * MIN).toISOString()),
      rebootRequired: ok(false),
      metadataClock: "in-sync",
    },
  };
}

function withObservation(
  base: Omit<FleetServer, "observedAt" | "freshUntil" | "coverage" | "findings" | "observation">,
  observation: InspectionObservation,
  intervalMs: number,
  extra: { consecutiveFailures?: number; latestFailureCode?: string | null } = {},
): FleetServer {
  const at = new Date(observation.collectedAt);
  return {
    ...base,
    observedAt: observation.collectedAt,
    freshUntil: freshUntil(at, intervalMs).toISOString(),
    coverage: coverageOf(observation),
    findings: evaluateFindings({
      current: observation,
      previous: observation,
      consecutiveFailures: extra.consecutiveFailures ?? 0,
      latestFailureCode: extra.latestFailureCode ?? null,
    }),
    observation,
  };
}

export function buildFixtureFleet(config: FleetConfig, now: Date): FleetResponse {
  const intervalMs = config.healthIntervalMinutes * MIN;
  const ago = (ms: number): Date => new Date(now.getTime() - ms);

  const realIds = new Set(config.hosts.map((h) => h.id));
  for (const id of Object.values(FIXTURE_IDS)) {
    if (realIds.has(id)) throw new Error("a fixture id collides with a configured host id");
  }

  const common = { production: false, access: "ssh" as const, source: "fixture" as const, importantServices: [] as string[] };

  const fresh = withObservation(
    {
      ...common, id: FIXTURE_IDS.a, name: "Fixture A", role: "[FIXTURE] Web",
      status: "fresh", statusReason: `${TAG}Synthetic server: all checks ran.`,
      latestAttempt: { at: ago(12 * MIN).toISOString(), succeeded: true, failure: null, consecutiveFailures: 0 },
    },
    syntheticObservation({ at: ago(12 * MIN), hostname: "fixture-a", diskPercent: 41, pending: 3 }),
    intervalMs,
  );

  const partial = withObservation(
    {
      ...common, id: FIXTURE_IDS.b, name: "Fixture B", role: "[FIXTURE] Database",
      status: "partial", statusReason: `${TAG}Synthetic server: one check was unavailable.`,
      latestAttempt: { at: ago(9 * MIN).toISOString(), succeeded: true, failure: null, consecutiveFailures: 0 },
    },
    syntheticObservation({ at: ago(9 * MIN), hostname: "fixture-b", diskPercent: 88, pending: 0, memoryUnavailable: true }),
    intervalMs,
  );

  const unreachable = withObservation(
    {
      ...common, id: FIXTURE_IDS.c, name: "Fixture C", role: "[FIXTURE] Backup",
      status: "unreachable", statusReason: `${TAG}Synthetic server: the latest check could not reach it.`,
      latestAttempt: {
        at: ago(4 * MIN).toISOString(), succeeded: false,
        failure: { code: "ROUTE_UNAVAILABLE", message: `${TAG}Synthetic connection failure.` },
        consecutiveFailures: 2,
      },
    },
    syntheticObservation({ at: ago(50 * MIN), hostname: "fixture-c", diskPercent: 23, pending: 1 }),
    intervalMs,
    { consecutiveFailures: 2, latestFailureCode: "ROUTE_UNAVAILABLE" },
  );

  const noData: FleetServer = {
    ...common, id: FIXTURE_IDS.d, name: "Fixture D", role: "[FIXTURE] New server",
    status: "unverified-host", statusReason: `${TAG}Synthetic server: host key not verified, never contacted.`,
    observedAt: null, freshUntil: null, coverage: null, latestAttempt: null, findings: [], observation: null,
  };

  return {
    mode: "fixture",
    generatedAt: now.toISOString(),
    healthIntervalMinutes: config.healthIntervalMinutes,
    ownerTimeZone: config.ownerTimeZone,
    nextCheckAt: null,
    controlPlane: { clock: { ...NOT_CHECKED_CLOCK, reason: "[FIXTURE DATA] Fixture mode does not check ServrSit's own clock." }, findings: [] },
    servers: [fresh, partial, unreachable, noData],
  };
}
