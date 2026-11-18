/**
 * Local owner authentication (T-053, ADR-017 "Local owner auth until Cognito").
 * Follows Technical Spec §5 for what Cognito would have provided:
 *
 *  - One owner account. Password hashed with argon2id (@node-rs/argon2, OWASP
 *    minimum parameters: 19 MiB, 2 passes, 1 lane).
 *  - TOTP (RFC 6238, otpauth; SHA-1, 6 digits, 30 s, +-1 step) is required
 *    before any session exists. A time step is accepted once, never an older
 *    one, so a code cannot be replayed.
 *  - First run only: a one-time setup token, printed at startup, stored hashed,
 *    usable once. A restart before setup completes replaces it.
 *  - 10 recovery codes, stored hashed, shown once, each usable once.
 *  - Sessions are opaque random ids; only their SHA-256 is stored. 60 minutes
 *    idle, 8 hours absolute. Each session has its own CSRF token.
 *  - Failed password or second-factor attempts are counted for the account
 *    (there is only one), and lock sign-in with a doubling backoff.
 *  - Nothing says whether the account exists: a wrong username costs the same
 *    argon2 verification as a wrong password, and gives the same answer.
 *
 * Secrets never leave this module except to the caller that must show them
 * once (setup token to the console, TOTP secret and recovery codes to the
 * enrolling owner). Nothing here logs.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { Secret, TOTP } from "otpauth";
import {
  RECOVERY_CODE_COUNT,
  type AuthErrorCode,
  type SessionInfo,
  type SetupStartRequest,
  AUTH_CSRF_HEADER,
} from "@servrsit/contracts";
import type { SqliteAuthStore } from "@servrsit/store";

export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
export const MFA_TICKET_MS = 5 * 60 * 1000;
export const ENROLMENT_MS = 15 * 60 * 1000;
export const MAX_TICKET_ATTEMPTS = 5;
/** Failures from one source (address or trusted device) before that source is locked. */
export const LOCKOUT_THRESHOLD = 5;
/** T-066 D-A2: the account itself locks only on sustained failures from all sources together. */
export const ACCOUNT_LOCK_THRESHOLD = 20;
export const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
/** First account lock; each further account lock doubles, up to ACCOUNT_LOCK_MAX_MS, until the owner signs in. */
export const ACCOUNT_LOCK_MS = 15 * 60 * 1000;
export const ACCOUNT_LOCK_MAX_MS = 4 * 60 * 60 * 1000;
/** T-066 D-A1/D-A2: a browser that completed a full sign-in keeps its own allowance. */
export const TRUSTED_DEVICE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_TRUSTED_DEVICES = 20;
const MAX_TRACKED_SOURCES = 1000;
const LOCK_BASE_MS = 30_000;
const LOCK_MAX_MS = 15 * 60 * 1000;
const TOTP_ISSUER = "ServrSit";

const ARGON2 = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Lock length after `consecutive` failures: none up to the threshold, then 30 s doubling to 15 min. */
export function lockDurationMs(consecutive: number): number {
  if (consecutive < LOCKOUT_THRESHOLD) return 0;
  return Math.min(LOCK_MAX_MS, LOCK_BASE_MS * 2 ** (consecutive - LOCKOUT_THRESHOLD));
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const token = (bytes = 32): string => randomBytes(bytes).toString("base64url");
/** A 32-byte base64url value: exactly 43 characters. */
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;

function sameText(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
/** "ABCD-EFGH-JKMN-PQRS": 16 symbols from a 30-letter alphabet without look-alikes, about 78 bits. */
function newRecoveryCode(): string {
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    if (i % 4 === 3 && i < 15) out += "-";
  }
  return out;
}
const normaliseRecoveryCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export type AuthResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AuthErrorCode; readonly retryAfterSeconds?: number };

const fail = <T>(error: AuthErrorCode, retryAfterSeconds?: number): AuthResult<T> =>
  retryAfterSeconds === undefined ? { ok: false, error } : { ok: false, error, retryAfterSeconds };

