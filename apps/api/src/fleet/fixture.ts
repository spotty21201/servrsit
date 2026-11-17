/**
 * [FIXTURE DATA]
 *
 * Fixture-mode response, used only when SERVRSIT_FLEET_MODE=fixture. Every
 * server is labelled source "fixture" and every reason text says so. Nothing
 * here describes a real server, and fixture and live data are never mixed in
 * one response.
 */

import type { FleetConfig } from "./config.js";
import type { FleetResponse, FleetServer } from "./schema.js";

const TAG = "[FIXTURE DATA] ";

export function buildFixtureFleet(config: FleetConfig, now: Date): FleetResponse {
  const interval = config.healthIntervalMinutes * 60_000;
  const iso = (offsetMs: number): string => new Date(now.getTime() + offsetMs).toISOString();
  const scenarios: Array<Pick<FleetServer, "status" | "statusReason"> & { ageMs: number | null }> = [
    { status: "fresh", statusReason: `${TAG}Synthetic fresh server.`, ageMs: 12 * 60_000 },
    { status: "partial", statusReason: `${TAG}Synthetic server with one unavailable check.`, ageMs: 14 * 60_000 },
    { status: "unreachable", statusReason: `${TAG}Synthetic unreachable server.`, ageMs: 45 * 60_000 },
    { status: "fresh", statusReason: `${TAG}Synthetic fresh server.`, ageMs: 3 * 60_000 },
  ];
  const servers: FleetServer[] = config.hosts.map((host, i) => {
    const s = scenarios[i % scenarios.length];
    if (s === undefined) throw new Error("fixture scenarios missing");
    const observedAt = s.ageMs === null ? null : iso(-s.ageMs);
    return {
      id: host.id,
      name: host.name,
      role: host.role,
      production: host.production,
      access: host.access,
      source: "fixture",
      status: s.status,
      statusReason: s.statusReason,
      observedAt,
      freshUntil: s.ageMs === null ? null : iso(2 * interval - s.ageMs),
      coverage: null,
      latestAttempt: null,
      findings: [],
      observation: null,
    };
  });
  return {
    mode: "fixture",
    generatedAt: now.toISOString(),
    healthIntervalMinutes: config.healthIntervalMinutes,
    nextCheckAt: null,
    servers,
  };
}
