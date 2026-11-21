/**
 * Care loop API (T-048, Technical Spec §9, §13). BUILD ONLY.
 *
 *   POST /api/plans                      {operation, serverId} -> immutable plan v1 (or typed blockers)
 *   POST /api/plans/:id/revisions        new version from current facts (material change)
 *   GET  /api/plans/:id                  latest version
 *   POST /api/plans/:id/approvals        {planVersion, planDigest, idempotencyKey, acknowledgements}
 *   GET  /api/operations/:id             authoritative state and append-only events
 *
 * WRITE GATE (T-089, ADR-021): a real server's writesEnabled comes only from
 * the controller's config/writes.json, which allows Sentani alone and which no
 * route reads or changes. Every other real server stays blocked with
 * WRITES_DISABLED and is never contacted to prepare a plan. Where the gate is
 * open, the target is asked for a read-only preview (packages only; other
 * kinds get no preview and are blocked PLAN_UNAVAILABLE). Simulated servers,
 * injected in code, work as before.
 *
 * Auth (T-053): the global guard has already required a session for every
 * route here, and an allowed Origin plus the session's CSRF token for every
 * POST. The approving owner is taken from that session.
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApprovalRequestSchema, PlanRequestSchema, type ControllerClock, type PlanRequest } from "@servrsit/contracts";
import {
  buildDirectoriesPlan,
  buildPlan,
  buildRebootPlan,
  buildRestartPlan,
  directoryAllowed,
  installedFromPreview,
  isRestartableUnitName,
  packagesPreconditionDigest,
  resolveIdentities,
  type Plan,
} from "@servrsit/domain";
import type { ApprovalRejection, CareStore, StoredOperation, TargetKind } from "@servrsit/store";
import { Reconciler, SshWriteTarget, TransportError, type WriteTarget } from "@servrsit/worker";

export interface CareServer {
  readonly id: string;
  readonly name: string;
  readonly production: boolean;
  readonly kind: TargetKind;
  /** From controller configuration only (T-089: writes.json, Sentani only). Never from a request. */
  readonly writesEnabled: boolean;
  /** T-059: units the owner selected for this server; only these can be restarted. */
  readonly selectedServices?: readonly string[] | undefined;
  /** T-059: the login user, for directories under /home/<user>. */
  readonly user?: string | undefined;
}

export interface CareRouteOptions {
  readonly store: CareStore;
  readonly servers: () => readonly CareServer[];
  readonly targets: ReadonlyMap<string, WriteTarget>;
  /** The signed-in owner for this request (from the session the guard resolved). */
  readonly owner: (request: FastifyRequest) => string;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  /**
   * T-063: ServrSit's own clock. "untrusted" blocks planning and approval.
   * "not-checked" (tests, fixture mode) does not block.
   */
  readonly controllerClock?: (() => ControllerClock) | undefined;
  /**
   * T-078: receives the same plan builder the routes use, so other features
   * (baseline setup) create canonical plans through one path.
   */
  readonly exposePlanner?: ((create: (request: PlanRequest) => Promise<{ plan: Plan; view: ReturnType<typeof planView> } | null>) => void) | undefined;
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
/** T-058 (O2, Tech Spec §13): the target could not be reached while preparing or checking a plan. Nothing is stored. */
const routeUnavailable = (reply: FastifyReply) => reply.code(503).header("retry-after", "30").send({ error: "ROUTE_UNAVAILABLE" });

export async function careRoutes(fastify: FastifyInstance, o: CareRouteOptions): Promise<void> {
  const now = o.now ?? (() => new Date());
  const newId = o.newId ?? (() => randomUUID());
  const serverById = (id: string) => o.servers().find((s) => s.id === id);
  const clockStatus = () => o.controllerClock?.().status ?? "not-checked";
  // T-056: identities across every record, from what each target reports (host key + machine id).
  const identities = () =>
    resolveIdentities(
      o.servers().map((s) => {
        // A target that does not report an identity (for example a test double) is unverified.
        const t = o.targets.get(s.id);
        const seen = t !== undefined && typeof t.identity === "function" ? t.identity() : null;
        return { id: s.id, hostKeyFingerprint: seen?.hostKeyFingerprint ?? null, machineId: seen?.machineId ?? null };
      }),
    );

  fastify.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 400 && status < 500) return invalid(reply);
    request.log.error({ err: error }, "care: request failed");
    return reply.code(500).send({ statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
  });

