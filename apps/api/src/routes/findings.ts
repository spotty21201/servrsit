/**
 * Findings and scheduler API (T-076). Contract: packages/contracts/src/findings.ts.
 *
 * The global auth guard (T-053) requires a session on every route, and the
 * session's CSRF token and an allowed Origin on every POST. Acknowledge and
 * snooze never resolve a finding. Pause stops background checks only; it
 * never authorises or cancels anything else.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  SNOOZE_MS,
  SchedulerPauseRequestSchema,
  SnoozeRequestSchema,
  type FindingsErrorCode,
  type FindingsResponse,
  type SchedulerStatus,
} from "@servrsit/contracts";
import type { FleetResponse } from "@servrsit/contracts";
import type { SqliteFindingStore, SqliteSettingsStore } from "@servrsit/store";
import type { FindingTracker } from "../findings/tracker.js";
import type { FleetService } from "../fleet/service.js";

export const PAUSE_KEY = "scheduler.paused";
export const DEFAULT_PAUSE_REASON = "You paused checks.";
/** A pass more than this late counts as delayed. */
export const DELAY_GRACE_MS = 60_000;
export const EXTERNAL_ALERTS_REASON = "Email alerts are not available yet. Findings are kept here in ServrSit.";

export interface PausedSetting {
  readonly since: string;
  readonly reason: string;
}

export interface FindingRouteOptions {
  readonly mode: "live" | "fixture";
  readonly tracker: FindingTracker;
  readonly store: SqliteFindingStore;
  readonly settings: SqliteSettingsStore;
  readonly service: FleetService;
  readonly fleet: () => FleetResponse;
  readonly owner: (request: FastifyRequest) => string;
  readonly now?: (() => Date) | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type IdRequest = FastifyRequest<{ Params: { id: string } }>;

function error(reply: FastifyReply, status: number, code: FindingsErrorCode, reason?: string) {
  return reply.code(status).header("cache-control", "no-store").send({ error: code, ...(reason === undefined ? {} : { reason }) });
}

export function schedulerStatus(o: Pick<FindingRouteOptions, "mode" | "settings" | "service">, now: Date): SchedulerStatus {
  if (o.mode === "fixture") return { status: "unavailable", reason: "Fixture mode: no checks run." };
  const paused = o.settings.get<PausedSetting>(PAUSE_KEY);
  if (paused !== null) return { status: "paused", since: paused.since, reason: paused.reason };
  const s = o.service.schedulerState();
  if (!s.scheduled) return { status: "unavailable", reason: "Background checks are not running in this process." };
  if (s.passStartedAt !== null && now.getTime() - s.passStartedAt.getTime() > s.intervalMs) {
    return { status: "delayed", dueAt: new Date(s.passStartedAt.getTime() + s.intervalMs).toISOString() };
  }
  if (s.nextRunAt !== null && now.getTime() > s.nextRunAt.getTime() + DELAY_GRACE_MS) {
    return { status: "delayed", dueAt: s.nextRunAt.toISOString() };
  }
  return { status: "running", nextRunAt: s.nextRunAt?.toISOString() ?? null };
}

export async function findingRoutes(fastify: FastifyInstance, o: FindingRouteOptions): Promise<void> {
  const now = o.now ?? (() => new Date());

  fastify.setErrorHandler((err, request, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 400 && status < 500) return error(reply, 400, "INVALID_INPUT");
    request.log.error({ err }, "findings: request failed");
    return reply.code(500).send({ statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
  });

  const view = (id: string) => {
    const f = o.store.get(id);
    const s = f === null ? undefined : o.fleet().servers.find((x) => x.id === f.serverId);
    return f === null || s === undefined ? null : o.tracker.view(f, s.name, s.production, now());
  };

  fastify.get("/api/findings", async (_request, reply) => {
    const snapshot = o.fleet();
    const body: FindingsResponse = {
      mode: o.mode,
      findings: o.tracker.list(snapshot),
      scheduler: schedulerStatus(o, now()),
      externalAlerts: { available: false, reason: EXTERNAL_ALERTS_REASON },
    };
    return reply.header("cache-control", "no-store").send(body);
  });

  fastify.post("/api/findings/:id/acknowledge", { bodyLimit: 256 }, async (request: IdRequest, reply) => {
    if (!UUID.test(request.params.id) || view(request.params.id) === null) return error(reply, 404, "NOT_FOUND");
    const r = o.store.acknowledge(request.params.id, `owner:${o.owner(request)}`, now().toISOString());
    if (!r.ok) return error(reply, r.code === "NOT_FOUND" ? 404 : 409, r.code, r.code === "NOT_ALLOWED" ? "A resolved finding cannot be acknowledged." : undefined);
    return reply.header("cache-control", "no-store").send(view(r.finding.id));
  });

  fastify.post("/api/findings/:id/snooze", { bodyLimit: 256 }, async (request: IdRequest, reply) => {
    const parsed = SnoozeRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    if (!UUID.test(request.params.id) || view(request.params.id) === null) return error(reply, 404, "NOT_FOUND");
    const at = now();
    const until = new Date(at.getTime() + SNOOZE_MS[parsed.data.for]).toISOString();
    const r = o.store.snooze(request.params.id, until, `owner:${o.owner(request)}`, at.toISOString());
    if (!r.ok) return error(reply, r.code === "NOT_FOUND" ? 404 : 409, r.code, r.code === "NOT_ALLOWED" ? "A resolved finding cannot be snoozed." : undefined);
    return reply.header("cache-control", "no-store").send(view(r.finding.id));
  });

  fastify.get("/api/scheduler", async (_request, reply) => reply.header("cache-control", "no-store").send(schedulerStatus(o, now())));

  fastify.post("/api/scheduler/pause", { bodyLimit: 512 }, async (request, reply) => {
    const parsed = SchedulerPauseRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    if (o.mode === "fixture") return error(reply, 409, "UNAVAILABLE", "Fixture mode: no checks run.");
    if (o.settings.get<PausedSetting>(PAUSE_KEY) === null) {
      const at = now();
      o.settings.set(PAUSE_KEY, { since: at.toISOString(), reason: parsed.data.reason ?? DEFAULT_PAUSE_REASON }, `owner:${o.owner(request)}`, at);
    }
    o.service.pause();
    request.log.info({ scheduler: "paused" }, "findings: scheduler paused");
    return reply.header("cache-control", "no-store").send(schedulerStatus(o, now()));
  });

  fastify.post("/api/scheduler/resume", { bodyLimit: 256 }, async (request, reply) => {
    if (o.mode === "fixture") return error(reply, 409, "UNAVAILABLE", "Fixture mode: no checks run.");
    if (o.settings.get<PausedSetting>(PAUSE_KEY) !== null) o.settings.clear(PAUSE_KEY, `owner:${o.owner(request)}`, now());
    o.service.resume();
    request.log.info({ scheduler: "resumed" }, "findings: scheduler resumed");
    return reply.header("cache-control", "no-store").send(schedulerStatus(o, now()));
  });
}

export default findingRoutes;
