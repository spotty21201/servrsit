/**
 * Baselines client (T-078). Data layer only; contract in
 * packages/contracts/src/baselines.ts.
 *
 * Same interface as the Designer's stub (apps/web/src/api/stubs/baselines.ts),
 * with the same return shapes (arrays of candidates and comparison rows), so
 * the screen switches by swapping the factory. Added: `listBaselines`, and
 * the full responses (`candidatesResponse`, `comparison`) for screens that
 * show the observation time, source and notes.
 */

import {
  BaselineErrorSchema,
  BaselineSchema,
  BaselineServerSchema,
  CandidatesResponseSchema,
  ComparisonSchema,
  HistoryEventSchema,
  SetupPlanResultSchema,
  type Baseline,
  type BaselineErrorCode,
  type BaselineServer,
  type Candidate,
  type CandidatesResponse,
  type Comparison,
  type ComparisonRow,
  type HistoryEvent,
  type SetupPlanResult,
} from "@servrsit/contracts";
import { createHttp, type HttpOptions, type HttpResult, type Parser, type TransportErrorCode } from "./http";

export type { Baseline, BaselineServer, Candidate, CandidatesResponse, Comparison, ComparisonRow, HistoryEvent, SetupPlanResult };

export type BaselinesClientError = BaselineErrorCode | TransportErrorCode;
export type BaselinesResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: BaselinesClientError; readonly reason?: string };

export interface BaselinesClient {
  listServers(): Promise<BaselinesResult<readonly BaselineServer[]>>;
  listBaselines(): Promise<BaselinesResult<readonly Baseline[]>>;
  listCandidates(referenceId: string): Promise<BaselinesResult<readonly Candidate[]>>;
  candidatesResponse(referenceId: string): Promise<BaselinesResult<CandidatesResponse>>;
  saveBaseline(input: { name: string; referenceId: string; conventionIds: readonly string[]; baselineId?: string }): Promise<BaselinesResult<Baseline>>;
  compare(baselineId: string, targetId: string): Promise<BaselinesResult<readonly ComparisonRow[]>>;
  comparison(baselineId: string, targetId: string): Promise<BaselinesResult<Comparison>>;
  /** Records the exception only. Never changes the server. */
  markIntentional(baselineId: string, targetId: string, conventionId: string, reason: string | null): Promise<BaselinesResult<readonly ComparisonRow[]>>;
  unmarkIntentional(baselineId: string, targetId: string, conventionId: string): Promise<BaselinesResult<readonly ComparisonRow[]>>;
  history(baselineId: string, targetId: string): Promise<BaselinesResult<readonly HistoryEvent[]>>;
  /** Opens at /plans/:planId, the same Plan review used for updates. */
  createSetupPlan(baselineId: string, targetId: string): Promise<BaselinesResult<SetupPlanResult>>;
}

type ApiResult<T> = HttpResult<T, { error: BaselineErrorCode; reason?: string | undefined }>;

function flatten<T, U = T>(r: ApiResult<T>, map: (v: T) => U = (v) => v as unknown as U): BaselinesResult<U> {
  if (r.ok) return { ok: true, data: map(r.data) };
  const e = r.error as { error: BaselinesClientError; reason?: string };
  return { ok: false, error: e.error, ...(e.reason === undefined ? {} : { reason: e.reason }) };
}

function wrapped<T>(key: string, item: Parser<T>): Parser<T[]> {
  return {
    safeParse(v: unknown) {
      const list = (v as Record<string, unknown> | null)?.[key];
      if (typeof v !== "object" || v === null || Object.keys(v).length !== 1 || !Array.isArray(list)) return { success: false };
      const out: T[] = [];
      for (const x of list) {
        const p = item.safeParse(x);
        if (!p.success) return { success: false };
        out.push(p.data);
      }
      return { success: true, data: out };
    },
  };
}

export function createBaselinesClient(options: HttpOptions = {}): BaselinesClient {
  const call = createHttp(options);
  const e = encodeURIComponent;
  const err = BaselineErrorSchema;
  const comparison = async (baselineId: string, targetId: string) =>
    flatten(await call("POST", `/api/baselines/${e(baselineId)}/compare`, { targetId }, ComparisonSchema, err));
  const candidatesResponse = async (referenceId: string) =>
    flatten(await call("GET", `/api/baselines/candidates?reference=${e(referenceId)}`, undefined, CandidatesResponseSchema, err));
  return {
    listServers: async () => flatten(await call("GET", "/api/baselines/servers", undefined, wrapped("servers", BaselineServerSchema), err)),
    listBaselines: async () => flatten(await call("GET", "/api/baselines", undefined, wrapped("baselines", BaselineSchema), err)),
    candidatesResponse,
    listCandidates: async (referenceId) => {
      const r = await candidatesResponse(referenceId);
      return r.ok ? { ok: true, data: r.data.candidates } : r;
    },
    saveBaseline: async (input) => flatten(await call("POST", "/api/baselines", { ...input, conventionIds: [...input.conventionIds] }, BaselineSchema, err)),
    comparison,
    compare: async (baselineId, targetId) => {
      const r = await comparison(baselineId, targetId);
      return r.ok ? { ok: true, data: r.data.rows } : r;
    },
    markIntentional: async (baselineId, targetId, conventionId, reason) =>
      flatten(await call("PUT", `/api/baselines/${e(baselineId)}/exceptions`, { targetId, conventionId, reason }, ComparisonSchema, err), (c) => c.rows),
    unmarkIntentional: async (baselineId, targetId, conventionId) =>
      flatten(await call("DELETE", `/api/baselines/${e(baselineId)}/exceptions/${e(targetId)}/${e(conventionId)}`, undefined, ComparisonSchema, err), (c) => c.rows),
    history: async (baselineId, targetId) =>
      flatten(await call("GET", `/api/baselines/${e(baselineId)}/history?target=${e(targetId)}`, undefined, wrapped("events", HistoryEventSchema), err)),
    createSetupPlan: async (baselineId, targetId) =>
      flatten(await call("POST", `/api/baselines/${e(baselineId)}/setup-plan`, { targetId }, SetupPlanResultSchema, err)),
  };
}
