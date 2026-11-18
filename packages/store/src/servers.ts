/**
 * Server registry (T-069, PRD FR-02/03, Tech Spec §6.2-6.3, §12).
 *
 * The servers ServrSit looks after now live here instead of in hosts.json.
 * hosts.json is imported once, the first time an empty registry starts.
 *
 * Guarantees enforced by the database itself, not only by code:
 *  - writes_enabled can only ever be 0 (ADR-014)
 *  - a server row is never deleted; disconnecting sets disconnected_at, and a
 *    disconnected server cannot change again
 *  - names and address+port are unique among connected servers
 *  - server events are append-only
 *
 * Nothing secret is stored. A registered server keeps the PATH of its key
 * file on the controller, never the key; drafts hold only public data.
 */

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('import', 'registration')),
  access TEXT NOT NULL CHECK (access IN ('ssh', 'local')),
  name TEXT NOT NULL,
  role TEXT,
  production INTEGER NOT NULL CHECK (production IN (0, 1)),
  address TEXT,
  port INTEGER,
  user TEXT,
  identity_file TEXT,
  known_hosts_file TEXT,
  important_services TEXT NOT NULL,
  collect INTEGER NOT NULL CHECK (collect IN (0, 1)),
  collect_disabled_reason TEXT,
  writes_enabled INTEGER NOT NULL DEFAULT 0 CHECK (writes_enabled = 0),
  host_key TEXT,
  access_key TEXT,
  created_at TEXT NOT NULL,
  disconnected_at TEXT,
  CHECK (access = 'local' OR (address IS NOT NULL AND port IS NOT NULL AND user IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS servers_active_name
  ON servers (lower(name)) WHERE disconnected_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS servers_active_endpoint
  ON servers (lower(address), port) WHERE disconnected_at IS NULL AND address IS NOT NULL;

CREATE TABLE IF NOT EXISTS server_events (
  server_id TEXT NOT NULL REFERENCES servers (id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (server_id, seq)
) STRICT;

CREATE TABLE IF NOT EXISTS server_drafts (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  body TEXT NOT NULL,
  host_key_line TEXT,
  first_check TEXT,
  key_dir TEXT,
  expires_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS registry_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS servers_no_delete BEFORE DELETE ON servers
  BEGIN SELECT RAISE(ABORT, 'servers are never deleted; disconnect instead'); END;
CREATE TRIGGER IF NOT EXISTS servers_disconnected_is_final BEFORE UPDATE ON servers
  WHEN OLD.disconnected_at IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'a disconnected server cannot change'); END;
CREATE TRIGGER IF NOT EXISTS server_events_append_only_u BEFORE UPDATE ON server_events
  BEGIN SELECT RAISE(ABORT, 'server events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS server_events_append_only_d BEFORE DELETE ON server_events
  BEGIN SELECT RAISE(ABORT, 'server events are append-only'); END;
`;

const IMPORT_MARKER = "hosts_json_imported_at";

/** The host key the owner confirmed, with the evidence Tech Spec §6.3 asks for. */
export interface PinnedHostKey {
  readonly algorithm: "ED25519" | "ECDSA" | "RSA";
  readonly fingerprint: string;
  readonly observedAt: string;
  readonly confirmedAt: string;
  readonly confirmedBy: string;
}

/** The public half of the key ServrSit made for one server. */
export interface IssuedAccessKey {
  readonly authorizedKeysLine: string;
  readonly algorithm: "ED25519";
  readonly keyFingerprint: string;
  readonly controllerAddress: string;
  readonly createdAt: string;
}

export interface StoredServer {
  readonly id: string;
  /** "import": came from hosts.json once. "registration": added through the API. */
  readonly source: "import" | "registration";
  readonly access: "ssh" | "local";
  readonly name: string;
  readonly role: string | null;
  readonly production: boolean;
  readonly address: string | null;
  readonly port: number | null;
  readonly user: string | null;
  /** Path only; the file is passed to `ssh -i` and never opened by ServrSit. */
  readonly identityFile: string | null;
  /** Per-server pinned known_hosts file, or null to use the installation's shared one. */
  readonly knownHostsFile: string | null;
  readonly importantServices: readonly string[];
  readonly collect: boolean;
  readonly collectDisabledReason: string | null;
  readonly writesEnabled: false;
  readonly hostKey: PinnedHostKey | null;
  readonly accessKey: IssuedAccessKey | null;
  readonly createdAt: string;
  readonly disconnectedAt: string | null;
}

export type NewServer = Omit<StoredServer, "writesEnabled" | "disconnectedAt">;

export interface StoredDraft {
  readonly id: string;
  readonly owner: string;
  /** The ServerDraft as the API returns it (public data only). */
  readonly body: Record<string, unknown>;
  /** The known_hosts line the server presented at scan time (public). */
  readonly hostKeyLine: string | null;
  readonly firstCheck: Record<string, unknown> | null;
  /** Controller directory holding this draft's key pair and known_hosts. */
  readonly keyDir: string | null;
  readonly expiresAt: string;
}

export interface ServerEvent {
  readonly serverId: string;
  readonly seq: number;
  readonly type: string;
  readonly at: string;
  readonly actor: string;
  readonly payload: Record<string, unknown>;
}

export type ServerUpdate = {
  readonly name?: string | undefined;
  readonly role?: string | null | undefined;
  readonly production?: boolean | undefined;
};

export type RegistryWriteResult =
  | { readonly ok: true; readonly server: StoredServer }
  | { readonly ok: false; readonly code: "SERVER_NOT_FOUND" | "DUPLICATE_NAME" | "DUPLICATE_SERVER" | "DISCONNECTED" };

export type ImportResult =
  | { readonly kind: "imported"; readonly count: number }
  | { readonly kind: "already-imported"; readonly at: string };

interface ServerRow {
  id: string; source: string; access: string; name: string; role: string | null; production: number;
  address: string | null; port: number | null; user: string | null; identity_file: string | null;
  known_hosts_file: string | null; important_services: string; collect: number;
  collect_disabled_reason: string | null; host_key: string | null; access_key: string | null;
  created_at: string; disconnected_at: string | null;
}

interface DraftRow {
  id: string; owner: string; body: string; host_key_line: string | null; first_check: string | null;
  key_dir: string | null; expires_at: string;
}

function toServer(r: ServerRow): StoredServer {
  return {
    id: r.id,
    source: r.source as StoredServer["source"],
    access: r.access as StoredServer["access"],
    name: r.name,
    role: r.role,
    production: r.production === 1,
    address: r.address,
    port: r.port,
    user: r.user,
    identityFile: r.identity_file,
    knownHostsFile: r.known_hosts_file,
    importantServices: JSON.parse(r.important_services) as string[],
    collect: r.collect === 1,
    collectDisabledReason: r.collect_disabled_reason,
    writesEnabled: false,
    hostKey: r.host_key === null ? null : (JSON.parse(r.host_key) as PinnedHostKey),
    accessKey: r.access_key === null ? null : (JSON.parse(r.access_key) as IssuedAccessKey),
    createdAt: r.created_at,
    disconnectedAt: r.disconnected_at,
  };
}

function toDraft(r: DraftRow): StoredDraft {
  return {
    id: r.id,
    owner: r.owner,
    body: JSON.parse(r.body) as Record<string, unknown>,
    hostKeyLine: r.host_key_line,
    firstCheck: r.first_check === null ? null : (JSON.parse(r.first_check) as Record<string, unknown>),
    keyDir: r.key_dir,
    expiresAt: r.expires_at,
  };
}

function isUniqueViolation(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  if (!/UNIQUE constraint failed/i.test(message)) return null;
  if (message.includes("servers_active_name")) return "name";
  if (message.includes("servers_active_endpoint")) return "endpoint";
  return null;
}

export interface SqliteServerStoreOptions {
  /** File path, or ":memory:". */
  readonly path: string;
}

export class SqliteServerStore {
  private readonly db: DatabaseSync;

  constructor(options: SqliteServerStoreOptions) {
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

  private insertEvent(serverId: string, type: string, actor: string, payload: Record<string, unknown>, at: string): void {
    const r = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM server_events WHERE server_id = ?").get(serverId) as { n: number };
    this.db
      .prepare("INSERT INTO server_events (server_id, seq, type, at, actor, payload) VALUES (?, ?, ?, ?, ?, ?)")
      .run(serverId, r.n, type, at, actor, JSON.stringify(payload));
  }

  private insertServer(s: NewServer): void {
    this.db
      .prepare(
        `INSERT INTO servers (id, source, access, name, role, production, address, port, user, identity_file,
           known_hosts_file, important_services, collect, collect_disabled_reason, host_key, access_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.id, s.source, s.access, s.name, s.role, s.production ? 1 : 0, s.address, s.port, s.user, s.identityFile,
        s.knownHostsFile, JSON.stringify(s.importantServices), s.collect ? 1 : 0, s.collectDisabledReason,
        s.hostKey === null ? null : JSON.stringify(s.hostKey),
        s.accessKey === null ? null : JSON.stringify(s.accessKey),
        s.createdAt,
      );
  }

  /**
   * Import hosts.json once. After the first import (even of zero hosts) the
   * file's host list is never read into the registry again.
   */
  importOnce(servers: readonly NewServer[], now: Date): ImportResult {
    return this.tx((): ImportResult => {
      const done = this.db.prepare("SELECT value FROM registry_meta WHERE key = ?").get(IMPORT_MARKER) as { value: string } | undefined;
      if (done !== undefined) return { kind: "already-imported", at: done.value };
      const at = now.toISOString();
      for (const s of servers) {
        this.insertServer(s);
        this.insertEvent(s.id, "imported", "system:hosts.json", { name: s.name }, at);
      }
      this.db.prepare("INSERT INTO registry_meta (key, value) VALUES (?, ?)").run(IMPORT_MARKER, at);
      return { kind: "imported", count: servers.length };
    });
  }

  listActive(): StoredServer[] {
    const rows = this.db.prepare("SELECT * FROM servers WHERE disconnected_at IS NULL ORDER BY created_at, rowid").all() as unknown as ServerRow[];
    return rows.map(toServer);
  }

  get(id: string): StoredServer | null {
    const row = this.db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as ServerRow | undefined;
    return row === undefined ? null : toServer(row);
  }

  findActiveByEndpoint(address: string, port: number): StoredServer | null {
    const row = this.db
      .prepare("SELECT * FROM servers WHERE disconnected_at IS NULL AND lower(address) = lower(?) AND port = ?")
      .get(address, port) as ServerRow | undefined;
    return row === undefined ? null : toServer(row);
  }

  findActiveByHostKey(fingerprint: string): StoredServer | null {
    const row = this.db
      .prepare("SELECT * FROM servers WHERE disconnected_at IS NULL AND json_extract(host_key, '$.fingerprint') = ?")
      .get(fingerprint) as ServerRow | undefined;
    return row === undefined ? null : toServer(row);
  }

  /** Add a registered server and remove its draft, in one transaction. */
  register(server: NewServer, draftId: string, actor: string, now: Date): RegistryWriteResult {
    try {
      return this.tx((): RegistryWriteResult => {
        this.insertServer(server);
        this.insertEvent(server.id, "registered", actor, { name: server.name, hostKey: server.hostKey?.fingerprint ?? null }, now.toISOString());
        this.db.prepare("DELETE FROM server_drafts WHERE id = ?").run(draftId);
        const created = this.get(server.id);
        if (created === null) throw new Error("registered server row is missing");
        return { ok: true, server: created };
      });
    } catch (error) {
      const which = isUniqueViolation(error);
      if (which === "name") return { ok: false, code: "DUPLICATE_NAME" };
      if (which === "endpoint") return { ok: false, code: "DUPLICATE_SERVER" };
      throw error;
    }
  }

  update(id: string, change: ServerUpdate, actor: string, now: Date): RegistryWriteResult {
    try {
      return this.tx((): RegistryWriteResult => {
        const current = this.get(id);
        if (current === null) return { ok: false, code: "SERVER_NOT_FOUND" };
        if (current.disconnectedAt !== null) return { ok: false, code: "DISCONNECTED" };
        const next = {
          name: change.name ?? current.name,
          role: change.role === undefined ? current.role : change.role,
          production: change.production ?? current.production,
        };
        this.db.prepare("UPDATE servers SET name = ?, role = ?, production = ? WHERE id = ?").run(next.name, next.role, next.production ? 1 : 0, id);
        const before = { name: current.name, role: current.role, production: current.production };
        this.insertEvent(id, "updated", actor, { before, after: next }, now.toISOString());
        const updated = this.get(id);
        if (updated === null) throw new Error("updated server row is missing");
        return { ok: true, server: updated };
      });
    } catch (error) {
      if (isUniqueViolation(error) === "name") return { ok: false, code: "DUPLICATE_NAME" };
      throw error;
    }
  }

  disconnect(id: string, actor: string, now: Date, payload: Record<string, unknown>): RegistryWriteResult {
    return this.tx((): RegistryWriteResult => {
      const current = this.get(id);
      if (current === null) return { ok: false, code: "SERVER_NOT_FOUND" };
      if (current.disconnectedAt !== null) return { ok: false, code: "DISCONNECTED" };
      const at = now.toISOString();
      this.db.prepare("UPDATE servers SET disconnected_at = ?, collect = 0 WHERE id = ?").run(at, id);
      this.insertEvent(id, "disconnected", actor, payload, at);
      const updated = this.get(id);
      if (updated === null) throw new Error("disconnected server row is missing");
      return { ok: true, server: updated };
    });
  }

  /** Append a later fact (for example: the controller key file was deleted). */
  appendEvent(id: string, type: string, actor: string, payload: Record<string, unknown>, now: Date): void {
    this.tx(() => this.insertEvent(id, type, actor, payload, now.toISOString()));
  }

  listEvents(id: string): ServerEvent[] {
    const rows = this.db.prepare("SELECT * FROM server_events WHERE server_id = ? ORDER BY seq").all(id) as Array<{
      server_id: string; seq: number; type: string; at: string; actor: string; payload: string;
    }>;
    return rows.map((r) => ({ serverId: r.server_id, seq: r.seq, type: r.type, at: r.at, actor: r.actor, payload: JSON.parse(r.payload) as Record<string, unknown> }));
  }

  // -------------------------------------------------------------------------
  // Drafts
  // -------------------------------------------------------------------------

  saveDraft(d: StoredDraft): void {
    this.db
      .prepare(
        `INSERT INTO server_drafts (id, owner, body, host_key_line, first_check, key_dir, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET body = excluded.body, host_key_line = excluded.host_key_line,
           first_check = excluded.first_check, key_dir = excluded.key_dir`,
      )
      .run(d.id, d.owner, JSON.stringify(d.body), d.hostKeyLine, d.firstCheck === null ? null : JSON.stringify(d.firstCheck), d.keyDir, d.expiresAt);
  }

  getDraft(id: string): StoredDraft | null {
    const row = this.db.prepare("SELECT * FROM server_drafts WHERE id = ?").get(id) as DraftRow | undefined;
    return row === undefined ? null : toDraft(row);
  }

  deleteDraft(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM server_drafts WHERE id = ?").run(id).changes) > 0;
  }

  /** Drafts past their expiry, so their unused key files can be removed. */
  listExpiredDrafts(now: Date): StoredDraft[] {
    const rows = this.db.prepare("SELECT * FROM server_drafts WHERE expires_at <= ?").all(now.toISOString()) as unknown as DraftRow[];
    return rows.map(toDraft);
  }

  close(): void {
    this.db.close();
  }
}
