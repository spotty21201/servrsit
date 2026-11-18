/**
 * Findings and scheduler API (T-076, PRD FR-19/FR-20, UX Spec §13.1/§13.2).
 *
 *   GET  /api/findings                    -> 200 FindingsResponse
 *   POST /api/findings/:id/acknowledge    -> 200 FindingRecord   (the owner has seen it; never resolves it)
 *   POST /api/findings/:id/snooze         SnoozeRequest -> 200 FindingRecord (delays attention only)
 *   GET  /api/scheduler                   -> 200 SchedulerStatus
 *   POST /api/scheduler/pause             SchedulerPauseRequest -> 200 SchedulerStatus
 *   POST /api/scheduler/resume            -> 200 SchedulerStatus (runs a current check; no backlog replay)
 *
 * Rules the API keeps:
 *  - One record per open issue: repeated detections (same server, same
 *    finding key) update it. A recurrence after resolution is a new record.
 *  - Acknowledge and snooze never resolve.
 *  - "resolved" is set only by a successful check that covered the issue and
 *    no longer showed it; `resolvedBy` names that check (fixed text).
 *  - When the server's checks cannot run, or the check that covers the issue
 *    was unavailable, an open finding is "not-rechecked", never "resolved".
 *  - A resolved record cannot be acknowledged or snoozed (NOT_ALLOWED).
 *
 * Every route needs a signed-in owner; POSTs also the session's CSRF token.
 */

import { z } from "zod";

export const FindingSeveritySchema = z.enum(["critical", "warning", "advisory"]);
export const FindingStateSchema = z.enum(["new", "acknowledged", "snoozed", "resolved", "not-rechecked"]);
export type FindingState = z.infer<typeof FindingStateSchema>;

export const SNOOZE_DURATIONS = ["1h", "1d", "1w"] as const;
export const SnoozeForSchema = z.enum(SNOOZE_DURATIONS);
export type SnoozeFor = z.infer<typeof SnoozeForSchema>;
export const SNOOZE_MS: Readonly<Record<SnoozeFor, number>> = { "1h": 3_600_000, "1d": 86_400_000, "1w": 604_800_000 };

export const FindingRecordSchema = z
  .object({
    id: z.string().uuid(),
    serverId: z.string().uuid(),
    serverName: z.string().max(64),
    production: z.boolean(),
    /** The rule's own deduplication key on that server, for example "disk:/srv". */
    key: z.string().max(300),
    rule: z.string().max(64),
    severity: FindingSeveritySchema,
    summary: z.string().max(500),
    state: FindingStateSchema,
    firstObservedAt: z.string().datetime(),
    lastObservedAt: z.string().datetime(),
    acknowledgedAt: z.string().datetime().nullable(),
    snoozedUntil: z.string().datetime().nullable(),
    resolvedAt: z.string().datetime().nullable(),
    /** Fixed text naming the check that established recovery. Set only when resolved. */
    resolvedBy: z.string().max(300).nullable(),
  })
  .strict();
export type FindingRecord = z.infer<typeof FindingRecordSchema>;

export const SchedulerStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("running"), nextRunAt: z.string().datetime().nullable() }).strict(),
  z.object({ status: z.literal("paused"), since: z.string().datetime(), reason: z.string().max(200) }).strict(),
  /** The next pass is overdue (a pass is still running, or the process was busy). */
  z.object({ status: z.literal("delayed"), dueAt: z.string().datetime() }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.string().max(200) }).strict(),
]);
export type SchedulerStatus = z.infer<typeof SchedulerStatusSchema>;

export const FindingsResponseSchema = z
  .object({
    /** "fixture": records come from [FIXTURE DATA] servers and are never persisted. */
    mode: z.enum(["live", "fixture"]),
    findings: z.array(FindingRecordSchema).max(2000),
    scheduler: SchedulerStatusSchema,
    /** Stage A: there are no external alerts (FR-20). Findings are kept in the app only. */
    externalAlerts: z.object({ available: z.literal(false), reason: z.string().max(200) }).strict(),
  })
  .strict();
export type FindingsResponse = z.infer<typeof FindingsResponseSchema>;

export const SnoozeRequestSchema = z.object({ for: SnoozeForSchema }).strict();
export type SnoozeRequest = z.infer<typeof SnoozeRequestSchema>;

export const SchedulerPauseRequestSchema = z
  .object({ reason: z.string().regex(/^[\p{L}\p{N} .,'()/:-]{1,120}$/u).optional() })
  .strict();
export type SchedulerPauseRequest = z.infer<typeof SchedulerPauseRequestSchema>;

export const FindingsErrorCodeSchema = z.enum(["INVALID_INPUT", "NOT_FOUND", "NOT_ALLOWED", "UNAVAILABLE"]);
export type FindingsErrorCode = z.infer<typeof FindingsErrorCodeSchema>;
export const FindingsErrorSchema = z
  .object({ error: FindingsErrorCodeSchema, reason: z.string().max(300).optional() })
  .strict();
export type FindingsError = z.infer<typeof FindingsErrorSchema>;
