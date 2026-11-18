/**
 * Settings routes (T-079). Contract: packages/contracts/src/settings.ts.
 * The global auth guard (T-053) requires a session everywhere, and the CSRF
 * token and an allowed Origin on PUT and POST.
 *
 * A schedule only runs the read-only checks; nothing here can authorise a
 * change. Every setting change is kept in the settings history (who, when).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isValidTimeZone } from "@servrsit/ai";
import {
  AiRequestSchema,
  EXPORT_RETENTION_DAYS,
  INSPECTION_RETENTION_DAYS,
  OPERATION_HISTORY_DAYS,
  PauseRequestSchema,
  SCHEDULE_DEFAULTS,
  ScheduleRequestSchema,
  type AccessServer,
  type AiSettings,
  type DisconnectPreview,
  type ScheduleSettings,
  type SettingsData,
  type SettingsErrorCode,
} from "@servrsit/contracts";
import type { CareStore, SqliteSettingsStore, StoredServer } from "@servrsit/store";
import type { FleetService } from "../fleet/service.js";
import { PAUSE_KEY, pauseScheduler, resumeScheduler, type PausedSetting } from "./findings.js";

export const SCHEDULE_KEY = "schedule";
export const AI_KEY = "ai.enabled";

export interface StoredSchedule {
  readonly intervalMinutes: 5 | 15 | 30 | 60;
  readonly dailyTime: string;
  readonly timeZone: string;
}

/** Plain description of the configured AI provider. Never holds a key. */
export interface AiDescription {
  readonly available: boolean;
  readonly providerLabel: string;
  readonly route: string;
  readonly region: string | null;
}

export interface SettingsRouteOptions {
  readonly mode: "live" | "fixture";
  readonly settings: SqliteSettingsStore;
  readonly service: FleetService;
  readonly care: CareStore;
  readonly servers: () => readonly StoredServer[];
  readonly ai: AiDescription;
  readonly defaults: { readonly intervalMinutes: number; readonly timeZone: string };
  readonly owner: (request: FastifyRequest) => string;
  readonly now?: (() => Date) | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AI_SENDS = "Your question and the latest check results for the servers in scope, with known secrets removed. Never keys, passwords, file contents or logs.";
const OPERATION_TITLES: Readonly<Record<string, string>> = {
  "apply.packages.v1": "Update packages",
  "restart.service.v1": "Restart a service",
  "reboot.host.v1": "Reboot",
  "prepare.directories.v1": "Prepare directories",
};

function error(reply: FastifyReply, status: number, code: SettingsErrorCode, reason?: string) {
  return reply.code(status).header("cache-control", "no-store").send({ error: code, ...(reason === undefined ? {} : { reason }) });
}

/** Whether AI is on: the owner's choice, and only if a provider is configured. */
export function aiEnabled(settings: SqliteSettingsStore, ai: AiDescription): boolean {
  if (!ai.available) return false;
  return settings.get<boolean>(AI_KEY) ?? true;
}

export function storedSchedule(o: Pick<SettingsRouteOptions, "settings" | "defaults">): StoredSchedule {
  const s = o.settings.get<StoredSchedule>(SCHEDULE_KEY);
  if (s !== null) return s;
  const interval = [5, 15, 30, 60].includes(o.defaults.intervalMinutes) ? (o.defaults.intervalMinutes as StoredSchedule["intervalMinutes"]) : SCHEDULE_DEFAULTS.intervalMinutes;
  return { intervalMinutes: interval, dailyTime: SCHEDULE_DEFAULTS.dailyTime, timeZone: o.defaults.timeZone };
}

function data(o: SettingsRouteOptions): SettingsData {
  const sched = storedSchedule(o);
  const paused = o.settings.get<PausedSetting>(PAUSE_KEY);
  const schedule: ScheduleSettings = { ...sched, dailyTimeInEffect: false, paused: paused !== null, pausedSince: paused?.since ?? null };
  const ai: AiSettings = { enabled: aiEnabled(o.settings, o.ai), ...o.ai, sends: AI_SENDS };
  const servers: AccessServer[] = o.servers().map((s) => ({
    id: s.id,
    name: s.name,
    production: s.production,
    keyKind: s.access === "local" ? "local" : s.source === "registration" ? "dedicated ServrSit key" : "owner key",
    hostKeyConfirmedAt: s.hostKey?.confirmedAt ?? null,
    connected: s.disconnectedAt === null,
  }));
  return {
    schedule,
    ai,
    retention: { observationsDays: INSPECTION_RETENTION_DAYS, operationRecordsDays: OPERATION_HISTORY_DAYS, exportsDays: EXPORT_RETENTION_DAYS },
    servers,
  };
}

export async function settingsRoutes(fastify: FastifyInstance, o: SettingsRouteOptions): Promise<void> {
  const now = o.now ?? (() => new Date());
  const send = (reply: FastifyReply) => reply.header("cache-control", "no-store").send(data(o));

  fastify.setErrorHandler((err, request, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 400 && status < 500) return error(reply, 400, "INVALID_INPUT");
    request.log.error({ err }, "settings: request failed");
    return reply.code(500).send({ statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
  });

  fastify.get("/api/settings", async (_request, reply) => send(reply));

  fastify.put("/api/settings/schedule", { bodyLimit: 1024 }, async (request, reply) => {
    const parsed = ScheduleRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    if (!isValidTimeZone(parsed.data.timeZone)) return error(reply, 400, "INVALID_INPUT", "Unknown time zone.");
    const value = parsed.data as StoredSchedule;
    o.settings.set(SCHEDULE_KEY, value, `owner:${o.owner(request)}`, now());
    o.service.setIntervalMinutes(value.intervalMinutes);
    o.service.setOwnerTimeZone(value.timeZone);
    request.log.info({ intervalMinutes: value.intervalMinutes }, "settings: schedule saved");
    return send(reply);
  });

  fastify.post("/api/settings/schedule/pause", { bodyLimit: 256 }, async (request, reply) => {
    const parsed = PauseRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    if (o.mode === "fixture") return error(reply, 409, "NOT_ALLOWED", "Fixture mode: no checks run.");
    const actor = `owner:${o.owner(request)}`;
    if (parsed.data.paused) pauseScheduler(o, actor, undefined, now());
    else resumeScheduler(o, actor, now());
    return send(reply);
  });

  fastify.put("/api/settings/ai", { bodyLimit: 256 }, async (request, reply) => {
    const parsed = AiRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    if (parsed.data.enabled && !o.ai.available) return error(reply, 409, "NOT_ALLOWED", "No AI provider is configured on ServrSit, so AI cannot be turned on here.");
    o.settings.set(AI_KEY, parsed.data.enabled, `owner:${o.owner(request)}`, now());
    request.log.info({ aiEnabled: parsed.data.enabled }, "settings: AI setting saved");
    return send(reply);
  });

  fastify.get("/api/servers/:id/disconnect-preview", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const id = request.params.id;
    if (!UUID.test(id) || !o.servers().some((s) => s.id === id && s.disconnectedAt === null)) return error(reply, 404, "NOT_FOUND");
    const op = o.care.unresolvedFor(id);
    const item = op === null ? null : { id: op.id, title: OPERATION_TITLES[op.operation] ?? "Change" };
    const preview: DisconnectPreview = {
      queued: item !== null && op?.state === "queued" ? [item] : [],
      active: item !== null && op?.state !== "queued" ? [item] : [],
      canDisconnect: item === null,
    };
    return reply.header("cache-control", "no-store").send(preview);
  });
}

export default settingsRoutes;
