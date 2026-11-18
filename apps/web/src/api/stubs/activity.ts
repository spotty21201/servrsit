/**
 * [FIXTURE] STUB client for the Activity history and export (T-071, UX-10,
 * UX Spec §14). The API has no history listing or export endpoint yet
 * (GET /api/operations/:id is the only read). Types are local and
 * PROVISIONAL; Coder should propose a contract and replace this file.
 * Proposed endpoints:
 *
 *   GET  /api/activity?type=&server=&result=&from=&to=&q=   -> { records: ActivityRecord[] }
 *   POST /api/exports {format, from, to, filters}           -> ExportResult (metadata)
 *   GET  /api/exports                                        -> ExportResult[] (recent, persistent)
 *   GET  /api/exports/:id/download                           -> the file (redacted)
 *
 * Redaction is the API's job: no key, token, password, raw command output or
 * log contents may appear in a record or an export. The UI shows what the API
 * says it redacted and never offers raw output.
 */

export type ActivityType = "operation" | "finding" | "inspection";
export type ActivityResult = "succeeded" | "partial" | "failed" | "unknown" | "cancelled" | "in-progress" | "info";

export interface ActivityRecord {
  readonly id: string;
  readonly type: ActivityType;
  readonly at: string;
  readonly serverId: string;
  readonly serverName: string;
  readonly production: boolean;
  /** Fixed, display-safe title, for example "Update packages". */
  readonly title: string;
  readonly result: ActivityResult;
  /** Short outcome text written by ServrSit. Never raw server output. */
  readonly summary: string;
  /** Where the record opens, when it has a page. */
  readonly href: string | null;
}

export type ExportFormat = "report" | "json";

export interface ExportRequest {
  readonly format: ExportFormat;
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly recordIds: readonly string[];
}

export interface ExportResult {
  readonly id: string;
  readonly format: ExportFormat;
  readonly filename: string;
  readonly createdAt: string;
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly recordCount: number;
  readonly sizeBytes: number;
  /** What was removed, in the API's own words. */
  readonly redaction: string;
  /** Content for the fixture's download. A real API returns a download URL instead. */
  readonly content: string;
  readonly mime: string;
}

export type ActivityClientResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: "NETWORK" | "FAILED" };

export interface ActivityClient {
  list(): Promise<ActivityClientResult<readonly ActivityRecord[]>>;
  createExport(req: ExportRequest, records: readonly ActivityRecord[]): Promise<ActivityClientResult<ExportResult>>;
  listExports(): Promise<ActivityClientResult<readonly ExportResult[]>>;
}

export const REDACTION_STATEMENT = "Secrets are redacted: no keys, passwords, tokens, raw command output or log contents are included.";

const STORAGE = "servrsit.fixture.exports.v1";
const wait = (ms: number): Promise<void> => new Promise((r) => globalThis.setTimeout(r, ms));

function load(): ExportResult[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE);
    const j = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(j) ? (j as ExportResult[]).slice(0, 10) : [];
  } catch { return []; }
}
function save(list: readonly ExportResult[]): void {
  try { globalThis.sessionStorage?.setItem(STORAGE, JSON.stringify(list.slice(0, 10))); } catch { /* storage unavailable */ }
}

/** [FIXTURE] Builds the file in the browser from the records given. A real API builds it server-side. */
export function buildExportContent(req: ExportRequest, records: readonly ActivityRecord[], generatedAt: string): { content: string; mime: string } {
  const whitelisted = records.map((r) => ({ id: r.id, type: r.type, at: r.at, server: r.serverName, production: r.production, title: r.title, result: r.result, summary: r.summary }));
  if (req.format === "json") {
    return {
      mime: "application/json",
      content: JSON.stringify({ fixture: true, generatedAt, timeZone: req.timeZone, from: req.from, to: req.to, redaction: REDACTION_STATEMENT, records: whitelisted }, null, 2),
    };
  }
  const lines = [
    "ServrSit activity report [FIXTURE DATA]",
    `Created: ${generatedAt}`,
    `Range: ${req.from} to ${req.to} (${req.timeZone})`,
    REDACTION_STATEMENT,
    "",
    ...whitelisted.map((r) => `${r.at}  ${r.server}${r.production ? " (Production)" : ""}  ${r.type}  ${r.title}  [${r.result}]  ${r.summary}`),
    "",
  ];
  return { mime: "text/plain", content: lines.join("\n") };
}

