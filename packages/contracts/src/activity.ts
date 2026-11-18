/**
 * Activity history and export API (T-077, PRD FR-18/FR-21, UX-10, UX Spec §14).
 *
 *   GET  /api/activity?type=&server=&result=&from=&to=&q=&limit=   -> 200 ActivityResponse
 *   POST /api/exports              ExportRequest -> 201 ExportResult (built on the server)
 *   GET  /api/exports                             -> 200 ExportList (not expired, newest first)
 *   GET  /api/exports/:id/download                -> 200 the file (attachment); 410 when expired
 *
 * Records are written by ServrSit from fixed text: titles, outcomes, counts,
 * fixed failure texts. No key, token, password, raw command output, log
 * contents or transcript enters a record or an export; known secret values
 * are scrubbed again before an export is stored. Failed and cancelled
 * operations are included. Simulated operations say so.
 *
 * Retention (FR-21 proposal): inspection summaries 30 days, operation records
 * 90 days shown here (records are never edited), exports 7 days.
 */

import { z } from "zod";

export const ACTIVITY_TYPES = ["operation", "finding", "inspection"] as const;
export const ActivityTypeSchema = z.enum(ACTIVITY_TYPES);
export const ACTIVITY_RESULTS = ["succeeded", "partial", "failed", "unknown", "cancelled", "in-progress", "info"] as const;
export const ActivityResultSchema = z.enum(ACTIVITY_RESULTS);
export type ActivityResult = z.infer<typeof ActivityResultSchema>;
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const INSPECTION_RETENTION_DAYS = 30;
export const OPERATION_HISTORY_DAYS = 90;
export const EXPORT_RETENTION_DAYS = 7;

export const REDACTION_STATEMENT =
  "Secrets are redacted: no keys, passwords, tokens, raw command output or log contents are included.";

export const ActivityRecordSchema = z
  .object({
    id: z.string().max(80),
    type: ActivityTypeSchema,
    at: z.string().datetime(),
    serverId: z.string().uuid(),
    serverName: z.string().max(64),
    production: z.boolean(),
    /** True for work on a simulated target (tests and demos). Never mixed up with live evidence. */
    simulated: z.boolean(),
    /** Fixed, display-safe title, for example "Update packages". */
    title: z.string().max(120),
    result: ActivityResultSchema,
    /** Short outcome text written by ServrSit. Never raw server output. */
    summary: z.string().max(500),
    /** Where the record opens, when it has a page. */
    href: z.string().regex(/^\/[A-Za-z0-9/_-]*$/).max(200).nullable(),
  })
  .strict();
export type ActivityRecord = z.infer<typeof ActivityRecordSchema>;

const IsoDate = z.string().datetime();

export const ActivityQuerySchema = z
  .object({
    type: ActivityTypeSchema.optional(),
    server: z.string().uuid().optional(),
    result: ActivityResultSchema.optional(),
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    /** Plain text, matched case-insensitively against title, summary and server name. */
    q: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(500),
  })
  .strict();
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

export const ActivityResponseSchema = z
  .object({
    records: z.array(ActivityRecordSchema).max(1000),
    /** More records matched than `limit`. */
    truncated: z.boolean(),
  })
  .strict();
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

export const ExportFormatSchema = z.enum(["report", "json"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportRequestSchema = z
  .object({
    format: ExportFormatSchema,
    from: IsoDate,
    to: IsoDate,
    /** IANA zone the report's times are written in. */
    timeZone: z.string().min(1).max(64),
    type: ActivityTypeSchema.optional(),
    server: z.string().uuid().optional(),
    result: ActivityResultSchema.optional(),
    q: z.string().max(100).optional(),
    /** Optional: only these records (ids from GET /api/activity). The server still builds every line itself. */
    recordIds: z.array(z.string().max(80)).max(1000).optional(),
  })
  .strict();
export type ExportRequest = z.infer<typeof ExportRequestSchema>;

export const ExportResultSchema = z
  .object({
    id: z.string().uuid(),
    format: ExportFormatSchema,
    filename: z.string().regex(/^servrsit-activity-[0-9]{12}\.(txt|json)$/),
    mime: z.enum(["text/plain", "application/json"]),
    createdAt: IsoDate,
    expiresAt: IsoDate,
    from: IsoDate,
    to: IsoDate,
    timeZone: z.string().max(64),
    recordCount: z.number().int().nonnegative(),
    sizeBytes: z.number().int().nonnegative(),
    /** What was removed, in the API's own words. */
    redaction: z.string().max(300),
    downloadUrl: z.string().regex(/^\/api\/exports\/[0-9a-f-]{36}\/download$/),
  })
  .strict();
export type ExportResult = z.infer<typeof ExportResultSchema>;

export const ExportListSchema = z.object({ exports: z.array(ExportResultSchema).max(20) }).strict();
export type ExportList = z.infer<typeof ExportListSchema>;

export const ActivityErrorCodeSchema = z.enum(["INVALID_INPUT", "NOT_FOUND", "EXPIRED", "TOO_LARGE"]);
export type ActivityErrorCode = z.infer<typeof ActivityErrorCodeSchema>;
export const ActivityErrorSchema = z.object({ error: ActivityErrorCodeSchema, reason: z.string().max(300).optional() }).strict();
export type ActivityError = z.infer<typeof ActivityErrorSchema>;
