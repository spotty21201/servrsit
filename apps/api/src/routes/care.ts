/**
 * Care loop API (T-048, Technical Spec §9, §13). BUILD ONLY.
 *
 *   GET  /api/csrf                       token for the X-CSRF-Token header
 *   POST /api/plans                      {operation, serverId} -> immutable plan v1 (or typed blockers)
 *   POST /api/plans/:id/revisions        new version from current facts (material change)
 *   GET  /api/plans/:id                  latest version
 *   POST /api/plans/:id/approvals        {planVersion, planDigest, idempotencyKey, acknowledgements}
 *   GET  /api/operations/:id             authoritative state and append-only events
 *
 * HARD GATE: every real server has writesEnabled=false (configuration can only
 * say false, and no route can change it), so every plan for a real server is
 * blocked with WRITES_DISABLED and no approval can succeed. A real server is
 * never contacted to prepare a plan. Only simulated servers, injected in code,
 * can be approved and dispatched.
 *
 * Auth is the stub (D3). The owner is fixed until Cognito sessions (T-023).
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApprovalRequestSchema, PlanRequestSchema } from "@servrsit/contracts";
import { buildPlan, type Plan } from "@servrsit/domain";
import type { ApprovalRejection, CareStore, StoredOperation, TargetKind } from "@servrsit/store";
import type { WriteTarget } from "@servrsit/worker";
import { CSRF_HEADER, type CsrfGuard } from "../csrf.js";

export interface CareServer {
  readonly id: string;
  readonly name: string;
  readonly production: boolean;
  readonly kind: TargetKind;
  /** From configuration only. Always false for real servers. */
  readonly writesEnabled: boolean;
}

export interface CareRouteOptions {
  readonly store: CareStore;
  readonly servers: () => readonly CareServer[];
  readonly targets: ReadonlyMap<string, WriteTarget>;
  readonly csrf: CsrfGuard;
  readonly owner: () => string;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
}

const STATUS: Readonly<Record<ApprovalRejection, number>> = {
  PLAN_NOT_FOUND: 404,
  PLAN_CHANGED: 409,
  PLAN_EXPIRED: 409,
  PLAN_BLOCKED: 409,
  WRITES_DISABLED: 403,
  ACK_REQUIRED: 422,
  TARGET_BUSY: 409,
  OUTCOME_UNKNOWN: 409,
  ALREADY_APPROVED: 409,
};

function planView(plan: Plan, server: CareServer) {
  return {
    ...plan,
    target: { serverId: server.id, name: server.name, kind: server.kind, simulated: server.kind === "simulated" },
    approvable: plan.blockers.length === 0,
  };
}

function operationView(op: StoredOperation, store: CareStore) {
  return {
    operation: { ...op, simulated: op.targetKind === "simulated" },
    events: store.listEvents(op.id),
  };
}

const invalid = (reply: FastifyReply) => reply.code(400).send({ error: "INVALID_INPUT" });
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "NOT_FOUND" });

export async function careRoutes(fastify: FastifyInstance, o: CareRouteOptions): Promise<void> {
  const now = o.now ?? (() => new Date());
  const newId = o.newId ?? (() => randomUUID());
  const serverById = (id: string) => o.servers().find((s) => s.id === id);

  fastify.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 400 && status < 500) return invalid(reply);
    request.log.error({ err: error }, "care: request failed");
    return reply.code(500).send({ statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
  });

  async function makePlan(id: string, version: number, server: CareServer): Promise<Plan> {
    // Never contact a server whose writes are disabled, and never a real one.
    const target = o.targets.get(server.id);
    const preview =
      server.writesEnabled && server.kind === "simulated" && target !== undefined ? await target.previewPackages() : null;
    const unresolved = o.store.unresolvedFor(server.id);
    const plan = buildPlan({
      id,
      version,
      operation: "apply.packages.v1",
      server: { id: server.id, production: server.production, writesEnabled: server.writesEnabled },
      preview,
      unresolved: unresolved === null ? null : (unresolved.state as "queued" | "running" | "verifying" | "outcome_unknown"),
      now: now(),
    });
    o.store.insertPlan(plan);
    return plan;
  }

  fastify.get("/api/csrf", async (_request, reply) =>
    reply.header("cache-control", "no-store").send({ token: o.csrf.token, header: CSRF_HEADER }),
  );

  fastify.post("/api/plans", { bodyLimit: 4096 }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = PlanRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const server = serverById(parsed.data.serverId);
    if (server === undefined) return notFound(reply);
    const plan = await makePlan(newId(), 1, server);
    request.log.info({ planId: plan.id, blockers: plan.blockers.map((b) => b.code), kind: server.kind }, "care: plan created");
    return reply.code(201).send(planView(plan, server));
  });

  fastify.post("/api/plans/:id/revisions", { bodyLimit: 1024 }, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const current = o.store.getPlan(request.params.id);
    if (current === null) return notFound(reply);
    const server = serverById(current.serverId);
    if (server === undefined) return notFound(reply);
    const plan = await makePlan(current.id, current.version + 1, server);
    return reply.code(201).send(planView(plan, server));
  });

  fastify.get("/api/plans/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const plan = o.store.getPlan(request.params.id);
    const server = plan === null ? undefined : serverById(plan.serverId);
    if (plan === null || server === undefined) return notFound(reply);
    return reply.send(planView(plan, server));
  });

  fastify.post("/api/plans/:id/approvals", { bodyLimit: 4096 }, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    if (!o.csrf.check(request.headers)) return reply.code(403).send({ error: "CSRF_INVALID" });
    const parsed = ApprovalRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const plan = o.store.getPlan(request.params.id);
    const server = plan === null ? undefined : serverById(plan.serverId);
    if (plan === null || server === undefined) return reply.code(404).send({ error: "PLAN_NOT_FOUND" });

    const result = o.store.approve({
      planId: plan.id,
      planVersion: parsed.data.planVersion,
      planDigest: parsed.data.planDigest,
      idempotencyKey: parsed.data.idempotencyKey,
      owner: o.owner(),
      acknowledgements: parsed.data.acknowledgements,
      writesEnabled: server.writesEnabled,
      targetKind: server.kind,
      now: now(),
      newId,
    });
    request.log.info({ planId: plan.id, result: result.kind, code: result.kind === "rejected" ? result.code : null }, "care: approval");

    if (result.kind === "rejected") {
      return reply.code(STATUS[result.code]).send({ error: result.code, ...(result.blockers ? { blockers: result.blockers } : {}) });
    }
    return reply
      .code(result.kind === "created" ? 201 : 200)
      .send({ operationId: result.operation.id, state: result.operation.state, replayed: result.kind === "replayed" });
  });

  fastify.get("/api/operations/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const op = o.store.getOperation(request.params.id);
    if (op === null) return notFound(reply);
    return reply.header("cache-control", "no-store").send(operationView(op, o.store));
  });
}

export default careRoutes;