export interface NewSession {
  /** The cookie value. Never stored, never logged. */
  readonly id: string;
  readonly info: SessionInfo;
  /** T-066: a new trusted-device cookie value, when this browser was not trusted yet. */
  readonly device: string | null;
}

/** Where an attempt came from (T-066). */
export interface AttemptSource {
  readonly address: string;
  /** The trusted-device cookie, if the browser sent one. Checked against the store. */
  readonly deviceCookie?: string | undefined;
}

export interface ResolvedSession {
  readonly idHash: string;
  readonly csrfToken: string;
  readonly info: SessionInfo;
}

export interface OwnerAuthOptions {
  readonly store: SqliteAuthStore;
  /** Milliseconds since the epoch. For tests. */
  readonly now?: (() => number) | undefined;
  /** Receives the one-time setup token at startup when no owner exists. Default: print to stderr. */
  readonly onSetupToken?: ((setupToken: string) => void) | undefined;
  /** T-066 D-A3: false while ServrSit's own clock is untrusted (T-063). Enrolment is refused then. */
  readonly clockTrusted?: (() => boolean) | undefined;
}

function printSetupToken(setupToken: string): void {
  process.stderr.write(
    `\nServrSit first-run setup. No owner account exists yet.\nSetup token (works until setup is confirmed; replaced on restart):\n\n  ${setupToken}\n\n`,
  );
}

export class OwnerAuth {
  private readonly store: SqliteAuthStore;
  /** Wall clock: TOTP codes are tied to it. */
  private readonly wallNow: () => number;
  private readonly onSetupToken: (setupToken: string) => void;
  private readonly clockTrusted: () => boolean;
  private dummyHash: string | null = null;

  constructor(options: OwnerAuthOptions) {
    this.store = options.store;
    this.wallNow = options.now ?? (() => Date.now());
    this.onSetupToken = options.onSetupToken ?? printSetupToken;
    this.clockTrusted = options.clockTrusted ?? (() => true);
  }

  /**
   * T-066 D-A3b: wall-clock time, with every stored time checked against it.
   * When the clock steps back (time sync fixing a fast clock), stored times
   * lie further in the future than they ever could: a lock longer than any
   * lock, a session last seen ahead of now, a ticket longer than its life.
   * Those are treated as stale (lock released, session ended, ticket expired),
   * in memory and after a restart alike.
   */
  private now(): number {
    return this.wallNow();
  }

  private wallIso(t: number): string {
    return new Date(t).toISOString();
  }

  /** Call once at startup. Issues a fresh setup token if no owner exists. */
  async init(): Promise<void> {
    // Verifying against this keeps a wrong username as slow as a wrong password.
    this.dummyHash = await hash(token(), ARGON2);
    this.store.deleteExpiredTickets(this.now());
    this.store.deleteExpiredSessions(this.now(), IDLE_TIMEOUT_MS);
    if (!this.store.hasOwner()) {
      const setupToken = token();
      this.store.replaceSetupToken(sha256(setupToken), this.now());
      this.onSetupToken(setupToken);
    }
  }

  // ---- first-run enrolment ------------------------------------------------------

  /** Step 1: use the setup token, set username and password, receive the TOTP secret. */
  async startSetup(
    request: SetupStartRequest,
  ): Promise<AuthResult<{ ticket: string; totpSecret: string; otpauthUri: string; expiresInSeconds: number }>> {
    const now = this.now();
    // T-066 D-A4: the token stays valid until setup is confirmed, so an abandoned enrolment can be restarted.
    if (!this.store.setupTokenValid(sha256(request.setupToken))) return fail("SETUP_UNAVAILABLE");
    // T-066 D-A3: a TOTP enrolment on a wrong clock would lock the owner out once the clock is fixed.
    if (!this.clockTrusted()) return fail("CLOCK_UNTRUSTED");
    const secret = new Secret({ size: 20 });
    const ticket = token();
    this.store.createEnrolment(sha256(ticket), {
      username: request.username,
      passwordHash: await hash(request.password, ARGON2),
      totpSecret: secret.base32,
      expiresAt: now + ENROLMENT_MS,
    });
    const otpauthUri = this.totp(secret.base32, request.username).toString();
    return { ok: true, value: { ticket, totpSecret: secret.base32, otpauthUri, expiresInSeconds: ENROLMENT_MS / 1000 } };
  }

