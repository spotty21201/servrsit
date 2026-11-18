/**
 * Structured inspection observation (schema version 1).
 *
 * Shared contract: produced by @servrsit/ssh, consumed by the API, the AI
 * adapter and the web client. Moved here from packages/ssh so that every
 * consumer shares one runtime schema (Technical Spec §3.1).
 *
 * Technical Spec §14: collectors emit structured JSON with a schema version
 * and bounded fields. Operation IDs follow §8.1: inspect.host.v1,
 * inspect.services.v1, inspect.packages.v1.
 *
 * A missing capability is always `{status: "unavailable", reason}`. It is
 * never represented as zero, an empty list, or `false`.
 */

import { z } from "zod";

export const OBSERVATION_SCHEMA_VERSION = 1 as const;

/** Array bounds that are part of the wire contract. Byte caps stay in @servrsit/ssh. */
export const OBSERVATION_LIMITS = {
  maxFilesystems: 64,
  maxFailedUnits: 100,
} as const;

export type Field<T> =
  | { status: "ok"; value: T }
  | { status: "unavailable"; reason: string };

function fieldSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), value }),
    z.object({ status: z.literal("unavailable"), reason: z.string().max(200) }),
  ]);
}

const kib = z.number().int().nonnegative();

export const OsInfoSchema = z.object({
  id: z.string().max(64),
  prettyName: z.string().max(128),
  versionId: z.string().max(32).nullable(),
});

export const FilesystemEntrySchema = z.object({
  filesystem: z.string().max(128),
  mount: z.string().max(256),
  sizeKib: kib,
  usedKib: kib,
  availKib: kib,
  usedPercent: z.number().int().min(0).max(100),
});

export const InodeEntrySchema = z.object({
  filesystem: z.string().max(128),
  mount: z.string().max(256),
  inodes: kib,
  inodesUsed: kib,
  inodesFree: kib,
  usedPercent: z.number().int().min(0).max(100),
});

/** Larger skew than this (beyond the measurement uncertainty) is a time-sync finding (T-061, Tech Spec §8.2). */
export const CLOCK_SKEW_TOLERANCE_SECONDS = 120;

export const ClockSchema = z.object({
  targetEpochSeconds: z.number().int().nonnegative(),
  skewSeconds: z.number().int(),
  uncertaintySeconds: z.number().int().nonnegative(),
});
export type Clock = z.infer<typeof ClockSchema>;

/** True when the skew is beyond tolerance even at the most favourable end of the uncertainty. */
export function clockSkewed(clock: Clock): boolean {
  return Math.abs(clock.skewSeconds) - clock.uncertaintySeconds > CLOCK_SKEW_TOLERANCE_SECONDS;
}

/** "about 7 h behind ServrSit's clock", "about 10 min ahead of ServrSit's clock": plain text for findings and summaries. */
export function describeClockSkew(clock: Pick<Clock, "skewSeconds">): string {
  const abs = Math.abs(clock.skewSeconds);
  const span =
    abs >= 3600
      ? `${Math.round(abs / 3600)} h`
      : abs >= 60
        ? `${Math.round(abs / 60)} min`
        : `${abs} s`;
  return `about ${span} ${clock.skewSeconds < 0 ? "behind" : "ahead of"} ServrSit's clock`;
}

// ---------------------------------------------------------------------------
// Package origins (T-062, Tech Spec §10.2 step 2)
// ---------------------------------------------------------------------------

/**
 * Ubuntu's own archive, as `apt-get -s` prints it: "Ubuntu:24.04/noble",
 * "Ubuntu:24.04/noble-updates" or "Ubuntu:24.04/noble-security", possibly
 * several joined by ", ". Backports, proposed, PPAs, ESM and every other
 * repository are outside it.
 */
const UBUNTU_ARCHIVE = /^Ubuntu:\d{2}\.\d{2}\/[a-z]+(?:-(?:updates|security))?$/;

export function isUbuntuArchiveOrigin(origin: string): boolean {
  const parts = origin.split(", ");
  return parts.length > 0 && parts.every((p) => UBUNTU_ARCHIVE.test(p));
}

export const MAX_LISTED_OUTSIDE_UBUNTU = 50;
/** Shown in place of a package name or origin that failed validation. */
export const UNRECOGNISED_NAME = "(unrecognised)";

export const PendingOutsideUbuntuSchema = z.object({
  /** A well-formed Debian package name, or "(unrecognised)". */
  name: z.string().max(100),
  /** The origin label apt printed (for example "Docker CE:noble"), or "(unrecognised)". */
  origin: z.string().max(64),
});
export type PendingOutsideUbuntu = z.infer<typeof PendingOutsideUbuntuSchema>;

export const FailedUnitSchema = z.object({
  unit: z.string().max(256),
  /** True only when `unit` is a well-formed systemd unit name. */
  nameValid: z.boolean(),
  load: z.string().max(32),
  active: z.string().max(32),
  sub: z.string().max(32),
});

