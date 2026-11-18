/**
 * Build the ONLY data that is ever sent to the model.
 *
 * ADR-012: input is sanitised structured observations. No credentials, no raw
 * files, no raw command output. Every value is either a number, a boolean, a
 * member of a closed set, or a name that passed a strict well-formedness check.
 * Names that fail the check are replaced by a count. No free text of any kind
 * is passed: not status reasons, not finding summaries, not failure messages.
 *
 * Times are never sent raw (DEF-L1). Each one is {at, age}: already formatted
 * in the owner's time zone, with an age computed here, so the model has
 * nothing to convert and no UTC to quote.
 *
 * Passing the check does not make a name trustworthy: a well-formed name can
 * still be hostile ("ignore-previous-instructions.service"). The agent prompt
 * treats the whole object as data, the agent has no tools, and its output is
 * never executed. The permission boundary does not depend on this filter.
 */

import {
  CHECK_NAMES,
  clockSkewed,
  isSafeMountPath,
  isSafeUnitName,
  type InspectionObservation,
} from "@servrsit/ssh";
import { z } from "zod";
import { LocalTimeSchema, localTime, type TimeContext } from "./time.js";

/** Structural subset of the API's fleet server record. */
export interface ExplainableServer {
  readonly name: string;
  readonly role: string | null;
  readonly production: boolean;
  /** Units the owner marked as important (from configuration). Optional for older callers. */
  readonly importantServices?: readonly string[] | undefined;
  readonly access: "ssh" | "local";
  readonly status: string;
  readonly statusReason: string;
  readonly observedAt: string | null;
  readonly freshUntil: string | null;
  readonly coverage: {
    readonly passed: number;
    readonly total: number;
    readonly unavailable: ReadonlyArray<{ readonly check: string; readonly reason: string }>;
  } | null;
  readonly latestAttempt: {
    readonly at: string;
    readonly succeeded: boolean;
    readonly failure: { readonly code: string; readonly message: string } | null;
    readonly consecutiveFailures: number;
  } | null;
  readonly findings: ReadonlyArray<{
    readonly severity: "critical" | "warning" | "advisory";
    readonly rule: string;
    readonly summary: string;
  }>;
  readonly observation: InspectionObservation | null;
}

const text = (max: number) => z.string().max(max);

