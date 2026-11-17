/**
 * Owner authentication records (T-053, ADR-017), on node:sqlite.
 *
 * Holds hashes, never the secrets they verify: the password as an argon2id
 * hash, and setup tokens, enrolment and sign-in tickets, session ids and
 * recovery codes as SHA-256 of high-entropy random values. Hashing happens in
 * the API; this store only keeps and compares rows.
 *
 * The TOTP secret is the exception: verifying a code needs it. It is kept
 * only in this file, which is created owner-only (0600) in a 0700 directory.
 * ADR-017 records that limit.
 *
 * Enforced by the database:
 *  - at most one owner (primary key fixed to 1)
 *  - a TOTP time step is accepted at most once, and never an older one
 *    (conditional update)
 *  - a setup token and a recovery code work once (conditional update)
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret TEXT NOT NULL,
  last_totp_counter INTEGER NOT NULL DEFAULT -1,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS setup_tokens (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS enrolments (
  ticket_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS mfa_tickets (
  ticket_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS recovery_codes (
  code_hash TEXT PRIMARY KEY,
  used_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS login_failures (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  consecutive INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
) STRICT;
`;

export interface OwnerRecord {
  readonly username: string;
  readonly passwordHash: string;
  readonly totpSecret: string;
  readonly lastTotpCounter: number;
}

export interface EnrolmentRecord {
  readonly username: string;
  readonly passwordHash: string;
  readonly totpSecret: string;
  readonly attempts: number;
  readonly expiresAt: number;
}

export interface TicketRecord {
  readonly attempts: number;
  readonly expiresAt: number;
}

export interface SessionRecord {
  readonly csrfToken: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly absoluteExpiresAt: number;
}

export interface LockoutState {
  readonly consecutive: number;
  readonly lockedUntil: number;
}

export interface SqliteAuthStoreOptions {
  /** File path, or ":memory:". A file is created owner-only. */
  readonly path: string;
}

export class SqliteAuthStore {
  private readonly db: DatabaseSync;

