/**
 * Finding records (T-076, PRD FR-20, Tech Spec §12, §14).
 *
 * Enforced by the database:
 *  - at most one OPEN record per (server, finding key): repeated detections
 *    update it (partial unique index)
 *  - a resolved record is final: it cannot change again
 *  - finding events are append-only
 *
 * The decision of WHEN a finding is resolved lives in the API (it needs the
 * check coverage); this store only refuses impossible transitions.
 */

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  finding_key TEXT NOT NULL,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'advisory')),
  summary TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  acknowledged_at TEXT,
  snoozed_until TEXT,
  not_rechecked_since TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS findings_one_open
  ON findings (server_id, finding_key) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS finding_events (
  finding_id TEXT NOT NULL REFERENCES findings (id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (finding_id, seq)
) STRICT;

CREATE TRIGGER IF NOT EXISTS findings_resolved_is_final BEFORE UPDATE ON findings
  WHEN OLD.resolved_at IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'a resolved finding cannot change'); END;
CREATE TRIGGER IF NOT EXISTS findings_no_delete BEFORE DELETE ON findings
  BEGIN SELECT RAISE(ABORT, 'findings are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS finding_events_append_only_u BEFORE UPDATE ON finding_events
  BEGIN SELECT RAISE(ABORT, 'finding events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finding_events_append_only_d BEFORE DELETE ON finding_events
  BEGIN SELECT RAISE(ABORT, 'finding events are append-only'); END;
`;

export interface StoredFinding {
  readonly id: string;
  readonly serverId: string;
  readonly key: string;
  readonly rule: string;
  readonly severity: "critical" | "warning" | "advisory";
  readonly summary: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly acknowledgedAt: string | null;
  readonly snoozedUntil: string | null;
  readonly notRecheckedSince: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

export interface FindingEvent {
  readonly findingId: string;
  readonly seq: number;
  readonly type: string;
  readonly at: string;
  readonly actor: string;
  readonly payload: Record<string, unknown>;
}

export interface ObservedFinding {
  readonly key: string;
  readonly rule: string;
  readonly severity: StoredFinding["severity"];
  readonly summary: string;
}

export type FindingWriteResult =
  | { readonly ok: true; readonly finding: StoredFinding }
  | { readonly ok: false; readonly code: "NOT_FOUND" | "NOT_ALLOWED" };

interface Row {
  id: string; server_id: string; finding_key: string; rule: string; severity: string; summary: string;
  first_observed_at: string; last_observed_at: string; acknowledged_at: string | null; snoozed_until: string | null;
  not_rechecked_since: string | null; resolved_at: string | null; resolved_by: string | null;
}

function toFinding(r: Row): StoredFinding {
  return {
    id: r.id,
    serverId: r.server_id,
    key: r.finding_key,
    rule: r.rule,
    severity: r.severity as StoredFinding["severity"],
    summary: r.summary,
    firstObservedAt: r.first_observed_at,
    lastObservedAt: r.last_observed_at,
    acknowledgedAt: r.acknowledged_at,
    snoozedUntil: r.snoozed_until,
    notRecheckedSince: r.not_rechecked_since,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
  };
}

export class SqliteFindingStore {
  private readonly db: DatabaseSync;

  constructor(options: { readonly path: string }) {
    this.db = new DatabaseSync(options.path);
    this.db.exec(SCHEMA);
  }

  /** Run `fn` in one IMMEDIATE transaction; roll back on any throw. */
  tx<T>(fn: () => T): T {
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

  private event(id: string, type: string, actor: string, payload: Record<string, unknown>, at: string): void {
    const r = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM finding_events WHERE finding_id = ?").get(id) as { n: number };
    this.db
      .prepare("INSERT INTO finding_events (finding_id, seq, type, at, actor, payload) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, r.n, type, at, actor, JSON.stringify(payload));
  }

  get(id: string): StoredFinding | null {
    const row = this.db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as Row | undefined;
    return row === undefined ? null : toFinding(row);
  }

  listOpen(serverId: string): StoredFinding[] {
    return (this.db.prepare("SELECT * FROM findings WHERE server_id = ? AND resolved_at IS NULL ORDER BY first_observed_at, rowid").all(serverId) as unknown as Row[]).map(toFinding);
  }

  /** Open records, plus resolved ones resolved at or after `resolvedSince`. Newest first. */
  list(resolvedSince: string): StoredFinding[] {
    return (
      this.db
        .prepare("SELECT * FROM findings WHERE resolved_at IS NULL OR resolved_at >= ? ORDER BY last_observed_at DESC, rowid DESC LIMIT 2000")
        .all(resolvedSince) as unknown as Row[]
    ).map(toFinding);
  }

  /** Every record ever, oldest first (for export). */
  listAll(): StoredFinding[] {
    return (this.db.prepare("SELECT * FROM findings ORDER BY first_observed_at, rowid").all() as unknown as Row[]).map(toFinding);
  }

  /**
   * A detection: update the open record for (server, key), or open a new
   * one. `fresh` false means the evidence is not current (the server's checks
   * are not running), so the record is marked not-rechecked instead of
   * advancing lastObservedAt.
   */
  observe(serverId: string, f: ObservedFinding, observedAt: string, fresh: boolean, newId: () => string): StoredFinding {
    return this.tx(() => {
      const open = this.db.prepare("SELECT * FROM findings WHERE server_id = ? AND finding_key = ? AND resolved_at IS NULL").get(serverId, f.key) as Row | undefined;
      if (open === undefined) {
        const id = newId();
        this.db
          .prepare(
            `INSERT INTO findings (id, server_id, finding_key, rule, severity, summary, first_observed_at, last_observed_at, not_rechecked_since)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, serverId, f.key, f.rule, f.severity, f.summary, observedAt, observedAt, fresh ? null : observedAt);
        this.event(id, "opened", "system", { rule: f.rule, severity: f.severity }, observedAt);
        return toFinding(this.db.prepare("SELECT * FROM findings WHERE id = ?").get(id) as unknown as Row);
      }
      if (fresh) {
        const last = open.last_observed_at > observedAt ? open.last_observed_at : observedAt;
        this.db
          .prepare("UPDATE findings SET rule = ?, severity = ?, summary = ?, last_observed_at = ?, not_rechecked_since = NULL WHERE id = ?")
          .run(f.rule, f.severity, f.summary, last, open.id);
        if (open.severity !== f.severity) this.event(open.id, "severity-changed", "system", { from: open.severity, to: f.severity }, observedAt);
      } else if (open.not_rechecked_since === null) {
        this.db.prepare("UPDATE findings SET not_rechecked_since = ? WHERE id = ?").run(observedAt, open.id);
        this.event(open.id, "not-rechecked", "system", {}, observedAt);
      }
      return toFinding(this.db.prepare("SELECT * FROM findings WHERE id = ?").get(open.id) as unknown as Row);
    });
  }

  markNotRechecked(id: string, at: string): void {
    this.tx(() => {
      const r = this.db.prepare("UPDATE findings SET not_rechecked_since = ? WHERE id = ? AND resolved_at IS NULL AND not_rechecked_since IS NULL").run(at, id);
      if (Number(r.changes) > 0) this.event(id, "not-rechecked", "system", {}, at);
    });
  }

  resolve(id: string, at: string, by: string): void {
    this.tx(() => {
      const r = this.db.prepare("UPDATE findings SET resolved_at = ?, resolved_by = ?, not_rechecked_since = NULL WHERE id = ? AND resolved_at IS NULL").run(at, by, id);
      if (Number(r.changes) > 0) this.event(id, "resolved", "system", { by }, at);
    });
  }

  acknowledge(id: string, actor: string, at: string): FindingWriteResult {
    return this.tx((): FindingWriteResult => {
      const f = this.get(id);
      if (f === null) return { ok: false, code: "NOT_FOUND" };
      if (f.resolvedAt !== null) return { ok: false, code: "NOT_ALLOWED" };
      if (f.acknowledgedAt === null) {
        this.db.prepare("UPDATE findings SET acknowledged_at = ? WHERE id = ?").run(at, id);
        this.event(id, "acknowledged", actor, {}, at);
      }
      return { ok: true, finding: this.get(id) as StoredFinding };
    });
  }

  snooze(id: string, until: string, actor: string, at: string): FindingWriteResult {
    return this.tx((): FindingWriteResult => {
      const f = this.get(id);
      if (f === null) return { ok: false, code: "NOT_FOUND" };
      if (f.resolvedAt !== null) return { ok: false, code: "NOT_ALLOWED" };
      this.db.prepare("UPDATE findings SET snoozed_until = ? WHERE id = ?").run(until, id);
      this.event(id, "snoozed", actor, { until }, at);
      return { ok: true, finding: this.get(id) as StoredFinding };
    });
  }

  listEvents(id: string): FindingEvent[] {
    const rows = this.db.prepare("SELECT * FROM finding_events WHERE finding_id = ? ORDER BY seq").all(id) as Array<{
      finding_id: string; seq: number; type: string; at: string; actor: string; payload: string;
    }>;
    return rows.map((r) => ({ findingId: r.finding_id, seq: r.seq, type: r.type, at: r.at, actor: r.actor, payload: JSON.parse(r.payload) as Record<string, unknown> }));
  }

  close(): void {
    this.db.close();
  }
}