/** Closed sets. Anything else becomes "unknown", so free text cannot ride in these fields. */
const KNOWN_STATUSES = [
  "unverified-host", "host-key-changed", "access-denied", "unreachable", "misconfigured",
  "collection-disabled", "not-yet-checked", "stale", "partial", "fresh", "unknown",
] as const;
const KNOWN_FAILURE_CODES = [
  "HOST_UNTRUSTED", "HOST_KEY_CHANGED", "ROUTE_UNAVAILABLE", "AUTH_FAILED", "TIMEOUT",
  "TARGET_REJECTED", "OUTPUT_INVALID", "COLLECTION_FAILED", "UNKNOWN",
] as const;
const RULE_ID = /^[a-z][a-z0-9.-]{0,62}\.v\d{1,3}$/;

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export const AiServerInputSchema = z
  .object({
    server: z.object({
      name: text(64),
      role: text(64).nullable(),
      production: z.boolean(),
      access: z.enum(["ssh", "local"]),
      importantServices: z.array(text(100)).max(20),
    }),
    status: z.enum(KNOWN_STATUSES),
    /** Last successful check, owner-local. */
    observed: LocalTimeSchema.nullable(),
    /** When that check stops counting as fresh, owner-local. */
    freshUntil: LocalTimeSchema.nullable(),
    latestAttempt: z
      .object({
        at: LocalTimeSchema,
        succeeded: z.boolean(),
        failureCode: z.enum(KNOWN_FAILURE_CODES).nullable(),
        consecutiveFailures: z.number().int().nonnegative(),
      })
      .nullable(),
    coverage: z
      .object({
        passed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        unavailableChecks: z.array(text(40)).max(20),
      })
      .nullable(),
    metrics: z
      .object({
        os: text(64).nullable(),
        cpuCount: z.number().int().positive().nullable(),
        load1: z.number().nonnegative().nullable(),
        memoryUsedPercent: z.number().int().min(0).max(100).nullable(),
        uptimeDays: z.number().int().nonnegative().nullable(),
        filesystems: z.array(z.object({ mount: text(64), usedPercent: z.number().int().min(0).max(100) })).max(8).nullable(),
        /** Inode use per filesystem (T-051: so inode claims can be checked). */
        inodes: z.array(z.object({ mount: text(64), usedPercent: z.number().int().min(0).max(100) })).max(8).nullable(),
        pendingUpdates: z.number().int().nonnegative().nullable(),
        /**
         * T-062: the part of pendingUpdates that comes from outside Ubuntu's archive (for example Docker's
         * repository). Update plans leave these out. Null when unavailable.
         */
        pendingOutsideUbuntu: z
          .object({ count: z.number().int().nonnegative(), names: z.array(text(100)).max(10), origins: z.array(text(64)).max(10) })
          .nullable(),
        /**
         * When the HOST last refreshed its package lists (DEF-L2), owner-local.
         * pendingUpdates is only as current as this. ServrSit never refreshes them.
         */
        packageLists: LocalTimeSchema.nullable(),
        /**
         * T-061: how packageLists relates to the host's clock. "corrected": the host's clock was off by more
         * than 2 minutes and the time was corrected; "unverified": the clock could not be checked.
         */
        packageListsClock: z.enum(["in-sync", "corrected", "unverified"]),
        /** T-061: host clock minus ServrSit's. Null when it could not be read. */
        clock: z
          .object({ skewSeconds: z.number().int(), uncertaintySeconds: z.number().int().nonnegative(), beyondTolerance: z.boolean() })
          .nullable(),
        rebootRequired: z.boolean().nullable(),
        failedUnits: z
          .object({ names: z.array(text(100)).max(10), unrecognisedCount: z.number().int().nonnegative() })
          .nullable(),
        /** Important services that are currently in the failed list. Null when failed units are unavailable. */
        importantServicesFailed: z.array(text(100)).max(20).nullable(),
      })
      .nullable(),
    findings: z
      .array(z.object({ severity: z.enum(["critical", "warning", "advisory"]), rule: text(64) }))
      .max(20),
  })
  .strict();

export type AiServerInput = z.infer<typeof AiServerInputSchema>;

const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
/** Owner-written role text: plain words and light punctuation; never < > " ` $ ; or newlines. */
const ROLE = /^[A-Za-z0-9][A-Za-z0-9 ._,()/&'+:-]{0,63}$/;
const OS_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,63}$/;
const DEB_PACKAGE = /^[a-z0-9][a-z0-9+.-]{0,99}$/;
const ORIGIN = /^[A-Za-z0-9][A-Za-z0-9 ._:/,+~-]{0,63}$/;
const KNOWN_CHECKS: ReadonlySet<string> = new Set(CHECK_NAMES);
const UNRECOGNISED_MOUNT = "(unrecognised mount name)";

