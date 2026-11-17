/**
 * Observation schema re-exports and collector helpers.
 *
 * The runtime schema and its types live in @servrsit/contracts (shared with
 * the API, the AI adapter and the web client). This module keeps only what is
 * specific to collecting: the ok/unavailable constructors and the byte caps.
 *
 * A missing capability is always `{status: "unavailable", reason}`. It is
 * never represented as zero, an empty list, or `false`.
 */

import { OBSERVATION_LIMITS, type Field } from "@servrsit/contracts";

export {
  CHECK_NAMES,
  CLOCK_SKEW_TOLERANCE_SECONDS,
  ClockSchema,
  clockSkewed,
  describeClockSkew,
  FailedUnitSchema,
  FilesystemEntrySchema,
  InodeEntrySchema,
  InspectionObservationSchema,
  OBSERVATION_SCHEMA_VERSION,
  OsInfoSchema,
} from "@servrsit/contracts";
export type {
  CheckName,
  Clock,
  FailedUnit,
  Field,
  FilesystemEntry,
  InodeEntry,
  InspectionObservation,
  OsInfo,
} from "@servrsit/contracts";

/** Default size limits from Technical Spec §19. */
export const LIMITS = {
  /** Total bytes captured from one collection run. */
  maxTotalOutputBytes: 1024 * 1024,
  /** Bytes kept for any single collector section. */
  maxSectionBytes: 128 * 1024,
  /** Serialized observation payload cap. */
  maxObservationBytes: 256 * 1024,
  maxFilesystems: OBSERVATION_LIMITS.maxFilesystems,
  maxFailedUnits: OBSERVATION_LIMITS.maxFailedUnits,
} as const;

export function ok<T>(value: T): Field<T> {
  return { status: "ok", value };
}

export function unavailable<T>(reason: string): Field<T> {
  return { status: "unavailable", reason };
}
