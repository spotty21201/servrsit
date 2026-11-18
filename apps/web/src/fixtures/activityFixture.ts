/**
 * [FIXTURE DATA] Activity history and export client (T-071, moved here by
 * T-080). Implements the real ActivityClient interface (api/activity.ts) over
 * in-memory synthetic records, and builds the export file in the browser. Used
 * only by /fixtures/activity. The real /activity screen never imports this.
 */
import { REDACTION_STATEMENT } from "@servrsit/contracts";
import type { ActivityClient, ActivityClientResult, ActivityList, ActivityRecord, ExportRequest, ExportResult } from "../api/activity";
import { gate } from "../lib/fixtureState";

export { REDACTION_STATEMENT };

const STORAGE = "servrsit.fixture.exports.v2";
const wait = (ms: number): Promise<void> => new Promise((r) => globalThis.setTimeout(r, ms));
const EXPORT_LIFETIME_MS = 7 * 86_400_000;

interface Stored { readonly result: ExportResult; readonly content: string }

function load(): Stored[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE);
    const j = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(j) ? (j as Stored[]).slice(0, 10) : [];
  } catch { return []; }
}
function save(list: readonly Stored[]): void {
  try { globalThis.sessionStorage?.setItem(STORAGE, JSON.stringify(list.slice(0, 10))); } catch { /* storage unavailable */ }
}

/** [FIXTURE] Builds the file in the browser from the records given. The real API builds it on the server. */
export function buildExportContent(req: ExportRequest, records: readonly ActivityRecord[], generatedAt: string): { content: string; mime: ExportResult["mime"] } {
  const whitelisted = records.map((r) => ({ id: r.id, type: r.type, at: r.at, server: r.serverName, production: r.production, simulated: r.simulated, title: r.title, result: r.result, summary: r.summary }));
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
    ...whitelisted.map((r) => `${r.at}  ${r.server}${r.production ? " (Production)" : ""}${r.simulated ? " [SIMULATED]" : ""}  ${r.type}  ${r.title}  [${r.result}]  ${r.summary}`),
    "",
  ];
  return { mime: "text/plain", content: lines.join("\n") };
}

export function createFixtureActivityClient(now: () => Date = () => new Date()): ActivityClient {
  const ago = (min: number): string => new Date(now().getTime() - min * 60_000).toISOString();
  const rec = (r: Omit<ActivityRecord, "simulated"> & { simulated?: boolean }): ActivityRecord => ({ simulated: false, ...r });
  const records: readonly ActivityRecord[] = [
    rec({ id: "op-fixture-queued-01", type: "operation", at: ago(6), serverId: "s-nabire", serverName: "Fixture Nabire", production: false, title: "Update packages", result: "in-progress", summary: "Approved. Waiting for the server to confirm.", href: "/operations/fixture-op-queued" }),
    rec({ id: "op-fixture-ok-02", type: "operation", at: ago(130), serverId: "s-sentani", serverName: "Fixture Sentani", production: false, title: "Update packages", result: "succeeded", summary: "Installed versions match the plan for all 3 packages.", href: "/operations/fixture-op-succeeded" }),
    rec({ id: "op-fixture-partial-03", type: "operation", at: ago(26 * 60), serverId: "s-timika", serverName: "Fixture Timika", production: true, title: "Update packages", result: "partial", summary: "2 of 3 packages match the plan.", href: "/operations/fixture-op-partial" }),
    rec({ id: "op-fixture-unknown-04", type: "operation", at: ago(3 * 24 * 60), serverId: "s-timika", serverName: "Fixture Timika", production: true, title: "Update packages", result: "unknown", summary: "ServrSit lost track of the operation. Recheck the outcome.", href: "/operations/fixture-op-unknown" }),
    rec({ id: "op-fixture-failed-05", type: "operation", at: ago(5 * 24 * 60), serverId: "s-nabire", serverName: "Fixture Nabire", production: false, title: "Update packages", result: "failed", summary: "The server did not accept the operation. Nothing changed.", href: "/operations/fixture-op-failed" }),
    rec({ id: "op-fixture-cancel-06", simulated: true, type: "operation", at: ago(9 * 24 * 60), serverId: "s-sentani", serverName: "Fixture Sentani", production: false, title: "Update packages", result: "cancelled", summary: "Cancelled before anything was sent.", href: "/operations/fixture-op-cancelled" }),
    rec({ id: "fnd-f1-open", type: "finding", at: ago(3 * 24 * 60), serverId: "s-timika", serverName: "Fixture Timika", production: true, title: "Finding opened: disk space", result: "info", summary: "Disk space on / is at 96 %.", href: "/findings" }),
    rec({ id: "fnd-f5-resolved", type: "finding", at: ago(120), serverId: "s-nabire", serverName: "Fixture Nabire", production: false, title: "Finding resolved: memory", result: "succeeded", summary: "The check at 09:15 found memory at 61 %, below the threshold.", href: "/findings" }),
    rec({ id: "chk-nabire-1", type: "inspection", at: ago(9), serverId: "s-nabire", serverName: "Fixture Nabire", production: false, title: "Health check", result: "succeeded", summary: "16 of 16 checks ran.", href: "/servers/00000000-0000-4000-8000-0000000000bb" }),
    rec({ id: "chk-merauke-1", type: "inspection", at: ago(52), serverId: "s-merauke", serverName: "Fixture Merauke", production: false, title: "Health check", result: "failed", summary: "Could not reach the server. 2 failed checks in a row.", href: null }),
    rec({ id: "chk-timika-1", type: "inspection", at: ago(14), serverId: "s-timika", serverName: "Fixture Timika", production: true, title: "Health check", result: "partial", summary: "13 of 16 checks ran. Memory and inode figures were unavailable.", href: null }),
    rec({ id: "chk-sentani-1", type: "inspection", at: ago(24 * 60 + 30), serverId: "s-sentani", serverName: "Fixture Sentani", production: false, title: "Health check", result: "succeeded", summary: "16 of 16 checks ran.", href: null }),
  ];
  let exports = load();
  const uuid = (): string => globalThis.crypto.randomUUID();
  return {
    async list() { await wait(200); return gate<ActivityClientResult<ActivityList>>(() => ({ ok: true, data: { records, truncated: false } }), () => ({ ok: false, error: "NETWORK" })); },
    async listExports() { await wait(100); return { ok: true, data: exports.map((e) => e.result) }; },
    async createExport(req, recs) {
      await wait(700);
      const created = now();
      const picked = recs ?? records;
      const { content, mime } = buildExportContent(req, picked, created.toISOString());
      const stamp = created.toISOString().slice(0, 16).replace(/[-:T]/g, "");
      const id = uuid();
      const result: ExportResult = {
        id, format: req.format, filename: `servrsit-activity-${stamp}.${req.format === "json" ? "json" : "txt"}`, mime,
        createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + EXPORT_LIFETIME_MS).toISOString(),
        from: req.from, to: req.to, timeZone: req.timeZone, recordCount: picked.length,
        sizeBytes: new TextEncoder().encode(content).length, redaction: REDACTION_STATEMENT, downloadUrl: `/api/exports/${id}/download`,
      };
      exports = [{ result, content }, ...exports].slice(0, 10);
      save(exports);
      return { ok: true, data: result };
    },
    async download(result) {
      await wait(100);
      const hit = exports.find((e) => e.result.id === result.id);
      if (!hit) return { ok: false, error: "NOT_FOUND" };
      return { ok: true, data: { content: hit.content, mime: hit.result.mime, filename: hit.result.filename } };
    },
  };
}
