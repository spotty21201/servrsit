/**
 * Response contract for GET /api/fleet.
 *
 * Shared between the API (producer) and the web client (consumer). Moved here
 * from apps/api so both sides validate against one runtime schema.
 */

import { z } from "zod";
import { InspectionObservationSchema } from "./observation.js";

export const FleetStatusSchema = z.enum([
  /** No pinned host key. The host was not contacted. */
  "unverified-host",
  /** The host key no longer matches the pinned key. Blocked until reverified. */
  "host-key-changed",
  /** The host was reached but rejected our credentials. */
  "access-denied",
  /** The latest attempt could not reach the host. */
  "unreachable",
  /** The configured target was rejected by validation. */
  "misconfigured",
  /** Collection is switched off for this host in configuration. */
  "collection-disabled",
  /** Enabled and verified, but no attempt has finished yet. */
  "not-yet-checked",
  /** Latest check succeeded but is past its freshness deadline. */
  "stale",
  /** Fresh, but at least one check was unavailable. */
  "partial",
  /** Fresh and every check ran. */
  "fresh",
]);

export const FindingSchema = z.object({
  /** Stable deduplication key, e.g. "disk:/srv". */
  id: z.string().max(300),
  rule: z.string().max(64),
  severity: z.enum(["critical", "warning", "advisory"]),
  summary: z.string().max(400),
});

export const FleetServerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string().nullable(),
  production: z.boolean(),
  access: z.enum(["ssh", "local"]),
  /** "live" = derived from real checks (including a live "not verified" fact). */
  source: z.enum(["live", "fixture"]),
  status: FleetStatusSchema,
  statusReason: z.string().max(300),
  /** Time of the last SUCCESSFUL observation. Null if none has ever succeeded. */
  observedAt: z.string().datetime().nullable(),
  /** observedAt plus two health intervals (PRD FR-06). */
  freshUntil: z.string().datetime().nullable(),
  coverage: z
    .object({
      passed: z.number().int().nonnegative(),
      total: z.number().int().positive(),
      unavailable: z.array(z.object({ check: z.string(), reason: z.string() })),
    })
    .nullable(),
  /** Latest attempt, shown alongside the last success so a failure is never hidden. */
  latestAttempt: z
    .object({
      at: z.string().datetime(),
      succeeded: z.boolean(),
      failure: z.object({ code: z.string(), message: z.string() }).nullable(),
      consecutiveFailures: z.number().int().nonnegative(),
    })
    .nullable(),
  findings: z.array(FindingSchema),
  /** The last successful observation (historical when status is not fresh/partial). */
  observation: InspectionObservationSchema.nullable(),
});

export const FleetResponseSchema = z.object({
  mode: z.enum(["live", "fixture"]),
  generatedAt: z.string().datetime(),
  healthIntervalMinutes: z.number().int().positive(),
  nextCheckAt: z.string().datetime().nullable(),
  servers: z.array(FleetServerSchema),
});

export type FleetStatus = z.infer<typeof FleetStatusSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type FleetServer = z.infer<typeof FleetServerSchema>;
export type FleetResponse = z.infer<typeof FleetResponseSchema>;
