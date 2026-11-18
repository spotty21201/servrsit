/**
 * Activity history support (T-077, PRD FR-18/FR-21).
 *
 *  - inspections: one row per finished check attempt (summary only: result,
 *    coverage counts, fixed failure code; never output). Append-only, except
 *    that rows past the retention period are pruned (FR-21: 30 days for
 *    observations).
 *  - exports: generated reports kept as files-in-the-database until they
 *    expire. Content is built by the API from fixed text only.
 */

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  at TEXT NOT NULL,
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
  passed INTEGER,
  total INTEGER,
  failure_code TEXT,
  UNIQUE (server_id, at)
) STRICT;
CREATE INDEX IF NOT EXISTS inspections_at ON inspections (at);

CREATE TRIGGER IF NOT EXISTS inspections_no_edit BEFORE UPDATE ON inspections
  BEGIN SELECT RAISE(ABORT, 'inspection records cannot be edited'); END;

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL CHECK (format IN ('report', 'json')),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  range_from TEXT NOT NULL,
  range_to TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  redaction TEXT NOT NULL,
  created_by TEXT NOT NULL,
  content TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS exports_no_edit BEFORE UPDATE ON exports
  BEGIN SELECT RAISE(ABORT, 'exports cannot be edited'); END;
`;

export interface StoredInspection {
  readonly id: string;
  readonly serverId: string;
  readonly at: string;
  readonly succeeded: boolean;
  readonly passed: number | null;
  readonly total: number | null;
  readonly failureCode: string | null;
}

export interface StoredExport {
  readonly id: string;
  readonly format: "report" | "json";
  readonly filename: string;
  readonly mime: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly recordCount: number;
  readonly sizeBytes: number;
  readonly redaction: string;
  readonly createdBy: string;
}

interface ExportRow {
  id: string; format: string; filename: string; mime: string; created_at: string; expires_at: string; range_from: string;
  range_to: string; time_zone: string; record_count: number; size_bytes: number; redaction: string; created_by: string; content: string;
}

function toExport(r: ExportRow): StoredExport {
  return {
    id: r.id, format: r.format as StoredExport["format"], filename: r.filename, mime: r.mime, createdAt: r.created_at,
    expiresAt: r.expires_at, from: r.range_from, to: r.range_to, timeZone: r.time_zone, recordCount: r.record_count,
    sizeBytes: r.size_bytes, redaction: r.redaction, createdBy: r.created_by,
  };
}

export class SqliteActivityStore {
  private readonly db: DatabaseSync;

  constructor(options: { readonly path: string }) {
    this.db = new DatabaseSync(options.path);
    this.db.exec(SCHEMA);
  }

  /** Record a finished attempt once; the same (server, time) again is ignored. */
  recordInspection(i: StoredInspection): boolean {
    const r = this.db
      .prepare("INSERT OR IGNORE INTO inspections (id, server_id, at, succeeded, passed, total, failure_code) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(i.id, i.serverId, i.at, i.succeeded ? 1 : 0, i.passed, i.total, i.failureCode);
    return Number(r.changes) > 0;
  }

  listInspections(since: string, limit: number): StoredInspection[] {
    const rows = this.db.prepare("SELECT * FROM inspections WHERE at >= ? ORDER BY at DESC LIMIT ?").all(since, limit) as Array<{
      id: string; server_id: string; at: string; succeeded: number; passed: number | null; total: number | null; failure_code: string | null;
    }>;
    return rows.map((r) => ({ id: r.id, serverId: r.server_id, at: r.at, succeeded: r.succeeded === 1, passed: r.passed, total: r.total, failureCode: r.failure_code }));
  }

  /** Retention: remove inspection rows older than `before`. Returns how many. */
  pruneInspections(before: string): number {
    return Number(this.db.prepare("DELETE FROM inspections WHERE at < ?").run(before).changes);
  }

  insertExport(e: StoredExport, content: string): void {
    this.db
      .prepare(
        `INSERT INTO exports (id, format, filename, mime, created_at, expires_at, range_from, range_to, time_zone, record_count, size_bytes, redaction, created_by, content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.id, e.format, e.filename, e.mime, e.createdAt, e.expiresAt, e.from, e.to, e.timeZone, e.recordCount, e.sizeBytes, e.redaction, e.createdBy, content);
  }

  /** Exports that have not expired, newest first. */
  listExports(now: string, limit: number): StoredExport[] {
    return (this.db.prepare("SELECT * FROM exports WHERE expires_at > ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(now, limit) as unknown as ExportRow[]).map(toExport);
  }

  getExport(id: string): { meta: StoredExport; content: string } | null {
    const r = this.db.prepare("SELECT * FROM exports WHERE id = ?").get(id) as ExportRow | undefined;
    return r === undefined ? null : { meta: toExport(r), content: r.content };
  }

  /** Remove expired exports. Returns how many. */
  pruneExports(now: string): number {
    return Number(this.db.prepare("DELETE FROM exports WHERE expires_at <= ?").run(now).changes);
  }

  close(): void {
    this.db.close();
  }
}
