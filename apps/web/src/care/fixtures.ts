/**
 * [FIXTURE DATA]
 *
 * Synthetic plans and operations for states the live API cannot produce yet
 * (no real server has writes enabled). Open them at /plans/fixture-… and
 * /operations/fixture-…; both screens show the [FIXTURE DATA] banner for these
 * ids. Server names are prefixed "Fixture" so they cannot be mistaken for the
 * founder's machines. Nothing here contacts anything.
 *
 * `createFixtureClient` implements CareClient, including approval behaviours:
 *   fixture-plan-ready / -production  approve -> fixture-op-queued
 *   fixture-plan-lost                 first approve loses its response, the retry
 *                                     with the same key replays the operation
 *   fixture-plan-changed              approve -> PLAN_CHANGED; refresh -> version 2
 */
import { gate } from "../lib/fixtureState";
import { STRESS } from "../fixtures/stressFleet";
import { PRODUCTION_ACKNOWLEDGEMENTS } from "@servrsit/contracts";
import type {
  ApprovalBody, CareClient, CareResult, OperationEventView, OperationStateName, OperationView, PlanView, StopView,
} from "../api/care";

export const FIXTURE_PREFIX = "fixture-";
export const isFixtureId = (id: string): boolean => id.startsWith(FIXTURE_PREFIX);

const SHA = (c: string): string => `sha256:${c.repeat(64)}`;
const iso = (now: Date, deltaSec: number): string => new Date(now.getTime() + deltaSec * 1000).toISOString();

