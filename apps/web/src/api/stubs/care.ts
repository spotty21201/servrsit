/**
 * STUB client for the care-loop API (T-060). Owner of apps/web/src/api/* is
 * Coder: this file exists only because no care client exists yet. Coder may
 * replace it; the screens depend only on the `CareClient` interface below.
 *
 * Mirrors apps/api/src/routes/care.ts (planView / operationView) by hand,
 * because apps/web depends on @servrsit/contracts, not on @servrsit/domain.
 * Responses are checked structurally; anything else is "invalid-response".
 *
 * Never throws: failures are result objects. Response bodies are untrusted and
 * are never copied into messages; only the fixed API error `code` is read.
 */

export interface PackageChange {
  readonly name: string;
  readonly arch: string;
  readonly from: string;
  readonly to: string;
}

/** A directory a setup plan would create (T-073, PRD FR-15). Existing directories are never changed. */
export interface PrepareDirectory {
  readonly path: string;
  readonly owner: string;
  readonly mode: string;
}

/**
 * Present only on a "prepare a server" plan. PROVISIONAL local type: the care
 * contract has no setup operation yet (CARE_OPERATIONS is apply.packages.v1
 * only). The canonical Plan review screen renders it when present.
 */
export interface PreparePlan {
  readonly baselineName: string;
  readonly baselineVersion: number;
  readonly referenceName: string;
  readonly directories: readonly PrepareDirectory[];
  /** Items left alone on purpose (conflicts), with the reason. */
  readonly leftAlone: readonly { readonly label: string; readonly reason: string }[];
}

export interface PlanBlocker {
  readonly code: string;
  readonly message: string;
}

export interface PlanView {
  readonly id: string;
  readonly version: number;
  readonly operation: string;
  readonly serverId: string;
  readonly production: boolean;
  readonly scope: {
    readonly packages: readonly PackageChange[];
    readonly includesServiceRestart: false;
    readonly includesReboot: false;
  };
  readonly preconditions: { readonly previewDigest: string };
  readonly verification: { readonly expectInstalled: Readonly<Record<string, string>> };
  readonly requiredAcknowledgements: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly blockers: readonly PlanBlocker[];
  readonly digest: string;
  readonly target: { readonly serverId: string; readonly name: string; readonly kind: string; readonly simulated: boolean };
  readonly approvable: boolean;
  /** Set only for a setup (prepare) plan. */
  readonly prepare?: PreparePlan;
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
    };

export interface CareClient {
  getPlan(id: string, signal?: AbortSignal): Promise<CareResult<PlanView>>;
  createPlan(serverId: string, signal?: AbortSignal): Promise<CareResult<PlanView>>;
  revisePlan(id: string, signal?: AbortSignal): Promise<CareResult<PlanView>>;
  approvePlan(id: string, body: ApprovalBody, signal?: AbortSignal): Promise<CareResult<ApprovalAccepted>>;
  getOperation(id: string, signal?: AbortSignal): Promise<CareResult<OperationView>>;
}

