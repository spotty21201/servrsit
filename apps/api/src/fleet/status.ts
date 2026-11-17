/**
 * Status, freshness and coverage. Pure functions: no I/O, no clock reads.
 *
 * PRD FR-06 / Technical Spec §14: health information expires after two
 * configured health intervals. A failed latest attempt is shown immediately,
 * alongside the last successful data. "Fresh" only describes checks performed.
 */

import { CHECK_NAMES, type InspectionObservation } from "@servrsit/ssh";
import type { FleetServer, FleetStatus } from "./schema.js";

export const FRESHNESS_INTERVALS = 2;

export interface Attempt {
  readonly at: Date;
  readonly succeeded: boolean;
  readonly failure: { readonly code: string; readonly message: string } | null;
}

export interface StatusInput {
  readonly collect: boolean;
  readonly collectDisabledReason: string | undefined;
  /** For ssh hosts: is the host key pinned? Local hosts pass "pinned". */
  readonly pin: "pinned" | "not-pinned" | "revoked" | "unknown";
  readonly latestAttempt: Attempt | null;
  readonly lastSuccessAt: Date | null;
  readonly lastSuccessCoverageComplete: boolean;
  readonly healthIntervalMs: number;
  readonly now: Date;
}

export interface DerivedStatus {
  readonly status: FleetStatus;
  readonly statusReason: string;
}

export function freshUntil(observedAt: Date, healthIntervalMs: number): Date {
  return new Date(observedAt.getTime() + FRESHNESS_INTERVALS * healthIntervalMs);
}

export function deriveStatus(input: StatusInput): DerivedStatus {
  if (input.pin === "unknown") {
    return { status: "not-yet-checked", statusReason: "The host key pin has not been checked yet." };
  }
  if (input.pin !== "pinned") {
    return {
      status: "unverified-host",
      statusReason:
        input.pin === "revoked"
          ? "The host key is revoked in the pinned file. The host was not contacted."
          : "The host key has not been verified and pinned. The host was not contacted.",
    };
  }
  if (!input.collect) {
    return {
      status: "collection-disabled",
      statusReason: input.collectDisabledReason ?? "Collection is disabled for this host.",
    };
  }
  const attempt = input.latestAttempt;
  if (attempt === null) {
    return { status: "not-yet-checked", statusReason: "No check has finished yet." };
  }
  if (!attempt.succeeded) {
    const code = attempt.failure?.code;
    const message = attempt.failure?.message ?? "The latest check failed.";
    if (code === "HOST_KEY_CHANGED") return { status: "host-key-changed", statusReason: message };
    if (code === "AUTH_FAILED") return { status: "access-denied", statusReason: message };
    if (code === "TARGET_REJECTED") return { status: "misconfigured", statusReason: message };
    return { status: "unreachable", statusReason: message };
  }
  if (input.lastSuccessAt === null) {
    return { status: "not-yet-checked", statusReason: "No check has finished yet." };
  }
  if (input.now.getTime() > freshUntil(input.lastSuccessAt, input.healthIntervalMs).getTime()) {
    return { status: "stale", statusReason: "The last successful check is older than two check intervals." };
  }
  return input.lastSuccessCoverageComplete
    ? { status: "fresh", statusReason: "All checks ran and were within their freshness window." }
    : { status: "partial", statusReason: "Some checks were unavailable. See coverage." };
}

type FieldLike = { status: "ok" } | { status: "unavailable"; reason: string };

/** Which of the fixed checks ran, and why the others did not. */
export function coverageOf(observation: InspectionObservation): NonNullable<FleetServer["coverage"]> {
  const h = observation.host;
  const p = observation.packages;
  const byName: Record<(typeof CHECK_NAMES)[number], FieldLike> = {
    hostname: h.hostname,
    os: h.os,
    architecture: h.architecture,
    bootId: h.bootId,
    uptime: h.uptimeSeconds,
    load: h.load,
    cpuCount: h.cpuCount,
    memory: h.memory,
    filesystems: h.filesystems,
    inodes: h.inodes,
    failedUnits: observation.services.failedUnits,
    pendingPackages: p.pendingCount,
    heldBackPackages: p.heldBackCount,
    packageMetadataAge: p.metadataUpdatedAt,
    rebootRequired: p.rebootRequired,
  };
  const unavailable: Array<{ check: string; reason: string }> = [];
  for (const name of CHECK_NAMES) {
    const f = byName[name];
    if (f.status === "unavailable") unavailable.push({ check: name, reason: f.reason });
  }
  return {
    passed: CHECK_NAMES.length - unavailable.length,
    total: CHECK_NAMES.length,
    unavailable,
  };
}