  constructor(options: SqliteAuthStoreOptions) {
    if (options.path !== ":memory:") {
      const dir = dirname(options.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(options.path);
    if (options.path !== ":memory:") chmodSync(options.path, 0o600);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
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

  // ---- owner ----------------------------------------------------------------

  owner(): OwnerRecord | null {
    const r = this.db.prepare("SELECT username, password_hash, totp_secret, last_totp_counter FROM owner WHERE id = 1").get() as
      | { username: string; password_hash: string; totp_secret: string; last_totp_counter: number }
      | undefined;
    return r === undefined
      ? null
      : { username: r.username, passwordHash: r.password_hash, totpSecret: r.totp_secret, lastTotpCounter: r.last_totp_counter };
  }

  hasOwner(): boolean {
    return this.db.prepare("SELECT 1 AS x FROM owner WHERE id = 1").get() !== undefined;
  }

  /**
   * Turn a confirmed enrolment into the owner, with its recovery codes, in one
   * transaction. False if an owner already exists or the enrolment is gone.
   */
  completeEnrolment(ticketHash: string, totpCounter: number, recoveryCodeHashes: readonly string[], at: number): boolean {
    return this.tx(() => {
      if (this.hasOwner()) return false;
      const e = this.enrolment(ticketHash);
      if (e === null) return false;
      this.db
        .prepare("INSERT INTO owner (id, username, password_hash, totp_secret, last_totp_counter, created_at) VALUES (1, ?, ?, ?, ?, ?)")
        .run(e.username, e.passwordHash, e.totpSecret, totpCounter, at);
      const insert = this.db.prepare("INSERT INTO recovery_codes (code_hash) VALUES (?)");
      for (const h of recoveryCodeHashes) insert.run(h);
      this.db.prepare("DELETE FROM enrolments").run();
      this.db.prepare("DELETE FROM setup_tokens").run();
      return true;
    });
  }

  /** Accept a TOTP time step only if it is newer than every step accepted before. Atomic. */
  acceptTotpCounter(counter: number): boolean {
    const r = this.db.prepare("UPDATE owner SET last_totp_counter = ? WHERE id = 1 AND last_totp_counter < ?").run(counter, counter);
    return Number(r.changes) === 1;
  }

  // ---- setup tokens ---------------------------------------------------------

  /** Replace every earlier setup token with this one. */
  replaceSetupToken(tokenHash: string, at: number): void {
    this.tx(() => {
      this.db.prepare("DELETE FROM setup_tokens").run();
      this.db.prepare("INSERT INTO setup_tokens (token_hash, created_at) VALUES (?, ?)").run(tokenHash, at);
    });
  }

  /** Use a setup token. True once per token, and only while no owner exists. */
  consumeSetupToken(tokenHash: string, at: number): boolean {
    return this.tx(() => {
      if (this.hasOwner()) return false;
      const r = this.db.prepare("UPDATE setup_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(at, tokenHash);
      return Number(r.changes) === 1;
    });
  }

  // ---- enrolment --------------------------------------------------------------

  createEnrolment(ticketHash: string, e: Omit<EnrolmentRecord, "attempts">): void {
    this.tx(() => {
      this.db.prepare("DELETE FROM enrolments").run();
      this.db
        .prepare("INSERT INTO enrolments (ticket_hash, username, password_hash, totp_secret, expires_at) VALUES (?, ?, ?, ?, ?)")
        .run(ticketHash, e.username, e.passwordHash, e.totpSecret, e.expiresAt);
    });
  }

  enrolment(ticketHash: string): EnrolmentRecord | null {
    const r = this.db
      .prepare("SELECT username, password_hash, totp_secret, attempts, expires_at FROM enrolments WHERE ticket_hash = ?")
      .get(ticketHash) as
      | { username: string; password_hash: string; totp_secret: string; attempts: number; expires_at: number }
      | undefined;
    return r === undefined
      ? null
      : { username: r.username, passwordHash: r.password_hash, totpSecret: r.totp_secret, attempts: r.attempts, expiresAt: r.expires_at };
  }

  bumpEnrolmentAttempts(ticketHash: string): void {
    this.db.prepare("UPDATE enrolments SET attempts = attempts + 1 WHERE ticket_hash = ?").run(ticketHash);
  }

  deleteEnrolment(ticketHash: string): void {
    this.db.prepare("DELETE FROM enrolments WHERE ticket_hash = ?").run(ticketHash);
  }

  // ---- sign-in tickets (password passed, TOTP pending) -----------------------

  createMfaTicket(ticketHash: string, expiresAt: number): void {
    this.db.prepare("INSERT INTO mfa_tickets (ticket_hash, expires_at) VALUES (?, ?)").run(ticketHash, expiresAt);
  }

  mfaTicket(ticketHash: string): TicketRecord | null {
    const r = this.db.prepare("SELECT attempts, expires_at FROM mfa_tickets WHERE ticket_hash = ?").get(ticketHash) as
      | { attempts: number; expires_at: number }
      | undefined;
    return r === undefined ? null : { attempts: r.attempts, expiresAt: r.expires_at };
  }

  bumpMfaAttempts(ticketHash: string): void {
    this.db.prepare("UPDATE mfa_tickets SET attempts = attempts + 1 WHERE ticket_hash = ?").run(ticketHash);
  }

  deleteMfaTicket(ticketHash: string): void {
    this.db.prepare("DELETE FROM mfa_tickets WHERE ticket_hash = ?").run(ticketHash);
  }

  deleteExpiredTickets(now: number): void {
    this.db.prepare("DELETE FROM mfa_tickets WHERE expires_at <= ?").run(now);
    this.db.prepare("DELETE FROM enrolments WHERE expires_at <= ?").run(now);
  }

  // ---- recovery codes -------------------------------------------------------

  /** Use a recovery code. True once per code. */
  useRecoveryCode(codeHash: string, at: number): boolean {
    const r = this.db.prepare("UPDATE recovery_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL").run(at, codeHash);
    return Number(r.changes) === 1;
  }

  unusedRecoveryCodes(): number {
    return (this.db.prepare("SELECT count(*) AS n FROM recovery_codes WHERE used_at IS NULL").get() as { n: number }).n;
  }

  // ---- sessions -------------------------------------------------------------

  createSession(idHash: string, s: SessionRecord): void {
    this.db
      .prepare("INSERT INTO sessions (id_hash, csrf_token, created_at, last_seen_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(idHash, s.csrfToken, s.createdAt, s.lastSeenAt, s.absoluteExpiresAt);
  }

  session(idHash: string): SessionRecord | null {
    const r = this.db
      .prepare("SELECT csrf_token, created_at, last_seen_at, absolute_expires_at FROM sessions WHERE id_hash = ?")
      .get(idHash) as { csrf_token: string; created_at: number; last_seen_at: number; absolute_expires_at: number } | undefined;
    return r === undefined
      ? null
      : { csrfToken: r.csrf_token, createdAt: r.created_at, lastSeenAt: r.last_seen_at, absoluteExpiresAt: r.absolute_expires_at };
  }

  touchSession(idHash: string, at: number): void {
    this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ? AND last_seen_at < ?").run(at, idHash, at);
  }

  deleteSession(idHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
  }

  /** Remove sessions past either limit. */
  deleteExpiredSessions(now: number, idleMs: number): void {
    this.db.prepare("DELETE FROM sessions WHERE absolute_expires_at <= ? OR last_seen_at + ? <= ?").run(now, idleMs, now);
  }

  sessionCount(): number {
    return (this.db.prepare("SELECT count(*) AS n FROM sessions").get() as { n: number }).n;
  }

  // ---- failed sign-in attempts (one account, so one counter) -----------------

  lockout(): LockoutState {
    const r = this.db.prepare("SELECT consecutive, locked_until FROM login_failures WHERE id = 1").get() as
      | { consecutive: number; locked_until: number }
      | undefined;
    return r === undefined ? { consecutive: 0, lockedUntil: 0 } : { consecutive: r.consecutive, lockedUntil: r.locked_until };
  }

  /** Count a failure; `lockFor(consecutive)` gives the lock length in ms (0 for none). */
  recordFailure(now: number, lockFor: (consecutive: number) => number): LockoutState {
    return this.tx(() => {
      const consecutive = this.lockout().consecutive + 1;
      const ms = lockFor(consecutive);
      const lockedUntil = ms > 0 ? now + ms : 0;
      this.db
        .prepare(
          "INSERT INTO login_failures (id, consecutive, locked_until) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET consecutive = excluded.consecutive, locked_until = excluded.locked_until",
        )
        .run(consecutive, lockedUntil);
      return { consecutive, lockedUntil };
    });
  }

  resetFailures(): void {
    this.db.prepare("DELETE FROM login_failures").run();
  }
}