const KNOWN_CODES = new Set([
  "INVALID_INPUT", "NOT_FOUND", "CSRF_INVALID", "PLAN_NOT_FOUND", "PLAN_CHANGED", "PLAN_EXPIRED",
  "PLAN_BLOCKED", "WRITES_DISABLED", "ACK_REQUIRED", "TARGET_BUSY", "OUTCOME_UNKNOWN", "ALREADY_APPROVED",
]);

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 256 * 1024;
const STATES = new Set([
  "queued", "running", "verifying", "succeeded", "partially_succeeded", "failed", "cancelled_before_start", "outcome_unknown",
]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

export function isPlanView(v: unknown): v is PlanView {
  if (!isObj(v) || !isObj(v["scope"]) || !isObj(v["target"]) || !isObj(v["verification"])) return false;
  const pk = v["scope"]["packages"];
  return (
    isStr(v["id"]) && typeof v["version"] === "number" && isStr(v["digest"]) && isStr(v["createdAt"]) &&
    isStr(v["expiresAt"]) && typeof v["production"] === "boolean" && typeof v["approvable"] === "boolean" &&
    Array.isArray(pk) && pk.every((p) => isObj(p) && isStr(p["name"]) && isStr(p["arch"]) && isStr(p["from"]) && isStr(p["to"])) &&
    Array.isArray(v["blockers"]) && v["blockers"].every((b) => isObj(b) && isStr(b["code"]) && isStr(b["message"])) &&
    Array.isArray(v["requiredAcknowledgements"]) && isStr(v["target"]["name"]) && isStr(v["target"]["serverId"]) &&
    isObj(v["verification"]["expectInstalled"])
  );
}

export function isOperationView(v: unknown): v is OperationView {
  if (!isObj(v) || !isObj(v["operation"]) || !Array.isArray(v["events"])) return false;
  const op = v["operation"];
  return (
    isStr(op["id"]) && isStr(op["state"]) && STATES.has(op["state"]) && isStr(op["planId"]) && isStr(op["serverId"]) &&
    isStr(op["createdAt"]) && isStr(op["updatedAt"]) && typeof op["stopRequested"] === "boolean" &&
    v["events"].every((e) => isObj(e) && isStr(e["type"]) && isStr(e["at"]) && typeof e["seq"] === "number" && isObj(e["payload"]))
  );
}

function isAccepted(v: unknown): v is ApprovalAccepted {
  return isObj(v) && isStr(v["operationId"]) && isStr(v["state"]) && STATES.has(v["state"]) && typeof v["replayed"] === "boolean";
}

export interface CareClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly base?: string;
}

export function createCareClient(options: CareClientOptions = {}): CareClient {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = options.base ?? "";
  let csrf: { token: string; header: string } | null = null;

  async function call<T>(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown; csrf?: boolean },
    guard: (v: unknown) => v is T,
    signal?: AbortSignal,
  ): Promise<CareResult<T>> {
    if (signal?.aborted) return { ok: false, kind: "aborted" };
    const controller = new AbortController();
    let timedOut = false;
    const timer = globalThis.setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      if (init.csrf) {
        if (csrf === null) {
          const t = await doFetch(`${base}/api/csrf`, { method: "GET", cache: "no-store", credentials: "same-origin", signal: controller.signal });
          const j: unknown = t.ok ? JSON.parse(await t.text()) : null;
          if (!isObj(j) || !isStr(j["token"]) || !isStr(j["header"])) return { ok: false, kind: "http", status: t.status };
          csrf = { token: j["token"], header: j["header"] };
        }
        headers[csrf.header] = csrf.token;
      }
      const response = await doFetch(`${base}${path}`, {
        method: init.method,
        headers,
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      const text = await response.text();
      if (text.length > MAX_BYTES) return { ok: false, kind: "invalid-response" };
      let json: unknown = null;
      try { json = JSON.parse(text); } catch { json = null; }
      if (!response.ok) {
        const code = isObj(json) && isStr(json["error"]) && KNOWN_CODES.has(json["error"]) ? json["error"] : undefined;
        if (code === "CSRF_INVALID") csrf = null;
        return { ok: false, kind: "http", status: response.status, ...(code ? { code } : {}) };
      }
      return guard(json) ? { ok: true, data: json } : { ok: false, kind: "invalid-response" };
    } catch {
      if (timedOut) return { ok: false, kind: "timeout" };
      if (signal?.aborted) return { ok: false, kind: "aborted" };
      return { ok: false, kind: "network" };
    } finally {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  const enc = encodeURIComponent;
  return {
    getPlan: (id, s) => call(`/api/plans/${enc(id)}`, { method: "GET" }, isPlanView, s),
    createPlan: (serverId, s) =>
      call("/api/plans", { method: "POST", body: { operation: "apply.packages.v1", serverId } }, isPlanView, s),
    revisePlan: (id, s) => call(`/api/plans/${enc(id)}/revisions`, { method: "POST", body: {} }, isPlanView, s),
    approvePlan: (id, body, s) =>
      call(`/api/plans/${enc(id)}/approvals`, { method: "POST", body, csrf: true }, isAccepted, s),
    getOperation: (id, s) => call(`/api/operations/${enc(id)}`, { method: "GET" }, isOperationView, s),
  };
}