  /** Step 2: prove the authenticator works. Creates the owner, the recovery codes and the first session. */
  confirmSetup(ticket: string | undefined, code: string): AuthResult<{ recoveryCodes: string[]; session: NewSession }> {
    if (ticket === undefined || !OPAQUE.test(ticket)) return fail("SETUP_UNAVAILABLE");
    if (!this.clockTrusted()) return fail("CLOCK_UNTRUSTED");
    const ticketHash = sha256(ticket);
    const now = this.now();
    const e = this.store.enrolment(ticketHash);
    if (e === null || e.expiresAt > now + ENROLMENT_MS + 60_000 || e.expiresAt <= now || e.attempts >= MAX_TICKET_ATTEMPTS) {
      if (e !== null) this.store.deleteEnrolment(ticketHash);
      return fail("SETUP_UNAVAILABLE");
    }
    const counter = this.matchingCounter(e.totpSecret, e.username, code);
    if (counter === null) {
      this.store.bumpEnrolmentAttempts(ticketHash);
      return fail("INVALID_CODE");
    }
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    const hashes = recoveryCodes.map((c) => sha256(normaliseRecoveryCode(c)));
    if (!this.store.completeEnrolment(ticketHash, counter, hashes, now)) return fail("SETUP_UNAVAILABLE");
    return { ok: true, value: { recoveryCodes, session: this.newSession(e.username, null) } };
  }

  // ---- sign-in ----------------------------------------------------------------

  // ---- sources, locks and trusted devices (T-066) --------------------------------

  /** The key an attempt is counted under: its trusted device if valid, else its address. */
  sourceKey(source: AttemptSource): { key: string; trusted: boolean; deviceHash: string | null } {
    const c = source.deviceCookie;
    if (c !== undefined && OPAQUE.test(c)) {
      const h = sha256(c);
      if (this.store.isTrustedDevice(h)) return { key: `device:${h}`, trusted: true, deviceHash: h };
    }
    return { key: `addr:${source.address}`, trusted: false, deviceHash: null };
  }

  /** A stored lock far beyond any lock length was set before a clock step back (and a restart): ignore it. */
  private lockOf(key: string, now: number): number {
    const r = this.store.sourceFailures(key);
    if (r.lockedUntil > now + Math.max(LOCK_MAX_MS, ACCOUNT_LOCK_MAX_MS) + 60_000) {
      this.store.clearSourceFailures(key);
      return 0;
    }
    return r.lockedUntil;
  }

  private locked(source: AttemptSource, now: number): AuthResult<never> | null {
    const { key, trusted } = this.sourceKey(source);
    const own = this.lockOf(key, now);
    const account = trusted ? 0 : this.lockOf("account", now);
    const until = Math.max(own, account);
    return until > now ? fail("LOCKED_OUT", Math.max(1, Math.ceil((until - now) / 1000))) : null;
  }

