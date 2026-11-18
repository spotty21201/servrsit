/**
 * Baselines (T-078, PRD FR-09/FR-15).
 *
 * Enforced by the database:
 *  - a baseline version is immutable; a change is a new version
 *  - the history of marks and edits is append-only
 * Exceptions ("mark intentional") are the only mutable rows: a mark can be
 * removed, and both the mark and its removal are recorded in the history.
 */

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS baselines (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  reference_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ssh', 'local', 'simulated')),
  source_observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  conventions TEXT NOT NULL,
  PRIMARY KEY (id, version)
) STRICT;

CREATE TABLE IF NOT EXISTS baseline_exceptions (
  baseline_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  convention_id TEXT NOT NULL,
  reason TEXT,
  marked_at TEXT NOT NULL,
  marked_by TEXT NOT NULL,
  PRIMARY KEY (baseline_id, target_id, convention_id)
) STRICT;

CREATE TABLE IF NOT EXISTS baseline_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  baseline_id TEXT NOT NULL,
  target_id TEXT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  text TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS baselines_immutable_u BEFORE UPDATE ON baselines
  BEGIN SELECT RAISE(ABORT, 'a baseline version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS baselines_immutable_d BEFORE DELETE ON baselines
  BEGIN SELECT RAISE(ABORT, 'a baseline version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_events_append_only_u BEFORE UPDATE ON baseline_events
  BEGIN SELECT RAISE(ABORT, 'baseline history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS baseline_events_append_only_d BEFORE DELETE ON baseline_events
  BEGIN SELECT RAISE(ABORT, 'baseline history is append-only'); END;
`;

export interface StoredBaseline<C = unknown> {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly referenceId: string;
  readonly referenceName: string;
  readonly source: "ssh" | "local" | "simulated";
  readonly sourceObservedAt: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly conventions: readonly C[];
}

export interface StoredException {
  readonly conventionId: string;
  readonly reason: string | null;
  readonly markedAt: string;
}

interface Row {
  id: string; version: number; name: string; reference_id: string; reference_name: string; source: string;
  source_observed_at: string; created_at: string; created_by: string; conventions: string;
}

function toBaseline<C>(r: Row): StoredBaseline<C> {
  return {
    id: r.id, version: r.version, name: r.name, referenceId: r.reference_id, referenceName: r.reference_name,
    source: r.source as StoredBaseline["source"], sourceObservedAt: r.source_observed_at, createdAt: r.created_at,
    createdBy: r.created_by, conventions: JSON.parse(r.conventions) as C[],
  };
}

export class SqliteBaselineStore {
  private readonly db: DatabaseSync;

  constructor(options: { readonly path: string }) {
    this.db = new DatabaseSync(options.path);
    this.db.exec(SCHEMA);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private event(baselineId: string, targetId: string | null, actor: string, text: string, at: string): void {
    this.db.prepare("INSERT INTO baseline_events (baseline_id, target_id, at, actor, text) VALUES (?, ?, ?, ?, ?)").run(baselineId, targetId, at, actor, text);
  }

  /** Insert version 1 of a new baseline, or the next version of an existing one. */
  insert<C>(b: Omit<StoredBaseline<C>, "version">): StoredBaseline<C> {
    return this.tx(() => {
      const r = this.db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM baselines WHERE id = ?").get(b.id) as { v: number };
      this.db
        .prepare(
          `INSERT INTO baselines (id, version, name, reference_id, reference_name, source, source_observed_at, created_at, created_by, conventions)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(b.id, r.v, b.name, b.referenceId, b.referenceName, b.source, b.sourceObservedAt, b.createdAt, b.createdBy, JSON.stringify(b.conventions));
      this.event(b.id, null, b.createdBy, `Version ${r.v} saved from ${b.referenceName} with ${b.conventions.length} conventions.`, b.createdAt);
      return { ...b, version: r.v };
    });
  }

  latest<C>(id: string): StoredBaseline<C> | null {
    const row = this.db.prepare("SELECT * FROM baselines WHERE id = ? ORDER BY version DESC LIMIT 1").get(id) as Row | undefined;
    return row === undefined ? null : toBaseline<C>(row);
  }

  listLatest<C>(): StoredBaseline<C>[] {
    const rows = this.db
      .prepare("SELECT b.* FROM baselines b JOIN (SELECT id, MAX(version) AS v FROM baselines GROUP BY id) m ON b.id = m.id AND b.version = m.v ORDER BY b.created_at DESC")
      .all() as unknown as Row[];
    return rows.map((r) => toBaseline<C>(r));
  }

  exceptions(baselineId: string, targetId: string): StoredException[] {
    const rows = this.db.prepare("SELECT convention_id, reason, marked_at FROM baseline_exceptions WHERE baseline_id = ? AND target_id = ?").all(baselineId, targetId) as Array<{
      convention_id: string; reason: string | null; marked_at: string;
    }>;
    return rows.map((r) => ({ conventionId: r.convention_id, reason: r.reason, markedAt: r.marked_at }));
  }

  mark(baselineId: string, targetId: string, conventionId: string, label: string, reason: string | null, actor: string, at: string): void {
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO baseline_exceptions (baseline_id, target_id, convention_id, reason, marked_at, marked_by) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (baseline_id, target_id, convention_id) DO UPDATE SET reason = excluded.reason, marked_at = excluded.marked_at, marked_by = excluded.marked_by`,
        )
        .run(baselineId, targetId, conventionId, reason, at, actor);
      this.event(baselineId, targetId, actor, `Marked ${label} as intentional${reason === null ? "" : `: ${reason}`}.`, at);
    });
  }

  unmark(baselineId: string, targetId: string, conventionId: string, label: string, actor: string, at: string): boolean {
    return this.tx(() => {
      const r = this.db.prepare("DELETE FROM baseline_exceptions WHERE baseline_id = ? AND target_id = ? AND convention_id = ?").run(baselineId, targetId, conventionId);
      if (Number(r.changes) === 0) return false;
      this.event(baselineId, targetId, actor, `Removed the intentional mark on ${label}.`, at);
      return true;
    });
  }

  recordEvent(baselineId: string, targetId: string | null, actor: string, text: string, at: string): void {
    this.event(baselineId, targetId, actor, text, at);
  }

  /** Events for the baseline itself and for one target. */
  history(baselineId: string, targetId: string | null): Array<{ at: string; text: string }> {
    const rows = this.db
      .prepare("SELECT at, text FROM baseline_events WHERE baseline_id = ? AND (target_id IS NULL OR target_id = ?) ORDER BY seq")
      .all(baselineId, targetId) as Array<{ at: string; text: string }>;
    return rows.map((r) => ({ at: r.at, text: r.text }));
  }

  close(): void {
    this.db.close();
  }
}
