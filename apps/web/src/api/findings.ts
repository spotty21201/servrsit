/**
 * Findings and scheduler client (T-076). Data layer only; contract in
 * packages/contracts/src/findings.ts.
 *
 * Same interface as the Designer's stub (apps/web/src/api/stubs/findings.ts):
 * `list`, `acknowledge`, `snooze`, with errors as plain codes. Added for the
 * schedule controls: `scheduler`, `pause`, `resume`.
 */

import {
  FindingRecordSchema,
  FindingsErrorSchema,
  FindingsResponseSchema,
  SchedulerStatusSchema,
  type FindingRecord,
  type FindingsErrorCode,
  type FindingsResponse,
  type SchedulerStatus,
  type SnoozeFor,
} from "@servrsit/contracts";
import { createHttp, type HttpOptions, type HttpResult, type TransportErrorCode } from "./http";

export type { FindingRecord, FindingsResponse, SchedulerStatus, SnoozeFor };

export type FindingsClientError = FindingsErrorCode | TransportErrorCode;
export type FindingsResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: FindingsClientError; readonly reason?: string };

export interface FindingsClient {
  list(): Promise<FindingsResult<FindingsResponse>>;
  /** Records that the owner has seen it. Never resolves it. */
  acknowledge(id: string): Promise<FindingsResult<FindingRecord>>;
  /** Delays attention only. */
  snooze(id: string, forDuration: SnoozeFor): Promise<FindingsResult<FindingRecord>>;
  scheduler(): Promise<FindingsResult<SchedulerStatus>>;
  pause(reason?: string): Promise<FindingsResult<SchedulerStatus>>;
  /** Runs one current check, then the normal interval. */
  resume(): Promise<FindingsResult<SchedulerStatus>>;
}

function flatten<T>(r: HttpResult<T, { error: FindingsErrorCode; reason?: string | undefined }>): FindingsResult<T> {
  if (r.ok) return { ok: true, data: r.data };
  const e = r.error as { error: FindingsClientError; reason?: string };
  return { ok: false, error: e.error, ...(e.reason === undefined ? {} : { reason: e.reason }) };
}

export function createFindingsClient(options: HttpOptions = {}): FindingsClient {
  const call = createHttp(options);
  const e = encodeURIComponent;
  return {
    list: async () => flatten(await call("GET", "/api/findings", undefined, FindingsResponseSchema, FindingsErrorSchema)),
    acknowledge: async (id) => flatten(await call("POST", `/api/findings/${e(id)}/acknowledge`, undefined, FindingRecordSchema, FindingsErrorSchema)),
    snooze: async (id, f) => flatten(await call("POST", `/api/findings/${e(id)}/snooze`, { for: f }, FindingRecordSchema, FindingsErrorSchema)),
    scheduler: async () => flatten(await call("GET", "/api/scheduler", undefined, SchedulerStatusSchema, FindingsErrorSchema)),
    pause: async (reason) => flatten(await call("POST", "/api/scheduler/pause", reason === undefined ? {} : { reason }, SchedulerStatusSchema, FindingsErrorSchema)),
    resume: async () => flatten(await call("POST", "/api/scheduler/resume", undefined, SchedulerStatusSchema, FindingsErrorSchema)),
  };
}
