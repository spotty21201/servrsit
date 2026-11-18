/**
 * Settings API (T-079, PRD FR-19/FR-21, FR-03; UX Spec §13.2, §14).
 *
 *   GET  /api/settings                                    -> 200 SettingsData
 *   PUT  /api/settings/schedule      ScheduleRequest      -> 200 SettingsData
 *   POST /api/settings/schedule/pause  PauseRequest       -> 200 SettingsData (same pause as /api/scheduler/*)
 *   PUT  /api/settings/ai            AiRequest            -> 200 SettingsData
 *   GET  /api/servers/:id/disconnect-preview              -> 200 DisconnectPreview
 *   POST /api/servers/:id/disconnect                      -> T-069 contract
 *
 * Rules: no schedule can authorise package installation, restart, reboot or
 * cleanup (a schedule only runs read-only checks). Turning AI off stops new
 * inference at the next message; everything else keeps working from the
 * checks. Disconnecting is refused while an operation on that server is not
 * resolved; the preview says which. Retention values are shown as
 * configured; they are not editable here.
 */

import { z } from "zod";

export const SCHEDULE_INTERVALS = [5, 15, 30, 60] as const;
export const SCHEDULE_DEFAULTS = { intervalMinutes: 15, dailyTime: "03:00" } as const;

const DailyTime = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

export const ScheduleSettingsSchema = z
  .object({
    intervalMinutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
    /** "HH:MM" in `timeZone`. */
    dailyTime: DailyTime,
    /**
     * False in Stage A: every check runs at the interval; there is no separate
     * daily deeper check yet, so dailyTime is kept but not used.
     */
    dailyTimeInEffect: z.boolean(),
    /** IANA zone; every time ServrSit shows or writes is given in it. */
    timeZone: z.string().min(1).max(64),
    paused: z.boolean(),
    pausedSince: z.string().datetime().nullable(),
  })
  .strict();
export type ScheduleSettings = z.infer<typeof ScheduleSettingsSchema>;

export const AiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** False when no provider is configured on the controller: AI cannot be turned on here. */
    available: z.boolean(),
    /** What answers questions, in plain words. */
    providerLabel: z.string().max(120),
    /** How the request reaches it. */
    route: z.string().max(200),
    region: z.string().max(64).nullable(),
    /** What is sent when AI is on (FR-21). */
    sends: z.string().max(300),
  })
  .strict();
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const AccessServerSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().max(64),
    production: z.boolean(),
    keyKind: z.enum(["dedicated ServrSit key", "owner key", "local"]),
    hostKeyConfirmedAt: z.string().datetime().nullable(),
    connected: z.boolean(),
  })
  .strict();
export type AccessServer = z.infer<typeof AccessServerSchema>;

export const SettingsDataSchema = z
  .object({
    schedule: ScheduleSettingsSchema,
    ai: AiSettingsSchema,
    retention: z
      .object({ observationsDays: z.number().int().positive(), operationRecordsDays: z.number().int().positive(), exportsDays: z.number().int().positive() })
      .strict(),
    servers: z.array(AccessServerSchema).max(50),
  })
  .strict();
export type SettingsData = z.infer<typeof SettingsDataSchema>;

export const ScheduleRequestSchema = z
  .object({
    intervalMinutes: z.number().int().refine((n) => (SCHEDULE_INTERVALS as readonly number[]).includes(n)),
    dailyTime: DailyTime,
    timeZone: z.string().min(1).max(64),
  })
  .strict();
export type ScheduleRequest = z.infer<typeof ScheduleRequestSchema>;

export const PauseRequestSchema = z.object({ paused: z.boolean() }).strict();
export type PauseRequest = z.infer<typeof PauseRequestSchema>;

export const AiRequestSchema = z.object({ enabled: z.boolean() }).strict();
export type AiRequest = z.infer<typeof AiRequestSchema>;

export const WorkItemSchema = z.object({ id: z.string().uuid(), title: z.string().max(120) }).strict();
export const DisconnectPreviewSchema = z
  .object({
    queued: z.array(WorkItemSchema).max(10),
    active: z.array(WorkItemSchema).max(10),
    /** False while any work above is not resolved: disconnect is refused until it is. */
    canDisconnect: z.boolean(),
  })
  .strict();
export type DisconnectPreview = z.infer<typeof DisconnectPreviewSchema>;

export const SettingsErrorCodeSchema = z.enum(["INVALID_INPUT", "NOT_FOUND", "NOT_ALLOWED"]);
export type SettingsErrorCode = z.infer<typeof SettingsErrorCodeSchema>;
export const SettingsErrorSchema = z.object({ error: SettingsErrorCodeSchema, reason: z.string().max(300).optional() }).strict();
