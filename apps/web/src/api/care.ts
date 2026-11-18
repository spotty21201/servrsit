/**
 * Care-loop client (T-082). Data layer only. Mirrors apps/api/src/routes/care.ts.
 *
 * Same `CareClient` interface and result shape as the Designer's stub
 * (apps/web/src/api/stubs/care.ts), so screens switch by changing the import.
 * Added: `createActionPlan` (restart, reboot, prepare directories),
 * `requestStop` and `reconcile`, and `newIdempotencyKey`.
 *
 *  - Every POST carries the signed-in session's CSRF header (./auth) and an
 *    allowed Origin is the browser's own. A 403 CSRF_INVALID re-reads the
 *    session once and retries: the server refused before doing anything.
 *  - An approval carries an idempotency key. Keep the same key when retrying
 *    the same approval: the API then returns the same operation (`replayed`),
 *    never a second one. Make a new key only for a new decision.
 *  - Responses are checked structurally; anything else is "invalid-response".
 *    Only known fixed error codes are passed on; bodies are never shown.
 *  - Never throws.
 */

import { CARE_OPERATIONS, type PlanRequest } from "@servrsit/contracts";
import { sessionCsrf, type CsrfSource } from "./http";

export interface PackageChange {
  readonly name: string;
  readonly arch: string;
  readonly from: string;
  readonly to: string;
}

export interface PlanBlocker {
  readonly code: string;
  readonly message: string;
}

export interface PlanView {
  readonly id: string;
  readonly version: number;
  readonly operation: (typeof CARE_OPERATIONS)[number];
  readonly serverId: string;
  readonly production: boolean;
  /**
   * For package plans, the packages. For the other kinds `packages` is an
   * empty list and `detail` holds that kind's own scope (unit, directories).
   */
  readonly scope: {
    readonly packages: readonly PackageChange[];
    readonly includesServiceRestart: boolean;
    readonly includesReboot: boolean;
  };
  /** The plan's full scope as the API sent it, for kinds other than packages. */
  readonly detail: Readonly<Record<string, unknown>>;
  readonly preconditions: { readonly previewDigest: string };
  readonly verification: Readonly<Record<string, unknown>> & { readonly expectInstalled: Readonly<Record<string, string>> };
  readonly requiredAcknowledgements: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly blockers: readonly PlanBlocker[];
  readonly digest: string;
  readonly target: { readonly serverId: string; readonly name: string; readonly kind: string; readonly simulated: boolean };
  readonly approvable: boolean;
}

export type OperationStateName =
  | "queued"
  | "running"
  | "verifying"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled_before_start"
  | "outcome_unknown";

export interface OperationRecord {
  readonly id: string;
  readonly approvalId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly serverId: string;
  readonly operation: string;
  readonly targetKind: string;
  readonly state: OperationStateName;
  readonly stopRequested: boolean;
  readonly remoteOperationId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly simulated: boolean;
}

export interface OperationEventView {
  readonly operationId: string;
  readonly seq: number;
  readonly type: string;
  readonly at: string;
  readonly actor: string;
  readonly fromState: OperationStateName | null;
  readonly toState: OperationStateName | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface OperationView {
  readonly operation: OperationRecord;
  readonly events: readonly OperationEventView[];
}

/** POST /api/operations/:id/stop-request: never a kill; `stop` says what happened. */
export interface StopView extends OperationView {
  readonly stop: "requested" | "cancelled" | "already-final";
}

export interface ApprovalBody {
  readonly planVersion: number;
  readonly planDigest: string;
  readonly idempotencyKey: string;
  readonly acknowledgements: readonly string[];
}

export interface ApprovalAccepted {
  readonly operationId: string;
  readonly state: OperationStateName;
  readonly replayed: boolean;
}

export type CareFailureKind = "network" | "timeout" | "http" | "invalid-response" | "aborted";

export type CareResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly kind: CareFailureKind;
      readonly status?: number;
      /** API error code (for example PLAN_CHANGED), only if it is one of the known fixed codes. */
      readonly code?: string;
      /** Plan blocker codes the API listed with PLAN_BLOCKED. */
      readonly blockers?: readonly string[];
    };

export interface CareClient {
  getPlan(id: string, signal?: AbortSignal): Promise<CareResult<PlanView>>;
  /** A package update plan for this server. */
  createPlan(serverId: string, signal?: AbortSignal): Promise<CareResult<PlanView>>;
  /** Any supported kind: packages, restart a selected unit, reboot, prepare directories. */
  createActionPlan(request: PlanRequest, signal?: AbortSignal): Promise<CareResult<PlanView>>;
  /** A new version from current facts; the old version can no longer be approved. */
  revisePlan(id: string, signal?: AbortSignal): Promise<CareResult<PlanView>>;
  approvePlan(id: string, body: ApprovalBody, signal?: AbortSignal): Promise<CareResult<ApprovalAccepted>>;
  getOperation(id: string, signal?: AbortSignal): Promise<CareResult<OperationView>>;
  requestStop(id: string, signal?: AbortSignal): Promise<CareResult<StopView>>;
  /** Read the target's ledger again. Never starts, retries or stops anything. */
  reconcile(id: string, signal?: AbortSignal): Promise<CareResult<OperationView>>;
}