  async function makePlan(id: string, version: number, server: CareServer, request: PlanRequest): Promise<Plan> {
    // Never contact a server whose writes are disabled.
    const target = o.targets.get(server.id);
    const mayPreview = server.writesEnabled && target !== undefined;
    const identity = identities().get(server.id);
    // T-056: busy if this record, or another record of the same machine, has unresolved work.
    const busy =
      o.store.unresolvedFor(server.id) ??
      (identity?.status === "verified" ? o.store.unresolvedForMachine(identity.canonicalId) : null);
    const common = {
      id,
      version,
      server: { id: server.id, production: server.production, writesEnabled: server.writesEnabled },
      unresolved: busy === null ? null : (busy.state as "queued" | "running" | "verifying" | "outcome_unknown"),
      now: now(),
      controllerClockTrusted: clockStatus() !== "untrusted",
      identity,
    };
    let plan: Plan;
    switch (request.operation) {
      case "apply.packages.v1":
        plan = buildPlan({ ...common, operation: "apply.packages.v1", preview: mayPreview ? await target.previewPackages() : null });
        break;
      case "restart.service.v1": {
        const selected = server.selectedServices ?? [];
        // Only a selected, well-formed unit is ever named to the target.
        const ask = mayPreview && selected.includes(request.unit) && isRestartableUnitName(request.unit);
        plan = buildRestartPlan({ ...common, unit: request.unit, selectedUnits: selected, preview: ask ? await target.previewService(request.unit) : null });
        break;
      }
      case "reboot.host.v1":
        plan = buildRebootPlan({ ...common, preview: mayPreview ? await target.previewBoot() : null });
        break;
      case "prepare.directories.v1": {
        const user = server.user ?? "";
        const ask = mayPreview && request.directories.every((d) => directoryAllowed(d, user));
        plan = buildDirectoriesPlan({
          ...common,
          requested: request.directories,
          user,
          preview: ask ? await target.previewDirectories(request.directories.map((d) => d.path)) : null,
        });
        break;
      }
    }
    o.store.insertPlan(plan);
    return plan;
  }

  /** The request a plan was made from, for a revision (same operation, same parameters). */
  function requestOf(p: Plan): PlanRequest {
    switch (p.operation) {
      case "apply.packages.v1":
        return { operation: p.operation, serverId: p.serverId };
      case "restart.service.v1":
        return { operation: p.operation, serverId: p.serverId, unit: p.scope.unit };
      case "reboot.host.v1":
        return { operation: p.operation, serverId: p.serverId };
      case "prepare.directories.v1":
        return { operation: p.operation, serverId: p.serverId, directories: [...p.scope.requested] };
    }
  }

  /** The target's current state digest for the kind of work a plan describes (T-054 re-check). */
  async function currentDigest(p: Plan, target: WriteTarget): Promise<string | null> {
    switch (p.operation) {
      case "apply.packages.v1": {
        const preview = await target.previewPackages();
        if (preview === null) return null;
        // T-089: a real target's plans carry the helper's own rule; recompute it the same way.
        if (preview.digestRule !== "installed-v1") return preview.stateDigest;
        const keys = p.scope.packages.map((c) => `${c.name}:${c.arch}`);
        return keys.length === 0 ? "none" : packagesPreconditionDigest(installedFromPreview(preview, keys));
      }
      case "restart.service.v1":
        return (await target.previewService(p.scope.unit))?.stateDigest ?? null;
      case "reboot.host.v1":
        return (await target.previewBoot())?.stateDigest ?? null;
      case "prepare.directories.v1":
        return (await target.previewDirectories(p.scope.requested.map((d) => d.path)))?.stateDigest ?? null;
    }
  }

  o.exposePlanner?.(async (request) => {
    const server = serverById(request.serverId);
    if (server === undefined) return null;
    const plan = await makePlan(newId(), 1, server, request);
    return { plan, view: planView(plan, server) };
  });

