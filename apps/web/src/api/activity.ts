/**
 * Activity history and export client (T-077). Data layer only; contract in
 * packages/contracts/src/activity.ts.
 *
 * Interface as the Designer's stub (apps/web/src/api/stubs/activity.ts):
 * `list`, `createExport`, `listExports`. Differences, because the server now
 * builds exports itself:
 *  - `createExport(req)` sends the filters (and optional recordIds); the
 *    second argument of the stub is accepted and only its ids are used.
 *  - an ExportResult carries `downloadUrl` instead of `content`; `download`
 *    fetches the file.
 *  - `list(query)` takes the contract's filters.
 */

import {
  ActivityErrorSchema,
  ActivityResponseSchema,
  ExportListSchema,
  ExportResultSchema,
  type ActivityErrorCode,
  type ActivityQuery,
  type ActivityRecord,
  type ExportRequest,
  type ExportResult,
} from "@servrsit/contracts";
import { createHttp, type HttpOptions, type HttpResult, type Parser, type TransportErrorCode } from "./http";

export type { ActivityRecord, ExportRequest, ExportResult };

export type ActivityClientError = ActivityErrorCode | TransportErrorCode;
export type ActivityClientResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ActivityClientError; readonly reason?: string };

export interface ActivityList {
  readonly records: readonly ActivityRecord[];
  readonly truncated: boolean;
}

export interface DownloadedExport {
  readonly content: string;
  readonly mime: ExportResult["mime"];
  readonly filename: string;
}

export interface ActivityClient {
  list(query?: Partial<ActivityQuery>): Promise<ActivityClientResult<ActivityList>>;
  createExport(req: ExportRequest, records?: readonly ActivityRecord[]): Promise<ActivityClientResult<ExportResult>>;
  listExports(): Promise<ActivityClientResult<readonly ExportResult[]>>;
  download(result: ExportResult): Promise<ActivityClientResult<DownloadedExport>>;
}

function flatten<T, U = T>(r: HttpResult<T, { error: ActivityErrorCode; reason?: string | undefined }>, map: (v: T) => U = (v) => v as unknown as U): ActivityClientResult<U> {
  if (r.ok) return { ok: true, data: map(r.data) };
  const e = r.error as { error: ActivityClientError; reason?: string };
  return { ok: false, error: e.error, ...(e.reason === undefined ? {} : { reason: e.reason }) };
}

function queryString(q: Partial<ActivityQuery>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

const TextBody: Parser<string> = { safeParse: (v: unknown) => (typeof v === "string" ? { success: true as const, data: v } : { success: false as const }) };

export function createActivityClient(options: HttpOptions = {}): ActivityClient {
  const call = createHttp(options);
  return {
    list: async (q = {}) => flatten(await call("GET", `/api/activity${queryString(q)}`, undefined, ActivityResponseSchema, ActivityErrorSchema)),
    createExport: async (req, records) => {
      const body: ExportRequest = records === undefined || req.recordIds !== undefined ? req : { ...req, recordIds: records.map((r) => r.id) };
      return flatten(await call("POST", "/api/exports", body, ExportResultSchema, ActivityErrorSchema));
    },
    listExports: async () => flatten(await call("GET", "/api/exports", undefined, ExportListSchema, ActivityErrorSchema), (l) => l.exports),
    download: async (result) =>
      flatten(await call("GET", result.downloadUrl, undefined, TextBody, ActivityErrorSchema, "text"), (content: string) => ({ content, mime: result.mime, filename: result.filename })),
  };
}