  /**
   * Count a failure for its source (doubling lock from the 5th, capped at 15 min) and for the
   * account: 20 failures in 15 min from all sources together lock it, for 15 min the first time
   * and doubling per further account lock up to 4 h, until the owner signs in. Trusted devices are
   * exempt from the account lock, so an anonymous caller cannot keep the owner out; someone who
   * has the password and rotates addresses still gets about 200 code guesses a day.
   */
  private failure<T>(error: AuthErrorCode, source: AttemptSource, now: number): AuthResult<T> {
    const { key } = this.sourceKey(source);
    const own = this.store.sourceFailures(key);
    const consecutive = own.consecutive + 1;
    const ms = lockDurationMs(consecutive);
    this.store.writeSourceFailures(key, { consecutive, lockedUntil: ms > 0 ? now + ms : 0, windowStart: now });
    this.store.pruneSourceFailures(MAX_TRACKED_SOURCES);

    const acc = this.store.sourceFailures("account");
    const fresh = now - acc.windowStart > ACCOUNT_WINDOW_MS;
    const count = fresh ? 1 : acc.consecutive + 1;
    if (count >= ACCOUNT_LOCK_THRESHOLD && acc.lockedUntil <= now) {
      // The count starts again: holding the lock needs another 20 failures, not one at expiry.
      const level = this.store.sourceFailures("account-level").consecutive + 1;
      this.store.writeSourceFailures("account-level", { consecutive: level, lockedUntil: 0, windowStart: now });
      const ms = Math.min(ACCOUNT_LOCK_MAX_MS, ACCOUNT_LOCK_MS * 2 ** (level - 1));
      this.store.writeSourceFailures("account", { consecutive: 0, lockedUntil: now + ms, windowStart: now });
    } else {
      this.store.writeSourceFailures("account", { consecutive: count, lockedUntil: acc.lockedUntil, windowStart: fresh ? now : acc.windowStart });
    }
    return this.locked(source, now) ?? fail(error);
  }

  /** After setup confirmation: trust the enrolling browser. Returns a new device cookie value, or null. */
  trustThisDevice(source: AttemptSource): string | null {
    return this.succeeded(source, this.now());
  }

  private succeeded(source: AttemptSource, now: number): string | null {
    const { key, trusted, deviceHash } = this.sourceKey(source);
    this.store.clearSourceFailures(key);
    this.store.clearSourceFailures("account");
    this.store.clearSourceFailures("account-level");
    if (trusted && deviceHash !== null) {
      this.store.touchTrustedDevice(deviceHash, now);
      return null;
    }
    const device = token();
    this.store.addTrustedDevice(sha256(device), now, MAX_TRUSTED_DEVICES);
    return device;
  }

  // ---- sign-in ----------------------------------------------------------------

  /** Step 1: password. Returns a short-lived ticket for the TOTP step, never a session. */
  async login(username: string, password: string, source: AttemptSource): Promise<AuthResult<{ ticket: string }>> {
    const now = this.now();
    const locked = this.locked(source, now);
    if (locked !== null) return locked;
    const owner = this.store.owner();
    const against = owner?.passwordHash ?? this.dummyHash;
    if (against === null) throw new Error("OwnerAuth.init() was not called");
    const passwordOk = await verify(against, password).catch(() => false);
    const usernameOk = owner !== null && sameText(username, owner.username);
    if (!(owner !== null && passwordOk && usernameOk)) return this.failure("INVALID_CREDENTIALS", source, now);
    const ticket = token();
    this.store.createMfaTicket(sha256(ticket), now + MFA_TICKET_MS);
    return { ok: true, value: { ticket } };
  }

