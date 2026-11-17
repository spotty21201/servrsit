/**
 * Structured inspection observation (schema version 1).
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

/** Default size limits from Technical Spec §19. */
export const LIMITS = {
  /** Total bytes captured from one collection run. */
  maxTotalOutputBytes: 1024 * 1024,
  /** Bytes kept for any single collector section. */
  maxSectionBytes: 128 * 1024,
  /** Serialized observation payload cap. */
  maxObservationBytes: 256 * 1024,
  maxFilesystems: 64,
  maxFailedUnits: 100,
} as const;

export type Field<T> =
  | { status: "ok"; value: T }
  | { status: "unavailable"; reason: string };

export function ok<T>(value: T): Field<T> {
  return { status: "ok", value };
}

export function unavailable<T>(reason: string): Field<T> {
  return { status: "unavailable", reason };
}

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
        entries: z.array(FilesystemEntrySchema).max(LIMITS.maxFilesystems),
        skippedLineCount: z.number().int().nonnegative(),
      }),
    ),
    inodes: fieldSchema(
      z.object({
        entries: z.array(InodeEntrySchema).max(LIMITS.maxFilesystems),
        skippedLineCount: z.number().int().nonnegative(),
      }),
    ),
  }),
  services: z.object({
    collector: z.literal("inspect.services.v1"),
    failedUnits: fieldSchema(
      z.object({
        units: z.array(FailedUnitSchema).max(LIMITS.maxFailedUnits),
        unparsedLineCount: z.number().int().nonnegative(),
      }),
    ),
  }),
  packages: z.object({
    collector: z.literal("inspect.packages.v1"),
    /** From a read-only simulation against the existing APT state. No refresh. */
    pendingCount: fieldSchema(z.number().int().nonnegative()),
    heldBackCount: fieldSchema(z.number().int().nonnegative()),
    /** When APT metadata was last refreshed on the target (not by us). */
    metadataUpdatedAt: fieldSchema(z.string().datetime()),
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
  "failedUnits",
  "pendingPackages",
  "heldBackPackages",
  "packageMetadataAge",
  "rebootRequired",
] as const;

export type CheckName = (typeof CHECK_NAMES)[number];
