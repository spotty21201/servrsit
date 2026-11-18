/**
 * Installation settings (T-076 scheduler pause, T-079 settings). One JSON
 * value per key; every change is also appended to an append-only history
 * with who changed it and when.
 */

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS settings_history (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS settings_history_append_only_u BEFORE UPDATE ON settings_history
  BEGIN SELECT RAISE(ABORT, 'settings history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS settings_history_append_only_d BEFORE DELETE ON settings_history
  BEGIN SELECT RAISE(ABORT, 'settings history is append-only'); END;
`;

export interface SettingChange {
  readonly key: string;
  /** null: the setting was cleared. */
  readonly value: unknown;
  readonly at: string;
  readonly actor: string;
}

export class SqliteSettingsStore {
  private readonly db: DatabaseSync;

  constructor(options: { readonly path: string }) {
    this.db = new DatabaseSync(options.path);
    this.db.exec(SCHEMA);
  }

  get<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.value) as T);
  }

  set(key: string, value: unknown, actor: string, at: Date): void {
    const json = JSON.stringify(value);
    const iso = at.toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
        .run(key, json, iso, actor);
      this.db.prepare("INSERT INTO settings_history (key, value, at, actor) VALUES (?, ?, ?, ?)").run(key, json, iso, actor);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  clear(key: string, actor: string, at: Date): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
      this.db.prepare("INSERT INTO settings_history (key, value, at, actor) VALUES (?, NULL, ?, ?)").run(key, at.toISOString(), actor);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  history(key?: string): SettingChange[] {
    const rows = (
      key === undefined
        ? this.db.prepare("SELECT * FROM settings_history ORDER BY seq").all()
        : this.db.prepare("SELECT * FROM settings_history WHERE key = ? ORDER BY seq").all(key)
    ) as Array<{ key: string; value: string | null; at: string; actor: string }>;
    return rows.map((r) => ({ key: r.key, value: r.value === null ? null : (JSON.parse(r.value) as unknown), at: r.at, actor: r.actor }));
  }

  close(): void {
    this.db.close();
  }
}