function metricsFrom(
  o: InspectionObservation,
  ctx: TimeContext,
  important: readonly string[],
): NonNullable<AiServerInput["metrics"]> {
  const h = o.host;
  const mem = h.memory.status === "ok" ? h.memory.value : null;
  const memoryUsedPercent =
    mem !== null && mem.totalKib > 0
      ? Math.max(0, Math.min(100, Math.round(((mem.totalKib - mem.availableKib) / mem.totalKib) * 100)))
      : null;

  let failedUnits: NonNullable<AiServerInput["metrics"]>["failedUnits"] = null;
  if (o.services.failedUnits.status === "ok") {
    const { units, unparsedLineCount } = o.services.failedUnits.value;
    const names: string[] = [];
    let unrecognised = unparsedLineCount;
    for (const u of units) {
      if (u.nameValid && isSafeUnitName(u.unit) && u.unit.length <= 100 && names.length < 10) names.push(u.unit);
      else unrecognised += 1;
    }
    failedUnits = { names, unrecognisedCount: unrecognised };
  }

  return {
    os: h.os.status === "ok" && OS_NAME.test(h.os.value.prettyName) ? h.os.value.prettyName : null,
    cpuCount: h.cpuCount.status === "ok" ? h.cpuCount.value : null,
    load1: h.load.status === "ok" ? Math.round(h.load.value.one * 100) / 100 : null,
    memoryUsedPercent,
    uptimeDays: h.uptimeSeconds.status === "ok" ? Math.floor(h.uptimeSeconds.value / 86400) : null,
    filesystems:
      h.filesystems.status === "ok"
        ? h.filesystems.value.entries.slice(0, 8).map((e) => ({
            mount: isSafeMountPath(e.mount) && e.mount.length <= 64 ? e.mount : UNRECOGNISED_MOUNT,
            usedPercent: e.usedPercent,
          }))
        : null,
    inodes:
      h.inodes.status === "ok"
        ? h.inodes.value.entries.slice(0, 8).map((e) => ({
            mount: isSafeMountPath(e.mount) && e.mount.length <= 64 ? e.mount : UNRECOGNISED_MOUNT,
            usedPercent: e.usedPercent,
          }))
        : null,
    pendingUpdates: o.packages.pendingCount.status === "ok" ? o.packages.pendingCount.value : null,
    pendingOutsideUbuntu:
      o.packages.pendingOutsideUbuntu.status === "ok"
        ? {
            count: o.packages.pendingOutsideUbuntu.value.count,
            names: o.packages.pendingOutsideUbuntu.value.packages.map((p) => p.name).filter((n) => DEB_PACKAGE.test(n)).slice(0, 10),
            origins: [...new Set(o.packages.pendingOutsideUbuntu.value.packages.map((p) => p.origin).filter((x) => ORIGIN.test(x)))].slice(0, 10),
          }
        : null,
    packageLists:
      o.packages.metadataUpdatedAt.status === "ok" ? localTime(o.packages.metadataUpdatedAt.value, ctx) : null,
    packageListsClock: o.packages.metadataClock,
    clock:
      h.clock.status === "ok"
        ? { skewSeconds: h.clock.value.skewSeconds, uncertaintySeconds: h.clock.value.uncertaintySeconds, beyondTolerance: clockSkewed(h.clock.value) }
        : null,
    rebootRequired: o.packages.rebootRequired.status === "ok" ? o.packages.rebootRequired.value : null,
    failedUnits,
    importantServicesFailed:
      o.services.failedUnits.status === "ok"
        ? important.filter((name) => o.services.failedUnits.status === "ok" && o.services.failedUnits.value.units.some((u) => u.nameValid && u.unit === name))
        : null,
  };
}

/** Rebuild the model input from scratch. Nothing is copied wholesale. */
/** Only well-formed unit names, at most 20. */
function importantFrom(server: ExplainableServer): string[] {
  return (server.importantServices ?? []).filter((n) => isSafeUnitName(n) && n.length <= 100).slice(0, 20);
}

export function buildAiInput(server: ExplainableServer, ctx: TimeContext): AiServerInput {
  const important = importantFrom(server);
  const attemptAt = server.latestAttempt === null ? null : localTime(server.latestAttempt.at, ctx);
  return AiServerInputSchema.parse({
    server: {
      name: SERVER_NAME.test(server.name) ? server.name : "(unnamed server)",
      role: server.role !== null && ROLE.test(server.role) ? server.role : null,
      production: server.production,
      access: server.access,
      importantServices: important,
    },
    status: oneOf(server.status, KNOWN_STATUSES, "unknown"),
    observed: localTime(server.observedAt, ctx),
    freshUntil: localTime(server.freshUntil, ctx),
    latestAttempt:
      server.latestAttempt === null || attemptAt === null
        ? null
        : {
            at: attemptAt,
            succeeded: server.latestAttempt.succeeded,
            failureCode:
              server.latestAttempt.failure === null
                ? null
                : oneOf(server.latestAttempt.failure.code, KNOWN_FAILURE_CODES, "UNKNOWN"),
            consecutiveFailures: server.latestAttempt.consecutiveFailures,
          },
    coverage:
      server.coverage === null
        ? null
        : {
            passed: server.coverage.passed,
            total: server.coverage.total,
            unavailableChecks: server.coverage.unavailable.map((u) => u.check).filter((c) => KNOWN_CHECKS.has(c)),
          },
    metrics: server.observation === null ? null : metricsFrom(server.observation, ctx, important),
    findings: server.findings
      .slice(0, 20)
      .map((f) => ({ severity: f.severity, rule: RULE_ID.test(f.rule) ? f.rule : "unknown.v1" })),
  });
}
