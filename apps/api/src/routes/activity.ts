/**
 * Activity history and export routes (T-077). Contract:
 * packages/contracts/src/activity.ts. The global auth guard (T-053) requires
 * a session everywhere, and the CSRF token and an allowed Origin on POST.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isValidTimeZone } from "@servrsit/ai";
import { ActivityQuerySchema, ExportRequestSchema, type ActivityErrorCode } from "@servrsit/contracts";
import type { ActivityService } from "../activity/history.js";

export interface ActivityRouteOptions {
  readonly service: ActivityService;
  readonly owner: (request: FastifyRequest) => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function error(reply: FastifyReply, status: number, code: ActivityErrorCode, reason?: string) {
  return reply.code(status).header("cache-control", "no-store").send({ error: code, ...(reason === undefined ? {} : { reason }) });
}

export async function activityRoutes(fastify: FastifyInstance, o: ActivityRouteOptions): Promise<void> {
  fastify.setErrorHandler((err, request, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 400 && status < 500) return error(reply, 400, "INVALID_INPUT");
    request.log.error({ err }, "activity: request failed");
    return reply.code(500).send({ statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
  });

  fastify.get("/api/activity", async (request, reply) => {
    const parsed = ActivityQuerySchema.safeParse(request.query);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    return reply.header("cache-control", "no-store").send(o.service.list(parsed.data));
  });

  fastify.post("/api/exports", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const parsed = ExportRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    if (!isValidTimeZone(parsed.data.timeZone)) return error(reply, 400, "INVALID_INPUT", "Unknown time zone.");
    if (parsed.data.from > parsed.data.to) return error(reply, 400, "INVALID_INPUT", "The range ends before it starts.");
    const result = o.service.createExport(parsed.data, o.owner(request));
    if (result === null) return error(reply, 413, "TOO_LARGE", "The export would be too large. Choose a shorter range.");
    request.log.info({ exportId: result.id, records: result.recordCount, format: result.format }, "activity: export created");
    return reply.code(201).header("cache-control", "no-store").send(result);
  });

  fastify.get("/api/exports", async (_request, reply) => reply.header("cache-control", "no-store").send({ exports: o.service.listExports() }));

  fastify.get("/api/exports/:id/download", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    if (!UUID.test(request.params.id)) return error(reply, 404, "NOT_FOUND");
    const r = o.service.download(request.params.id);
    if (r.kind === "missing") return error(reply, 404, "NOT_FOUND");
    if (r.kind === "expired") return error(reply, 410, "EXPIRED", "This export has expired. Create a new one.");
    return reply
      .header("cache-control", "no-store")
      .header("content-type", `${r.meta.mime}; charset=utf-8`)
      .header("content-disposition", `attachment; filename="${r.meta.filename}"`)
      .header("x-content-type-options", "nosniff")
      .send(r.content);
  });
}

export default activityRoutes;