const PKGS = [
  { name: "curl", arch: "amd64", from: "8.5.0-2ubuntu10.5", to: "8.5.0-2ubuntu10.6" },
  { name: "libssl3t64", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5" },
  { name: "openssh-server", arch: "amd64", from: "1:9.6p1-3ubuntu13.5", to: "1:9.6p1-3ubuntu13.8" },
];

function basePlan(now: Date, over: Partial<PlanView> & { name: string; production: boolean; id: string }): PlanView {
  const { name, production, id, ...rest } = over;
  return {
    id, version: 1, operation: "apply.packages.v1", serverId: `00000000-0000-4000-8000-${id.length.toString().padStart(12, "0")}`,
    production,
    scope: { packages: PKGS, includesServiceRestart: false, includesReboot: false },
    detail: {},
    preconditions: { previewDigest: SHA("c") },
    verification: { expectInstalled: Object.fromEntries(PKGS.map((p) => [`${p.name}:${p.arch}`, p.to])) },
    requiredAcknowledgements: production ? [...PRODUCTION_ACKNOWLEDGEMENTS] : [],
    createdAt: iso(now, -180), expiresAt: iso(now, 12 * 60), blockers: [], digest: SHA(production ? "d" : "e"),
    target: { serverId: "00000000-0000-4000-8000-000000000000", name, kind: "simulated", simulated: true },
    approvable: true,
    ...rest,
  };
}

export function fixturePlans(now: Date): Record<string, PlanView> {
  const mk = (id: string, name: string, production: boolean, over: Partial<PlanView> = {}): PlanView =>
    basePlan(now, { id, name, production, ...over });
  const writesOff = mk("fixture-plan-writes-off", "Fixture Timika", true, {
    scope: { packages: [], includesServiceRestart: false, includesReboot: false },
    preconditions: { previewDigest: "none" }, verification: { expectInstalled: {} }, approvable: false,
    blockers: [{ code: "WRITES_DISABLED", message: "Changes are disabled for this server until disposable-server tests pass and live work is authorized." }],
    target: { serverId: "00000000-0000-4000-8000-000000000001", name: "Fixture Timika", kind: "ssh", simulated: false },
  });
  const DIRS = [
    { path: "/srv/app", owner: "deploy", group: "deploy", mode: "0755" },
    { path: "/srv/backups/app", owner: "root", group: "root", mode: "0750" },
  ];
  const EXISTING = ["/srv/tools"];
  const prepareScope = { packages: [], includesServiceRestart: false, includesReboot: false } as const;
  const prepareDetail = { requested: [...DIRS, { path: "/srv/tools", owner: "alice", group: "alice", mode: "0700" }], directories: DIRS, existing: EXISTING };
  const prepare = mk("fixture-plan-prepare", "Fixture Dev-2", false, {
    operation: "prepare.directories.v1", scope: prepareScope, detail: prepareDetail,
    verification: { expectInstalled: {}, expectDirectories: DIRS },
  });
  const prepareBlocked = mk("fixture-plan-prepare-blocked", "Fixture Web-2", true, {
    operation: "prepare.directories.v1", scope: prepareScope, detail: prepareDetail,
    preconditions: { previewDigest: "none" }, verification: { expectInstalled: {}, expectDirectories: DIRS }, approvable: false,
    blockers: [{ code: "WRITES_DISABLED", message: "Changes are disabled for this server until disposable-server tests pass and live work is authorized." }],
    target: { serverId: "00000000-0000-4000-8000-000000000002", name: "Fixture Web-2", kind: "ssh", simulated: false },
  });
  const restart = mk("fixture-plan-restart", "Fixture Nabire", false, {
    operation: "restart.service.v1", scope: { packages: [], includesServiceRestart: true, includesReboot: false }, detail: { unit: "nginx.service", includesServiceRestart: true, includesReboot: false },
    verification: { expectInstalled: {}, unit: "nginx.service", previousActiveSince: "Mon 2026-11-16 02:11:40 WIB" },
  });
  const reboot = mk("fixture-plan-reboot", "Fixture Timika", true, {
    operation: "reboot.host.v1", scope: { packages: [], includesServiceRestart: false, includesReboot: true }, detail: { includesServiceRestart: false, includesReboot: true },
    verification: { expectInstalled: {}, previousBootId: "d7c54a08-c253-4dc9-9791-f8015b9cdac0" },
  });
  const LONG_PKGS = [
    { name: STRESS.LONG_PKG, arch: "amd64", from: STRESS.LONG_VERSION, to: `${STRESS.LONG_VERSION}.1` },
    { name: "libssl3t64", arch: "amd64", from: "3.0.13-0ubuntu3.4+really.long.build.metadata.0123456789abcdef", to: "3.0.13-0ubuntu3.5+really.long.build.metadata.0123456789abcdef" },
  ];
  const long = mk("fixture-plan-long", STRESS.LONG_NAME, true, {
    scope: { packages: LONG_PKGS, includesServiceRestart: false, includesReboot: false },
    verification: { expectInstalled: Object.fromEntries(LONG_PKGS.map((p) => [`${p.name}:${p.arch}`, p.to])) },
  });
  return {
    "fixture-plan-long": long,
    "fixture-plan-restart": restart,
    "fixture-plan-reboot": reboot,
    "fixture-plan-prepare": prepare,
    "fixture-plan-prepare-blocked": prepareBlocked,
    "fixture-plan-ready": mk("fixture-plan-ready", "Fixture Nabire", false),
    "fixture-plan-production": mk("fixture-plan-production", "Fixture Timika", true),
    "fixture-plan-lost": mk("fixture-plan-lost", "Fixture Merauke", false),
    "fixture-plan-changed": mk("fixture-plan-changed", "Fixture Nabire", false),
    "fixture-plan-expired": mk("fixture-plan-expired", "Fixture Nabire", false, { createdAt: iso(now, -16 * 60), expiresAt: iso(now, -60) }),
    "fixture-plan-busy": mk("fixture-plan-busy", "Fixture Sentani", false, {
      approvable: false, blockers: [{ code: "TARGET_BUSY", message: "Another operation on this server has not finished." }],
    }),
    "fixture-plan-writes-off": writesOff,
  };
}

/** Version 2 of fixture-plan-changed: one package dropped, one version moved, one added. */
export function changedPlanV2(now: Date): PlanView {
  const pk = [
    { ...PKGS[0]!, to: "8.5.0-2ubuntu10.7" },
    PKGS[2]!,
    { name: "tzdata", arch: "all", from: "2024a-3ubuntu1.1", to: "2025b-0ubuntu0.24.04.1" },
  ];
  return basePlan(now, {
    id: "fixture-plan-changed", name: "Fixture Nabire", production: false, version: 2, digest: SHA("f"),
    scope: { packages: pk, includesServiceRestart: false, includesReboot: false },
    verification: { expectInstalled: Object.fromEntries(pk.map((p) => [`${p.name}:${p.arch}`, p.to])) },
  });
}

type Ev = { type: string; at: number; from?: OperationStateName | null; to?: OperationStateName | null; payload?: Record<string, unknown> };

function ops(now: Date): Record<string, OperationView> {
  const keys = PKGS.map((p) => `${p.name}:${p.arch}`);
  const build = (id: string, state: OperationStateName, startedAgoSec: number, evs: Ev[], over: Partial<OperationView["operation"]> = {}): OperationView => ({
    operation: {
      id, approvalId: `${id}-approval`, planId: "fixture-plan-production", planVersion: 1, serverId: "00000000-0000-4000-8000-000000000000",
      operation: "apply.packages.v1", targetKind: "simulated", state, stopRequested: false, remoteOperationId: `${id}-remote`,
      createdAt: iso(now, -startedAgoSec), updatedAt: iso(now, evs.length ? Math.max(...evs.map((e) => e.at)) - startedAgoSec : -startedAgoSec),
      simulated: true, ...over,
    },
    events: evs.map((e, i) => ({
      operationId: id, seq: i + 1, type: e.type, at: iso(now, e.at - startedAgoSec), actor: "worker:fixture",
      fromState: e.from ?? null, toState: e.to ?? null, payload: e.payload ?? {},
    })),
  });
  const created: Ev = { type: "created", at: 0, to: "queued" };
  const dispatch: Ev = { type: "dispatch_attempted", at: 2 };
  const accepted: Ev = { type: "remote_accepted", at: 4, from: "queued", to: "running", payload: { how: "submitted", remoteState: "running" } };
  const finished: Ev = { type: "remote_finished", at: 71, from: "running", to: "verifying", payload: { remoteState: "finished", exitCode: 0 } };
  const verifiedAll = (extra: Record<string, unknown> = {}): Ev => ({ type: "verification_recorded", at: 76, from: "verifying", to: "succeeded", payload: { verified: keys, notVerified: [], exitCode: 0, ...extra } });
  return {
    "fixture-op-queued": build("fixture-op-queued", "queued", 6, [created]),
    "fixture-op-running": build("fixture-op-running", "running", 40, [created, dispatch, accepted, { type: "remote_progress", at: 30, payload: {} }]),
    "fixture-op-running-stop": build("fixture-op-running-stop", "running", 40, [created, dispatch, accepted, { type: "stop_requested", at: 35 }], { stopRequested: true }),
    "fixture-op-verifying": build("fixture-op-verifying", "verifying", 80, [created, dispatch, accepted, finished]),
    "fixture-op-succeeded": build("fixture-op-succeeded", "succeeded", 100, [created, dispatch, accepted, finished, verifiedAll()]),
    "fixture-op-succeeded-reboot": build("fixture-op-succeeded-reboot", "succeeded", 100, [created, dispatch, accepted, finished, verifiedAll({ rebootRequired: true })]),
    "fixture-op-partial": build("fixture-op-partial", "partially_succeeded", 100, [created, dispatch, accepted, finished, {
      type: "verification_recorded", at: 76, from: "verifying", to: "partially_succeeded", payload: { verified: keys.slice(0, 2), notVerified: keys.slice(2), exitCode: 100 },
    }]),
    "fixture-op-failed": build("fixture-op-failed", "failed", 30, [created, dispatch, {
      type: "remote_rejected", at: 5, from: "queued", to: "failed", payload: { code: "PACKAGE_LOCKED", effects: "none: the target did not accept the operation" },
    }]),
    "fixture-op-cancelled": build("fixture-op-cancelled", "cancelled_before_start", 900, [created, {
      type: "cancelled", at: 840, from: "queued", to: "cancelled_before_start", payload: { code: "PLAN_EXPIRED", effects: "none: nothing was sent" },
    }]),
    "fixture-op-restart-succeeded": build("fixture-op-restart-succeeded", "succeeded", 60, [created, dispatch, accepted, { type: "remote_finished", at: 20, from: "running", to: "verifying", payload: { remoteState: "finished", exitCode: 0 } }, {
      type: "verification_recorded", at: 24, from: "verifying", to: "succeeded", payload: { verified: ["nginx.service"], notVerified: [], exitCode: 0 },
    }], { planId: "fixture-plan-restart", operation: "restart.service.v1" }),
    "fixture-op-reboot-running": build("fixture-op-reboot-running", "running", 50, [created, dispatch, accepted, { type: "transport_error", at: 30, payload: { during: "progress" } }], { planId: "fixture-plan-reboot", operation: "reboot.host.v1" }),
    "fixture-op-dirs-partial": build("fixture-op-dirs-partial", "partially_succeeded", 90, [created, dispatch, accepted, { type: "remote_finished", at: 30, from: "running", to: "verifying", payload: { remoteState: "finished", exitCode: 0 } }, {
      type: "verification_recorded", at: 34, from: "verifying", to: "partially_succeeded", payload: { verified: ["/srv/app"], notVerified: ["/srv/backups/app"], exitCode: 0 },
    }], { planId: "fixture-plan-prepare", operation: "prepare.directories.v1" }),
    "fixture-op-unknown": build("fixture-op-unknown", "outcome_unknown", 200, [created, dispatch, accepted, { type: "transport_error", at: 50, payload: { during: "progress" } }, {
      type: "outcome_unknown", at: 60, from: "running", to: "outcome_unknown", payload: { reason: "the ledger could not be queried" },
    }]),
  };
}

export function createFixtureClient(now: () => Date = () => new Date()): CareClient {
  const t0 = now();
  const plans = fixturePlans(t0);
  const operations = ops(t0);
  let lostOnce = true;
  let changedServed = false;
  const nf: CareResult<never> = { ok: false, kind: "http", status: 404, code: "NOT_FOUND" };
  return {
    async getPlan(id) {
      return gate<CareResult<PlanView>>(() => {
        if (id === "fixture-plan-changed" && changedServed) return { ok: true, data: changedPlanV2(t0) };
        const p = plans[id];
        return p ? { ok: true, data: p } : nf;
      }, () => ({ ok: false, kind: "network" }));
    },
    async createPlan() { return nf; },
    async createActionPlan() { return nf; },
    async revisePlan(id) {
      const p = plans[id];
      if (!p) return nf;
      if (id === "fixture-plan-changed") { changedServed = true; return { ok: true, data: changedPlanV2(t0) }; }
      const n = now();
      return { ok: true, data: { ...p, version: p.version + 1, createdAt: n.toISOString(), expiresAt: new Date(n.getTime() + 15 * 60_000).toISOString(), digest: SHA("9") } };
    },
    async approvePlan(id, _body: ApprovalBody) {
      await new Promise((r) => globalThis.setTimeout(r, 700));
      if (id === "fixture-plan-changed") { changedServed = true; return { ok: false, kind: "http", status: 409, code: "PLAN_CHANGED" }; }
      if (id === "fixture-plan-lost" && lostOnce) { lostOnce = false; return { ok: false, kind: "network" }; }
      const replay = id === "fixture-plan-lost";
      return { ok: true, data: { operationId: "fixture-op-queued", state: "queued", replayed: replay } };
    },
    async getOperation(id) {
      return gate<CareResult<OperationView>>(() => { const o = operations[id]; return o ? { ok: true, data: o } : nf; }, () => ({ ok: false, kind: "network" }));
    },
    async requestStop(id): Promise<CareResult<StopView>> {
      const o = operations[id];
      if (!o) return nf;
      const st = o.operation.state;
      const stamp = now().toISOString();
      const ev = (type: string, from: OperationStateName | null, to: OperationStateName | null): OperationEventView => ({ operationId: id, seq: o.events.length + 1, type, at: stamp, actor: "owner:fixture", fromState: from, toState: to, payload: {} });
      if (st === "queued") {
        const next: OperationView = { operation: { ...o.operation, state: "cancelled_before_start", updatedAt: stamp }, events: [...o.events, ev("cancelled", "queued", "cancelled_before_start")] };
        operations[id] = next;
        return { ok: true, data: { ...next, stop: "cancelled" } };
      }
      if (st === "running" || st === "verifying") {
        const next: OperationView = { operation: { ...o.operation, stopRequested: true, updatedAt: stamp }, events: [...o.events, ev("stop_requested", null, null)] };
        operations[id] = next;
        return { ok: true, data: { ...next, stop: "requested" } };
      }
      return { ok: true, data: { ...o, stop: "already-final" } };
    },
    async reconcile(id) {
      const o = operations[id];
      // The fixture's ledger cannot be read, so a recheck leaves an unknown outcome unknown.
      return o ? { ok: true, data: o } : nf;
    },
  };
}

export const FIXTURE_INDEX: ReadonlyArray<{ group: string; ids: readonly string[] }> = [
  { group: "Plans", ids: ["fixture-plan-ready", "fixture-plan-production", "fixture-plan-lost", "fixture-plan-changed", "fixture-plan-expired", "fixture-plan-busy", "fixture-plan-writes-off", "fixture-plan-restart", "fixture-plan-reboot", "fixture-plan-prepare", "fixture-plan-prepare-blocked", "fixture-plan-long"] },
  { group: "Operations", ids: ["fixture-op-queued", "fixture-op-running", "fixture-op-running-stop", "fixture-op-verifying", "fixture-op-succeeded", "fixture-op-succeeded-reboot", "fixture-op-restart-succeeded", "fixture-op-reboot-running", "fixture-op-dirs-partial", "fixture-op-partial", "fixture-op-failed", "fixture-op-cancelled", "fixture-op-unknown"] },
];

/** The plan record an operation fixture was approved from. */
export const fixturePlanFor = (opId: string): string =>
  opId === "fixture-op-restart-succeeded" ? "fixture-plan-restart"
  : opId === "fixture-op-reboot-running" ? "fixture-plan-reboot"
  : opId === "fixture-op-dirs-partial" ? "fixture-plan-prepare"
  : "fixture-plan-production";