export const CARE_ERROR_CODES: ReadonlySet<string> = new Set([
  "INVALID_INPUT", "NOT_FOUND", "CSRF_INVALID", "UNAUTHENTICATED", "PLAN_NOT_FOUND", "PLAN_CHANGED", "PLAN_EXPIRED",
  "PLAN_BLOCKED", "WRITES_DISABLED", "ACK_REQUIRED", "TARGET_BUSY", "OUTCOME_UNKNOWN", "ALREADY_APPROVED",
  "ROUTE_UNAVAILABLE", "RECONCILE_UNAVAILABLE",
]);

export const CARE_TIMEOUT_MS = 10_000;
const MAX_BYTES = 256 * 1024;
const STATES: ReadonlySet<string> = new Set([
  "queued", "running", "verifying", "succeeded", "partially_succeeded", "failed", "cancelled_before_start", "outcome_unknown",
]);
const OPERATIONS: ReadonlySet<string> = new Set(CARE_OPERATIONS);
const BLOCKER_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** A fresh idempotency key for one approval decision (16..64 URL-safe characters). */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return `ui-${s}`;
}

function packagesOf(v: unknown): PackageChange[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const out: PackageChange[] = [];
  for (const p of v) {
    if (!isObj(p) || !isStr(p["name"]) || !isStr(p["arch"]) || !isStr(p["from"]) || !isStr(p["to"])) return null;
    out.push({ name: p["name"], arch: p["arch"], from: p["from"], to: p["to"] });
  }
  return out;
}

/** Structural check plus normalisation (non-package kinds get `packages: []`). Null when invalid. */
export function toPlanView(v: unknown): PlanView | null {
  if (!isObj(v) || !isObj(v["scope"]) || !isObj(v["target"]) || !isObj(v["verification"]) || !isObj(v["preconditions"])) return null;
  const scope = v["scope"];
  const target = v["target"];
  const op = v["operation"];
  if (!isStr(op) || !OPERATIONS.has(op)) return null;
  const packages = packagesOf(scope["packages"]);
  if (packages === null) return null;
  if (op === "apply.packages.v1" && scope["packages"] === undefined) return null;
  const blockers = v["blockers"];
  if (!Array.isArray(blockers) || !blockers.every((b) => isObj(b) && isStr(b["code"]) && isStr(b["message"]))) return null;
  const acks = v["requiredAcknowledgements"];
  if (!Array.isArray(acks) || !acks.every(isStr)) return null;
  const expect = v["verification"]["expectInstalled"];
  if (expect !== undefined && (!isObj(expect) || !Object.values(expect).every(isStr))) return null;
  if (
    !isStr(v["id"]) || typeof v["version"] !== "number" || !isStr(v["serverId"]) || typeof v["production"] !== "boolean" ||
    !isStr(v["digest"]) || !isStr(v["createdAt"]) || !isStr(v["expiresAt"]) || typeof v["approvable"] !== "boolean" ||
    !isStr(v["preconditions"]["previewDigest"]) || !isStr(target["serverId"]) || !isStr(target["name"]) || !isStr(target["kind"]) ||
    typeof target["simulated"] !== "boolean"
  ) {
    return null;
  }
  return {
    id: v["id"],
    version: v["version"],
    operation: op as PlanView["operation"],
    serverId: v["serverId"],
    production: v["production"],
    scope: { packages, includesServiceRestart: scope["includesServiceRestart"] === true, includesReboot: scope["includesReboot"] === true },
    detail: scope,
    preconditions: { previewDigest: v["preconditions"]["previewDigest"] },
    verification: { ...v["verification"], expectInstalled: (expect ?? {}) as Record<string, string> },
    requiredAcknowledgements: acks,
    createdAt: v["createdAt"],
    expiresAt: v["expiresAt"],
    blockers: blockers as PlanBlocker[],
    digest: v["digest"],
    target: { serverId: target["serverId"], name: target["name"], kind: target["kind"], simulated: target["simulated"] },
    approvable: v["approvable"],
  };
}

export function isPlanView(v: unknown): boolean {
  return toPlanView(v) !== null;
}