export function createFixtureActivityClient(now: () => Date = () => new Date()): ActivityClient {
  const ago = (min: number): string => new Date(now().getTime() - min * 60_000).toISOString();
  const rec = (r: ActivityRecord): ActivityRecord => r;
  const records: readonly ActivityRecord[] = [
    rec({ id: "op-fixture-queued-01", type: "operation", at: ago(6), serverId: "s-nabire", serverName: "Fixture Nabire", production: false, title: "Update packages", result: "in-progress", summary: "Approved. Waiting for the server to confirm.", href: "/operations/fixture-op-queued" }),
    rec({ id: "op-fixture-ok-02", type: "operation", at: ago(130), serverId: "s-sentani", serverName: "Fixture Sentani", production: false, title: "Update packages", result: "succeeded", summary: "Installed versions match the plan for all 3 packages.", href: "/operations/fixture-op-succeeded" }),
    rec({ id: "op-fixture-partial-03", type: "operation", at: ago(26 * 60), serverId: "s-timika", serverName: "Fixture Timika", production: true, title: "Update packages", result: "partial", summary: "2 of 3 packages match the plan.", href: "/operations/fixture-op-partial" }),
    rec({ id: "op-fixture-unknown-04", type: "operation", at: ago(3 * 24 * 60), serverId: "s-timika", serverName: "Fixture Timika", production: true, title: "Update packages", result: "unknown", summary: "ServrSit lost track of the operation. Recheck the outcome.", href: "/operations/fixture-op-unknown" }),
    rec({ id: "op-fixture-failed-05", type: "operation", at: ago(5 * 24 * 60), serverId: "s-nabire", serverName: "Fixture Nabire", production: false, title: "Update packages", result: "failed", summary: "The server did not accept the operation. Nothing changed.", href: "/operations/fixture-op-failed" }),
    rec({ id: "op-fixture-cancel-06", type: "operation", at: ago(9 * 24 * 60), serverId: "s-sentani", serverName: "Fixture Sentani", production: false, title: "Update packages", result: "cancelled", summary: "Cancelled before anything was sent.", href: "/operations/fixture-op-cancelled" }),
    rec({ id: "fnd-f1-open", type: "finding", at: ago(3 * 24 * 60), serverId: "s-timika", serverName: "Fixture Timika", production: true, title: "Finding opened: disk space", result: "info", summary: "Disk space on / is at 96 %.", href: "/findings" }),
    rec({ id: "fnd-f5-resolved", type: "finding", at: ago(120), serverId: "s-nabire", serverName: "Fixture Nabire", production: false, title: "Finding resolved: memory", result: "succeeded", summary: "The check at 09:15 found memory at 61 %, below the threshold.", href: "/findings" }),
    rec({ id: "chk-nabire-1", type: "inspection", at: ago(9), serverId: "s-nabire", serverName: "Fixture Nabire", production: false, title: "Health check", result: "succeeded", summary: "16 of 16 checks ran.", href: "/servers/00000000-0000-4000-8000-0000000000bb" }),
    rec({ id: "chk-merauke-1", type: "inspection", at: ago(52), serverId: "s-merauke", serverName: "Fixture Merauke", production: false, title: "Health check", result: "failed", summary: "Could not reach the server. 2 failed checks in a row.", href: null }),
    rec({ id: "chk-timika-1", type: "inspection", at: ago(14), serverId: "s-timika", serverName: "Fixture Timika", production: true, title: "Health check", result: "partial", summary: "13 of 16 checks ran. Memory and inode figures were unavailable.", href: null }),
    rec({ id: "chk-sentani-1", type: "inspection", at: ago(24 * 60 + 30), serverId: "s-sentani", serverName: "Fixture Sentani", production: false, title: "Health check", result: "succeeded", summary: "16 of 16 checks ran.", href: null }),
  ];
  let exports = load();
  let n = exports.length;
  return {
    async list() { await wait(200); return { ok: true, data: records }; },
    async listExports() { await wait(100); return { ok: true, data: exports }; },
    async createExport(req, recs) {
      await wait(700);
      const created = now().toISOString();
      const { content, mime } = buildExportContent(req, recs, created);
      const stamp = created.slice(0, 16).replace(/[-:T]/g, "");
      const result: ExportResult = {
        id: `export-${++n}`, format: req.format, filename: `servrsit-activity-${stamp}.${req.format === "json" ? "json" : "txt"}`,
        createdAt: created, from: req.from, to: req.to, timeZone: req.timeZone, recordCount: recs.length,
        sizeBytes: new TextEncoder().encode(content).length, redaction: REDACTION_STATEMENT, content, mime,
      };
      exports = [result, ...exports].slice(0, 10);
      save(exports);
      return { ok: true, data: result };
    },
  };
}
