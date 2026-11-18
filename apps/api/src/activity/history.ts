/**
 * Activity history and export (T-077, PRD FR-18/FR-21).
 *
 * Every record is composed here from fixed text, counts and fixed failure
 * texts. Nothing from a server's output, a transcript or a log is copied in.
 * Exports are built on the server from the same records, scrubbed for known
 * secret values, stored until they expire, and never edited.
 */

import { randomUUID } from "node:crypto";
import {
  EXPORT_RETENTION_DAYS,
  INSPECTION_RETENTION_DAYS,
  OPERATION_HISTORY_DAYS,
  REDACTION_STATEMENT,
  type ActivityQuery,
  type ActivityRecord,
  type ActivityResult,
  type ExportRequest,
  type ExportResult,
  type FleetResponse,
} from "@servrsit/contracts";
import { FAILURE_MESSAGES, type FailureCode } from "@servrsit/ssh";
import type { CareStore, SqliteActivityStore, SqliteFindingStore, StoredExport, StoredOperation } from "@servrsit/store";

const DAY = 86_400_000;
export const MAX_EXPORT_BYTES = 5 * 1024 * 1024;

export interface ServerInfo {
  readonly name: string;
  readonly production: boolean;
}

export interface ActivityServiceOptions {
  readonly activity: SqliteActivityStore;
  readonly care: CareStore;
  readonly findings: SqliteFindingStore;
  /** Name and production flag of any server ever known, including removed ones. */
  readonly serverInfo: (id: string) => ServerInfo | null;
  /** Removes known secret values (the same scrubber as logs and responses). */
  readonly scrub: (text: string) => string;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
  /** Bring records up to date before reading (records the latest checks and findings). */
  readonly refresh?: (() => void) | undefined;
}

const TITLES: Readonly<Record<string, string>> = {
  "apply.packages.v1": "Update packages",
  "restart.service.v1": "Restart a service",
  "reboot.host.v1": "Reboot",
  "prepare.directories.v1": "Prepare directories",
};

const OPERATION_OUTCOME: Readonly<Record<StoredOperation["state"], { result: ActivityResult; summary: string }>> = {
  queued: { result: "in-progress", summary: "Approved. Waiting to be sent to the server." },
  running: { result: "in-progress", summary: "Running on the server." },
  verifying: { result: "in-progress", summary: "Finished on the server. Checking the result." },
  succeeded: { result: "succeeded", summary: "Finished, and the result was verified." },
  partially_succeeded: { result: "partial", summary: "Part of the work finished and part did not. The record lists which." },
  failed: { result: "failed", summary: "Failed. The record shows what changed." },
  cancelled_before_start: { result: "cancelled", summary: "Cancelled before anything was sent." },
  outcome_unknown: { result: "unknown", summary: "ServrSit could not establish the outcome. Recheck it before changing this server again." },
};

/** Record one row per finished check attempt in the snapshot (idempotent). */
export class InspectionRecorder {
  private lastPrune = 0;

  constructor(
    private readonly store: SqliteActivityStore,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => randomUUID(),
  ) {}

  sync(snapshot: FleetResponse): void {
    for (const s of snapshot.servers) {
      const a = s.latestAttempt;
      if (a === null) continue;
      const covered = a.succeeded && s.coverage !== null;
      this.store.recordInspection({
        id: this.newId(),
        serverId: s.id,
        at: a.at,
        succeeded: a.succeeded,
        passed: covered ? s.coverage!.passed : null,
        total: covered ? s.coverage!.total : null,
        failureCode: a.failure?.code ?? null,
      });
    }
    const t = this.now().getTime();
    if (t - this.lastPrune > 3_600_000) {
      this.lastPrune = t;
      this.store.pruneInspections(new Date(t - INSPECTION_RETENTION_DAYS * DAY).toISOString());
    }
  }
}

function inRange(at: string, q: Pick<ActivityQuery, "from" | "to">): boolean {
  return (q.from === undefined || at >= q.from) && (q.to === undefined || at <= q.to);
}

function formatter(timeZone: string): (iso: string) => string {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
  });
  return (iso) => f.format(new Date(iso));
}