export function isOperationView(v: unknown): v is OperationView {
  if (!isObj(v) || !isObj(v["operation"]) || !Array.isArray(v["events"])) return false;
  const op = v["operation"];
  return (
    isStr(op["id"]) && isStr(op["state"]) && STATES.has(op["state"]) && isStr(op["planId"]) && isStr(op["serverId"]) &&
    isStr(op["operation"]) && isStr(op["targetKind"]) && typeof op["simulated"] === "boolean" &&
    isStr(op["createdAt"]) && isStr(op["updatedAt"]) && typeof op["stopRequested"] === "boolean" &&
    v["events"].every((e) => isObj(e) && isStr(e["type"]) && isStr(e["at"]) && typeof e["seq"] === "number" && isObj(e["payload"]))
  );
}

function isStopView(v: unknown): v is StopView {
  return isOperationView(v) && isObj(v) && (v["stop"] === "requested" || v["stop"] === "cancelled" || v["stop"] === "already-final");
}

function isAccepted(v: unknown): v is ApprovalAccepted {
  return isObj(v) && isStr(v["operationId"]) && isStr(v["state"]) && STATES.has(v["state"]) && typeof v["replayed"] === "boolean";
}

export interface CareClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly base?: string;
  readonly csrf?: CsrfSource;
  readonly timeoutMs?: number;
}

type Reader<T> = (v: unknown) => T | null;
const guardReader = <T>(g: (v: unknown) => v is T): Reader<T> => (v) => (g(v) ? v : null);

export function createCareClient(options: CareClientOptions = {}): CareClient {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = options.base ?? "";
  const csrf = options.csrf ?? sessionCsrf;
  const timeoutMs = options.timeoutMs ?? CARE_TIMEOUT_MS;

  async function once<T>(path: string, method: "GET" | "POST", body: unknown, read: Reader<T>, signal?: AbortSignal): Promise<CareResult<T>> {
    if (signal?.aborted) return { ok: false, kind: "aborted" };
    const controller = new AbortController();
    let timedOut = false;
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (method === "POST") Object.assign(headers, await csrf.headers());
      const response = await doFetch(`${base}${path}`, {
        method,
        headers,
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      if (text.length > MAX_BYTES) return { ok: false, kind: "invalid-response" };
      let json: unknown = null;
      try {
        json = text === "" ? null : JSON.parse(text);
      } catch {
        json = null;
      }
      if (!response.ok) {
        const code = isObj(json) && isStr(json["error"]) && CARE_ERROR_CODES.has(json["error"]) ? json["error"] : undefined;
        const blockers =
          code === "PLAN_BLOCKED" && isObj(json) && Array.isArray(json["blockers"]) ? json["blockers"].filter((b): b is string => isStr(b) && BLOCKER_CODE.test(b)) : undefined;
        return { ok: false, kind: "http", status: response.status, ...(code === undefined ? {} : { code }), ...(blockers === undefined ? {} : { blockers }) };
      }
      const data = read(json);
      return data === null ? { ok: false, kind: "invalid-response" } : { ok: true, data };
    } catch {
      if (timedOut) return { ok: false, kind: "timeout" };
      if (signal?.aborted) return { ok: false, kind: "aborted" };
      return { ok: false, kind: "network" };
    } finally {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function call<T>(path: string, method: "GET" | "POST", body: unknown, read: Reader<T>, signal?: AbortSignal): Promise<CareResult<T>> {
    const first = await once(path, method, body, read, signal);
    if (first.ok || first.code !== "CSRF_INVALID") return first;
    try {
      await csrf.refresh?.();
    } catch {
      return first;
    }
    return once(path, method, body, read, signal);
  }

  const enc = encodeURIComponent;
  return {
    getPlan: (id, s) => call(`/api/plans/${enc(id)}`, "GET", undefined, toPlanView, s),
    createPlan: (serverId, s) => call("/api/plans", "POST", { operation: "apply.packages.v1", serverId }, toPlanView, s),
    createActionPlan: (request, s) => call("/api/plans", "POST", request, toPlanView, s),
    revisePlan: (id, s) => call(`/api/plans/${enc(id)}/revisions`, "POST", {}, toPlanView, s),
    approvePlan: (id, body, s) =>
      call(`/api/plans/${enc(id)}/approvals`, "POST", { ...body, acknowledgements: [...body.acknowledgements] }, guardReader(isAccepted), s),
    getOperation: (id, s) => call(`/api/operations/${enc(id)}`, "GET", undefined, guardReader(isOperationView), s),
    requestStop: (id, s) => call(`/api/operations/${enc(id)}/stop-request`, "POST", {}, guardReader(isStopView), s),
    reconcile: (id, s) => call(`/api/operations/${enc(id)}/reconcile`, "POST", {}, guardReader(isOperationView), s),
  };
}