export const InspectionObservationSchema = z.object({
  schemaVersion: z.literal(OBSERVATION_SCHEMA_VERSION),
  collectedAt: z.string().datetime(),
  source: z.enum(["ssh", "local"]),
  durationMs: z.number().int().nonnegative(),
  /** True when any captured output hit a size cap. */
  truncated: z.boolean(),
  truncatedSections: z.array(z.string().max(32)).max(32),
  host: z.object({
    collector: z.literal("inspect.host.v1"),
    hostname: fieldSchema(z.string().max(255)),
    os: fieldSchema(OsInfoSchema),
    architecture: fieldSchema(z.string().max(32)),
    bootId: fieldSchema(z.string().uuid()),
    uptimeSeconds: fieldSchema(z.number().nonnegative()),
    load: fieldSchema(
      z.object({
        one: z.number().nonnegative(),
        five: z.number().nonnegative(),
        fifteen: z.number().nonnegative(),
      }),
    ),
    cpuCount: fieldSchema(z.number().int().positive()),
    memory: fieldSchema(
      z.object({
        totalKib: kib,
        availableKib: kib,
        swapTotalKib: kib,
        swapFreeKib: kib,
      }),
    ),
    filesystems: fieldSchema(
      z.object({
        entries: z.array(FilesystemEntrySchema).max(OBSERVATION_LIMITS.maxFilesystems),
        skippedLineCount: z.number().int().nonnegative(),
      }),
    ),
    inodes: fieldSchema(
      z.object({
        entries: z.array(InodeEntrySchema).max(OBSERVATION_LIMITS.maxFilesystems),
        skippedLineCount: z.number().int().nonnegative(),
      }),
    ),
    /**
     * T-061: the target's clock against ServrSit's, read once per collection
     * (`date +%s`, read-only). Positive skew means the target is ahead.
     * `uncertaintySeconds` covers the collection window and the one-second
     * resolution: the true skew is within skew +- uncertainty.
     */
    clock: fieldSchema(ClockSchema),
  }),
  services: z.object({
    collector: z.literal("inspect.services.v1"),
    failedUnits: fieldSchema(
      z.object({
        units: z.array(FailedUnitSchema).max(OBSERVATION_LIMITS.maxFailedUnits),
        unparsedLineCount: z.number().int().nonnegative(),
      }),
    ),
  }),
  packages: z.object({
    collector: z.literal("inspect.packages.v1"),
    /** From a read-only simulation against the existing APT state. No refresh. */
    pendingCount: fieldSchema(z.number().int().nonnegative()),
    heldBackCount: fieldSchema(z.number().int().nonnegative()),
    /**
     * T-062: the pending updates that do NOT come from Ubuntu's own archive
     * (for example Docker's repository). They are listed separately and are
     * excluded from update plans by default. Included in pendingCount.
     */
    pendingOutsideUbuntu: fieldSchema(
      z.object({
        count: z.number().int().nonnegative(),
        packages: z.array(PendingOutsideUbuntuSchema).max(MAX_LISTED_OUTSIDE_UBUNTU),
      }),
    ),
    /**
     * When APT metadata was last refreshed on the target (not by us), in
     * ServrSit's time. The target writes this stamp with its own clock, so it is
     * corrected for a measured skew beyond the tolerance (T-061).
     */
    metadataUpdatedAt: fieldSchema(z.string().datetime()),
    /**
     * How metadataUpdatedAt relates to the target's clock:
     *  - "in-sync": the clock was measured within tolerance; the stamp is used as is.
     *  - "corrected": the clock was off by more than the tolerance; the stamp was shifted by the measured skew.
     *  - "unverified": the clock could not be read, so the stamp may be wrong by any amount.
     */
    metadataClock: z.enum(["in-sync", "corrected", "unverified"]),
    rebootRequired: fieldSchema(z.boolean()),
  }),
});

export type InspectionObservation = z.infer<typeof InspectionObservationSchema>;
export type FilesystemEntry = z.infer<typeof FilesystemEntrySchema>;
export type InodeEntry = z.infer<typeof InodeEntrySchema>;
export type FailedUnit = z.infer<typeof FailedUnitSchema>;
export type OsInfo = z.infer<typeof OsInfoSchema>;

/** Names of the checks counted for coverage, in a stable order. */
export const CHECK_NAMES = [
  "hostname",
  "os",
  "architecture",
  "bootId",
  "uptime",
  "load",
  "cpuCount",
  "memory",
  "filesystems",
  "inodes",
  "clock",
  "failedUnits",
  "pendingPackages",
  "heldBackPackages",
  "packageMetadataAge",
  "rebootRequired",
] as const;

export type CheckName = (typeof CHECK_NAMES)[number];