  /** Step 2: TOTP code or a recovery code. The only way to a session after setup. */
  secondFactor(ticket: string | undefined, proof: { code: string } | { recoveryCode: string }, source: AttemptSource): AuthResult<NewSession> {
    const now = this.now();
    const locked = this.locked(source, now);
    if (locked !== null) return locked;
    if (ticket === undefined || !OPAQUE.test(ticket)) return fail("MFA_REQUIRED");
    const ticketHash = sha256(ticket);
    const t = this.store.mfaTicket(ticketHash);
    const owner = this.store.owner();
    const ticketFromTheFuture = t !== null && t.expiresAt > now + MFA_TICKET_MS + 60_000;
    if (t === null || owner === null || ticketFromTheFuture || t.expiresAt <= now || t.attempts >= MAX_TICKET_ATTEMPTS) {
      if (t !== null) this.store.deleteMfaTicket(ticketHash);
      return fail("MFA_REQUIRED");
    }

    let ok: boolean;
    if ("code" in proof) {
      // T-066 D-A3: a step accepted while the clock was fast lies in the future after it is fixed.
      const current = this.totp(owner.totpSecret, owner.username).counter({ timestamp: this.wallNow() });
      if (owner.lastTotpCounter > current + 1) this.store.clampTotpCounter(current - 2);
      const counter = this.matchingCounter(owner.totpSecret, owner.username, proof.code);
      // The atomic update refuses a step already used (a replay) or older than the last one.
      ok = counter !== null && this.store.acceptTotpCounter(counter);
    } else {
      ok = this.store.useRecoveryCode(sha256(normaliseRecoveryCode(proof.recoveryCode)), now);
    }
    if (!ok) {
      this.store.bumpMfaAttempts(ticketHash);
      return this.failure("INVALID_CODE", source, now);
    }
    this.store.deleteMfaTicket(ticketHash);
    const device = this.succeeded(source, now);
    return { ok: true, value: this.newSession(owner.username, device) };
  }

  private totp(secretBase32: string, username: string): TOTP {
    return new TOTP({ issuer: TOTP_ISSUER, label: username, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });
  }

  /** The time step `code` belongs to (current step +-1), or null. */
  private matchingCounter(secretBase32: string, username: string, code: string): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const now = this.wallNow();
    const totp = this.totp(secretBase32, username);
    const delta = totp.validate({ token: code, timestamp: now, window: 1 });
    return delta === null ? null : totp.counter({ timestamp: now }) + delta;
  }

  // ---- sessions ---------------------------------------------------------------

  private info(username: string, csrfToken: string, lastSeenAt: number, absoluteExpiresAt: number): SessionInfo {
    return {
      authenticated: true,
      username,
      csrfToken,
      csrfHeader: AUTH_CSRF_HEADER,
      idleExpiresAt: this.wallIso(Math.min(lastSeenAt + IDLE_TIMEOUT_MS, absoluteExpiresAt)),
      absoluteExpiresAt: this.wallIso(absoluteExpiresAt),
    };
  }

  private newSession(username: string, device: string | null): NewSession {
    const now = this.now();
    const id = token();
    const csrfToken = token();
    const absoluteExpiresAt = now + ABSOLUTE_TIMEOUT_MS;
    this.store.createSession(sha256(id), { csrfToken, createdAt: now, lastSeenAt: now, absoluteExpiresAt });
    return { id, info: this.info(username, csrfToken, now, absoluteExpiresAt), device };
  }

  /** The session for a cookie value, refreshed for idle time; null if missing, malformed or expired. */
  resolve(cookieValue: string | undefined): ResolvedSession | null {
    if (cookieValue === undefined || !OPAQUE.test(cookieValue)) return null;
    const idHash = sha256(cookieValue);
    const s = this.store.session(idHash);
    const owner = this.store.owner();
    if (s === null || owner === null) return null;
    const now = this.now();
    // T-066 D-A3b: a session whose times lie in the future was made before a clock step back.
    // How long it has really been idle cannot be known, so it ends.
    const fromTheFuture = s.lastSeenAt > now + 60_000 || s.createdAt > now + 60_000;
    if (fromTheFuture || now >= s.absoluteExpiresAt || now >= s.lastSeenAt + IDLE_TIMEOUT_MS) {
      this.store.deleteSession(idHash);
      return null;
    }
    this.store.touchSession(idHash, now);
    return { idHash, csrfToken: s.csrfToken, info: this.info(owner.username, s.csrfToken, now, s.absoluteExpiresAt) };
  }

  /** Constant-time comparison of a request's CSRF header with the session's token. */
  csrfMatches(session: ResolvedSession, header: string | string[] | undefined): boolean {
    return typeof header === "string" && header.length > 0 && header.length <= 128 && sameText(header, session.csrfToken);
  }

  logout(session: ResolvedSession): void {
    this.store.deleteSession(session.idHash);
  }
}
