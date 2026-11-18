/**
 * Server registration API (T-069). Contract: packages/contracts/src/servers.ts.
 *
 *   POST   /api/servers/drafts
 *   GET    /api/servers/drafts/:id
 *   DELETE /api/servers/drafts/:id
 *   POST   /api/servers/drafts/:id/host-key
 *   POST   /api/servers/drafts/:id/host-key/confirm
 *   POST   /api/servers/drafts/:id/access-key
 *   POST   /api/servers/drafts/:id/first-check
 *   GET    /api/servers/drafts/:id/first-check
 *   POST   /api/servers/drafts/:id/activate
 *   PATCH  /api/servers/:id
 *   POST   /api/servers/:id/disconnect
 *
 * Every state-changing route checks CSRF and Origin here unless `csrf` is
 * null, which is only correct where a global guard already enforces a
 * signed-in session, CSRF and Origin for every /api route (T-053).
 * No route accepts or returns a private key. Error bodies are the contract's
 * codes and fixed reasons, never server output.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  HostKeyConfirmRequestSchema,
  ServerDraftRequestSchema,
  ServerUpdateRequestSchema,
  ServerUpdateResponseSchema,
  type ServerRegistrationErrorCode,
} from "@servrsit/contracts";
import type { CsrfGuard } from "../csrf.js";
import type { Outcome, ServerRegistry } from "../servers/registry.js";

export interface ServerRouteOptions {
  readonly registry: ServerRegistry;
  /** null: a global auth guard already checks session, CSRF and Origin. */
  readonly csrf: CsrfGuard | null;
  readonly owner: (request: FastifyRequest) => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type IdRequest = FastifyRequest<{ Params: { id: string } }>;

function error(reply: FastifyReply, status: number, code: ServerRegistrationErrorCode, reason?: string) {
  return reply.code(status).header("cache-control", "no-store").send({ error: code, ...(reason === undefined ? {} : { reason }) });
}

function send<T>(reply: FastifyReply, outcome: Outcome<T>, status = 200, view: (v: T) => unknown = (v) => v) {
  if (!outcome.ok) return error(reply, outcome.status, outcome.error, outcome.reason);
  if (outcome.value === null) return reply.code(204).header("cache-control", "no-store").send();
  return reply.code(status).header("cache-control", "no-store").send(view(outcome.value));
}

export async function serverRoutes(fastify: FastifyInstance, o: ServerRouteOptions): Promise<void> {
  fastify.setErrorHandler((err, request, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 400 && status < 500) return error(reply, 400, "INVALID_INPUT");
    request.log.error({ err }, "servers: request failed");
    return reply.code(500).send({ statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
  });

  /** CSRF and Origin for every state-changing route in this plugin. */
  fastify.addHook("preHandler", async (request, reply) => {
    if (request.method === "GET" || request.method === "HEAD") return;
    if (o.csrf !== null && !o.csrf.check(request.headers)) {
      return reply.code(403).header("cache-control", "no-store").send({ error: "CSRF_INVALID" });
    }
  });

  const draftId = (request: IdRequest, reply: FastifyReply): string | null => {
    if (UUID.test(request.params.id)) return request.params.id;
    void error(reply, 404, "DRAFT_NOT_FOUND");
    return null;
  };

  fastify.post("/api/servers/drafts", { bodyLimit: 4096 }, async (request, reply) => {
    const parsed = ServerDraftRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    return send(reply, await o.registry.createDraft(o.owner(request), parsed.data), 201);
  });

  fastify.get("/api/servers/drafts/:id", async (request: IdRequest, reply) => {
    const id = draftId(request, reply);
    if (id === null) return reply;
    return send(reply, o.registry.getDraft(o.owner(request), id));
  });

  fastify.delete("/api/servers/drafts/:id", async (request: IdRequest, reply) => {
    const id = draftId(request, reply);
    if (id === null) return reply;
    return send(reply, await o.registry.deleteDraft(o.owner(request), id));
  });

  fastify.post("/api/servers/drafts/:id/host-key", { bodyLimit: 256 }, async (request: IdRequest, reply) => {
    const id = draftId(request, reply);
    if (id === null) return reply;
    return send(reply, await o.registry.scanHostKey(o.owner(request), id));
  });

  fastify.post("/api/servers/drafts/:id/host-key/confirm", { bodyLimit: 1024 }, async (request: IdRequest, reply) => {
    const id = draftId(request, reply);
    if (id === null) return reply;
    const parsed = HostKeyConfirmRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    return send(reply, await o.registry.confirmHostKey(o.owner(request), id, parsed.data.fingerprint));
  });

  fastify.post("/api/servers/drafts/:id/access-key", { bodyLimit: 256 }, async (request: IdRequest, reply) => {
    const id = draftId(request, reply);
    if (id === null) return reply;
    return send(reply, await o.registry.issueAccessKey(o.owner(request), id));
  });

  fastify.post("/api/servers/drafts/:id/first-check", { bodyLimit: 256 }, async (request: IdRequest, reply) => {
    const id = draftId(request, reply);
    if (id === null) return reply;
    return send(reply, await o.registry.startFirstCheck(o.owner(request), id), 202);
  });

  fastify.get("/api/servers/drafts/:id/first-check", async (request: IdRequest, reply) => {
    const id = draftId(request, reply);
    if (id === null) return reply;
    return send(reply, o.registry.getFirstCheck(o.owner(request), id));
  });

  fastify.post("/api/servers/drafts/:id/activate", { bodyLimit: 256 }, async (request: IdRequest, reply) => {
    const id = draftId(request, reply);
    if (id === null) return reply;
    return send(reply, o.registry.activate(o.owner(request), id), 201);
  });

  fastify.patch("/api/servers/:id", { bodyLimit: 1024 }, async (request: IdRequest, reply) => {
    if (!UUID.test(request.params.id)) return error(reply, 404, "SERVER_NOT_FOUND");
    const parsed = ServerUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "INVALID_INPUT");
    return send(reply, o.registry.update(o.owner(request), request.params.id, parsed.data), 200, (s) =>
      ServerUpdateResponseSchema.parse({ id: s.id, name: s.name, role: s.role, production: s.production }),
    );
  });

  fastify.post("/api/servers/:id/disconnect", { bodyLimit: 256 }, async (request: IdRequest, reply) => {
    if (!UUID.test(request.params.id)) return error(reply, 404, "SERVER_NOT_FOUND");
    return send(reply, await o.registry.disconnect(o.owner(request), request.params.id));
  });
}

export default serverRoutes;