  fastify.post("/api/plans", { bodyLimit: 4096 }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = PlanRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const server = serverById(parsed.data.serverId);
    if (server === undefined) return notFound(reply);
    let plan: Plan;
    try {
      plan = await makePlan(newId(), 1, server, parsed.data);
    } catch (error) {
      if (error instanceof TransportError) return routeUnavailable(reply);
      throw error;
    }
    request.log.info({ planId: plan.id, blockers: plan.blockers.map((b) => b.code), kind: server.kind }, "care: plan created");
    return reply.code(201).send(planView(plan, server));
  });

  fastify.post("/api/plans/:id/revisions", { bodyLimit: 1024 }, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const current = o.store.getPlan(request.params.id);
    if (current === null) return notFound(reply);
    const server = serverById(current.serverId);
    if (server === undefined) return notFound(reply);
    let plan: Plan;
    try {
      plan = await makePlan(current.id, current.version + 1, server, requestOf(current));
    } catch (error) {
      if (error instanceof TransportError) return routeUnavailable(reply);
      throw error;
    }
    return reply.code(201).send(planView(plan, server));
  });

  fastify.get("/api/plans/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const plan = o.store.getPlan(request.params.id);
    const server = plan === null ? undefined : serverById(plan.serverId);
    if (plan === null || server === undefined) return notFound(reply);
    return reply.send(planView(plan, server));
  });

  fastify.post("/api/plans/:id/approvals", { bodyLimit: 4096 }, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const parsed = ApprovalRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply);
    const plan = o.store.getPlan(request.params.id);
    const server = plan === null ? undefined : serverById(plan.serverId);
    if (plan === null || server === undefined) return reply.code(404).send({ error: "PLAN_NOT_FOUND" });
    // T-063: re-check at approval time; the clock may have become untrusted since the plan was made.
    if (clockStatus() === "untrusted") {
      request.log.info({ planId: plan.id, result: "rejected", code: "CONTROLLER_CLOCK_UNTRUSTED" }, "care: approval");
      return reply.code(409).send({ error: "PLAN_BLOCKED", blockers: ["CONTROLLER_CLOCK_UNTRUSTED"] });
    }
    // T-056: re-check identity at approval time; only a confirmed identity can be approved, and its
    // canonical id carries the per-machine lock.
    const identity = server.writesEnabled ? identities().get(server.id) : undefined;
    if (identity !== undefined && identity.status !== "verified") {
      const code = identity.status === "ambiguous" ? "IDENTITY_AMBIGUOUS" : "IDENTITY_UNVERIFIED";
      return reply.code(409).send({ error: "PLAN_BLOCKED", blockers: [code] });
    }
    // T-054 (F2, Tech Spec §9.2): re-check the target at approval time. If its package state is no
    // longer the state the plan was prepared from, the plan is stale. Same rule as planning: a
    // server whose writes are disabled is never contacted. A repeat of an approval that already
    // exists is an idempotent replay (the state has moved on because it ran).
    const target = o.targets.get(server.id);
    const replay = o.store.hasApproval(plan.id, parsed.data.planVersion);
    // O-T1: a blocked plan is refused by the store with its own blockers (PLAN_BLOCKED); the target is not
    // asked, so a kind it cannot preview does not turn that refusal into PLAN_CHANGED.
    const latestPlan = o.store.getPlan(plan.id);
    const blocked = latestPlan !== null && latestPlan.version === parsed.data.planVersion && latestPlan.blockers.length > 0;
    if (!replay && !blocked && server.writesEnabled && target !== undefined) {
      const latest = latestPlan;
      let current: string | null = null;
      try {
        current = latest === null ? null : await currentDigest(latest, target);
      } catch (error) {
        if (error instanceof TransportError) return routeUnavailable(reply);
        throw error;
      }
      if (latest !== null && (current === null || current !== latest.preconditions.previewDigest)) {
        request.log.info({ planId: plan.id, result: "rejected", code: "PLAN_CHANGED" }, "care: approval");
        return reply.code(409).send({ error: "PLAN_CHANGED" });
      }
    }

    const result = o.store.approve({
      planId: plan.id,
      planVersion: parsed.data.planVersion,
      planDigest: parsed.data.planDigest,
      idempotencyKey: parsed.data.idempotencyKey,
      owner: o.owner(request),
      acknowledgements: parsed.data.acknowledgements,
      writesEnabled: server.writesEnabled,
      targetKind: server.kind,
      canonicalId: identity?.status === "verified" ? identity.canonicalId : null,
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

  // T-055 (FR-16, Tech Spec §11): a stop REQUEST. A flag and an event; never a kill. Something never
  // sent is cancelled before start; anything that may be on the target keeps going and the ledger
  // decides. Repeating it, or asking after the operation finished, is harmless.
  fastify.post("/api/operations/:id/stop-request", { bodyLimit: 1024 }, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const r = o.store.requestStop(request.params.id, "owner", now());
    request.log.info({ operationId: request.params.id, result: r.kind }, "care: stop request");
    if (r.kind === "not_found") return notFound(reply);
    // Already finished: nothing to stop. Accepted and harmless; a final record is never changed.
    const stop = r.kind === "final" ? "already-final" : r.operation.state === "cancelled_before_start" ? "cancelled" : "requested";
    return reply.header("cache-control", "no-store").send({ ...operationView(r.operation, o.store), stop });
  });

  // T-055 (FR-17, Tech Spec §13): reconcile against the target's ledger and installed state. Read-only
  // toward the target: it can never start, retry or stop a mutation. A server whose writes are
  // disabled is never contacted.
  fastify.post("/api/operations/:id/reconcile", { bodyLimit: 1024 }, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const op = o.store.getOperation(request.params.id);
    if (op === null) return notFound(reply);
    const server = serverById(op.serverId);
    // T-089: also after writes.json was closed, as long as the target can still read the ledger.
    const target = server === undefined ? undefined : o.targets.get(server.id);
    const canRead = server !== undefined && (server.writesEnabled || (target instanceof SshWriteTarget && target.connected));
    if (!canRead) {
      return reply.code(409).send({ error: "RECONCILE_UNAVAILABLE" });
    }
    const reconciled = await new Reconciler({ store: o.store, targets: o.targets, actor: "owner", now }).reconcile(op.id);
    request.log.info({ operationId: op.id, from: op.state, to: reconciled.state }, "care: reconcile");
    return reply.header("cache-control", "no-store").send(operationView(reconciled, o.store));
  });

  fastify.get("/api/operations/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const op = o.store.getOperation(request.params.id);
    if (op === null) return notFound(reply);
    return reply.header("cache-control", "no-store").send(operationView(op, o.store));
  });
}

export default careRoutes;
