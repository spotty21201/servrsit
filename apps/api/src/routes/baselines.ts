/**
 * Baseline routes (T-078). Contract: packages/contracts/src/baselines.ts.
 * The global auth guard (T-053) requires a session everywhere, and the CSRF
 * token and an allowed Origin on POST, PUT and DELETE.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  CompareRequestSchema,
  ExceptionRequestSchema,
  SaveBaselineRequestSchema,
  type BaselineErrorCode,
} from "@servrsit/contracts";
import type { BaselineService, Out } from "../baselines/service.js";

export interface BaselineRouteOptions {
  readonly service: BaselineService;
  readonly owner: (request: FastifyRequest) => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type IdRequest = FastifyRequest<{ Params: { id: string } }>;

function error(reply: FastifyReply, status: number, code: BaselineErrorCode, reason?: string) {
  return reply.code(status).header("cache-control", "no-store").send({ error: code, ...(reason === undefined ? {} : { reason }) });
}

function send<T>(reply: FastifyReply, out: Out<T>, status = 200, view: (v: T) => unknown = (v) => v) {
  if (!out.ok) return error(reply, out.status, out.error, out.reason);
  return reply.code(status).header("cache-control", "no-store").send(view(out.value));
}

export async function baselineRoutes(fastify: FastifyInstance, o: BaselineRouteOptions): Promise<void> {
  fastify.setErrorHandler((err, request, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 400 && status < 500) return error(reply, 400, "INVALID_INPUT");
    request.log.error({ err }, "baselines: request failed");
    return reply.code(500).send({ statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
  });

  const id = (request: IdRequest, reply: FastifyReply): string | null => {
    if (UUID.test(request.params.id)) return request.params.id;
    void error(reply, 404, "NOT_FOUND");
    return null;
  };

  fastify.get("/api/baselines/servers", async (_request, reply) =>
    reply.header("cache-control", "no-store").send({ servers: o.service.listServers().map(({ user: _user, ...s }) => s) }),
  );

  fastify.get("/api/baselines", async (_request, reply) => reply.header("cache-control", "no-store").send({ baselines: o.service.list() }));

  fastify.get("/api/baselines/candidates", async (request: FastifyRequest<{ Querystring: { reference?: string } }>, reply) => {
    const ref = request.query.reference;
    if (typeof ref !== "string" || !UUID.test(ref)) return error(reply, 400, "INVALID_INPUT");
    return send(reply, await o.service.candidates(ref));
  });

  fastify.post("/api/baselines", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const parsed = SaveBaselineRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    return send(reply, o.service.save(parsed.data, `owner:${o.owner(request)}`), 201);
  });

  fastify.get("/api/baselines/:id", async (request: IdRequest, reply) => {
    const b = id(request, reply);
    return b === null ? reply : send(reply, o.service.get(b));
  });

  fastify.post("/api/baselines/:id/compare", { bodyLimit: 1024 }, async (request: IdRequest, reply) => {
    const b = id(request, reply);
    if (b === null) return reply;
    const parsed = CompareRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    return send(reply, await o.service.compare(b, parsed.data.targetId));
  });

  fastify.put("/api/baselines/:id/exceptions", { bodyLimit: 2048 }, async (request: IdRequest, reply) => {
    const b = id(request, reply);
    if (b === null) return reply;
    const parsed = ExceptionRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    return send(reply, await o.service.setException(b, parsed.data.targetId, parsed.data.conventionId, parsed.data.reason, `owner:${o.owner(request)}`));
  });

  fastify.delete(
    "/api/baselines/:id/exceptions/:targetId/:conventionId",
    async (request: FastifyRequest<{ Params: { id: string; targetId: string; conventionId: string } }>, reply) => {
      const { id: b, targetId, conventionId } = request.params;
      if (!UUID.test(b) || !UUID.test(targetId) || conventionId.length > 300) return error(reply, 404, "NOT_FOUND");
      return send(reply, await o.service.setException(b, targetId, conventionId, undefined, `owner:${o.owner(request)}`));
    },
  );

  fastify.get("/api/baselines/:id/history", async (request: FastifyRequest<{ Params: { id: string }; Querystring: { target?: string } }>, reply) => {
    const b = id(request, reply);
    if (b === null) return reply;
    const target = request.query.target;
    if (target !== undefined && !UUID.test(target)) return error(reply, 400, "INVALID_INPUT");
    return send(reply, o.service.history(b, target ?? null), 200, (events) => ({ events }));
  });

  fastify.post("/api/baselines/:id/setup-plan", { bodyLimit: 1024 }, async (request: IdRequest, reply) => {
    const b = id(request, reply);
    if (b === null) return reply;
    const parsed = CompareRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    return send(reply, await o.service.setupPlan(b, parsed.data.targetId, `owner:${o.owner(request)}`), 201);
  });
}

export default baselineRoutes;