export class ActivityService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly o: ActivityServiceOptions) {
    this.now = o.now ?? (() => new Date());
    this.newId = o.newId ?? (() => randomUUID());
  }

  private server(id: string): ServerInfo {
    return this.o.serverInfo(id) ?? { name: "Removed server", production: false };
  }

  private all(): ActivityRecord[] {
    this.o.refresh?.();
    const now = this.now().getTime();
    const out: ActivityRecord[] = [];

    for (const op of this.o.care.listOperations(new Date(now - OPERATION_HISTORY_DAYS * DAY).toISOString(), 5000)) {
      const s = this.server(op.serverId);
      const outcome = OPERATION_OUTCOME[op.state];
      out.push({
        id: `op-${op.id}`,
        type: "operation",
        at: op.updatedAt,
        serverId: op.serverId,
        serverName: s.name,
        production: s.production,
        simulated: op.targetKind === "simulated",
        title: TITLES[op.operation] ?? "Change",
        result: outcome.result,
        summary: outcome.summary,
        href: `/operations/${op.id}`,
      });
    }

    const findingsSince = new Date(now - OPERATION_HISTORY_DAYS * DAY).toISOString();
    for (const f of this.o.findings.listAll()) {
      const s = this.server(f.serverId);
      const base = { serverId: f.serverId, serverName: s.name, production: s.production, simulated: false, href: "/findings" };
      if (f.firstObservedAt >= findingsSince) {
        out.push({ ...base, id: `fnd-${f.id}-opened`, type: "finding", at: f.firstObservedAt, title: `Finding opened (${f.severity})`, result: "info", summary: f.summary });
      }
      if (f.resolvedAt !== null && f.resolvedBy !== null && f.resolvedAt >= findingsSince) {
        out.push({ ...base, id: `fnd-${f.id}-resolved`, type: "finding", at: f.resolvedAt, title: "Finding resolved", result: "succeeded", summary: `${f.summary} Resolved: ${f.resolvedBy}` });
      }
    }

    for (const i of this.o.activity.listInspections(new Date(now - INSPECTION_RETENTION_DAYS * DAY).toISOString(), 20_000)) {
      const s = this.server(i.serverId);
      const complete = i.succeeded && i.passed !== null && i.total !== null && i.passed === i.total;
      out.push({
        id: `chk-${i.id}`,
        type: "inspection",
        at: i.at,
        serverId: i.serverId,
        serverName: s.name,
        production: s.production,
        simulated: false,
        title: "Health check",
        result: !i.succeeded ? "failed" : complete ? "succeeded" : "partial",
        summary: i.succeeded
          ? i.passed !== null && i.total !== null ? `${i.passed} of ${i.total} checks ran.` : "The check finished."
          : FAILURE_MESSAGES[(i.failureCode ?? "COLLECTION_FAILED") as FailureCode] ?? FAILURE_MESSAGES.COLLECTION_FAILED,
        href: `/servers/${i.serverId}`,
      });
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
  }

  list(q: ActivityQuery): { records: ActivityRecord[]; truncated: boolean } {
    const needle = q.q?.toLowerCase();
    const matched = this.all().filter(
      (r) =>
        (q.type === undefined || r.type === q.type) &&
        (q.server === undefined || r.serverId === q.server) &&
        (q.result === undefined || r.result === q.result) &&
        inRange(r.at, q) &&
        (needle === undefined || `${r.title} ${r.summary} ${r.serverName}`.toLowerCase().includes(needle)),
    );
    return { records: matched.slice(0, q.limit), truncated: matched.length > q.limit };
  }

  /** Build, scrub, store. Returns null when the file would be too large. */
  createExport(req: ExportRequest, owner: string): ExportResult | null {
    const found = this.list({ ...req, limit: 1000 }).records;
    const wanted = req.recordIds === undefined ? null : new Set(req.recordIds);
    const records = wanted === null ? found : found.filter((r) => wanted.has(r.id));
    const created = this.now();
    const createdAt = created.toISOString();
    const fmt = formatter(req.timeZone);
    const lines = records.map((r) => ({
      id: r.id, type: r.type, at: r.at, server: r.serverName, production: r.production, simulated: r.simulated, title: r.title, result: r.result, summary: r.summary,
    }));
    let content: string;
    let mime: ExportResult["mime"];
    if (req.format === "json") {
      mime = "application/json";
      content = JSON.stringify({ generatedAt: createdAt, timeZone: req.timeZone, from: req.from, to: req.to, redaction: REDACTION_STATEMENT, records: lines }, null, 2);
    } else {
      mime = "text/plain";
      content = [
        "ServrSit activity report",
        `Created: ${fmt(createdAt)}`,
        `Range: ${fmt(req.from)} to ${fmt(req.to)} (${req.timeZone})`,
        REDACTION_STATEMENT,
        `Records: ${lines.length}`,
        "",
        ...lines.map(
          (r) => `${fmt(r.at)}  ${r.server}${r.production ? " (Production)" : ""}${r.simulated ? " [SIMULATED]" : ""}  ${r.type}  ${r.title}  [${r.result}]  ${r.summary}`,
        ),
        "",
      ].join("\n");
    }
    content = this.o.scrub(content);
    const sizeBytes = Buffer.byteLength(content, "utf8");
    if (sizeBytes > MAX_EXPORT_BYTES) return null;
    const stamp = createdAt.slice(0, 16).replace(/[-:T]/g, "");
    const meta: StoredExport = {
      id: this.newId(),
      format: req.format,
      filename: `servrsit-activity-${stamp}.${req.format === "json" ? "json" : "txt"}`,
      mime,
      createdAt,
      expiresAt: new Date(created.getTime() + EXPORT_RETENTION_DAYS * DAY).toISOString(),
      from: req.from,
      to: req.to,
      timeZone: req.timeZone,
      recordCount: lines.length,
      sizeBytes,
      redaction: REDACTION_STATEMENT,
      createdBy: owner,
    };
    this.o.activity.pruneExports(createdAt);
    this.o.activity.insertExport(meta, content);
    return exportView(meta);
  }

  listExports(): ExportResult[] {
    return this.o.activity.listExports(this.now().toISOString(), 20).map(exportView);
  }

  download(id: string): { kind: "ok"; meta: StoredExport; content: string } | { kind: "missing" } | { kind: "expired" } {
    const e = this.o.activity.getExport(id);
    if (e === null) return { kind: "missing" };
    if (e.meta.expiresAt <= this.now().toISOString()) return { kind: "expired" };
    return { kind: "ok", ...e };
  }
}

export function exportView(m: StoredExport): ExportResult {
  return {
    id: m.id, format: m.format, filename: m.filename, mime: m.mime as ExportResult["mime"], createdAt: m.createdAt, expiresAt: m.expiresAt,
    from: m.from, to: m.to, timeZone: m.timeZone, recordCount: m.recordCount, sizeBytes: m.sizeBytes, redaction: m.redaction,
    downloadUrl: `/api/exports/${m.id}/download`,
  };
}
