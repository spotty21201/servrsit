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
/** Failures allowed before the first lock. */
export const LOCKOUT_THRESHOLD = 5;
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
}

function printSetupToken(setupToken: string): void {
  process.stderr.write(
    `\nServrSit first-run setup. No owner account exists yet.\nOne-time setup token (works once, replaced on restart):\n\n  ${setupToken}\n\n`,
  );
}

export class OwnerAuth {
  private readonly store: SqliteAuthStore;
  private readonly now: () => number;
  private readonly onSetupToken: (setupToken: string) => void;
  private dummyHash: string | null = null;

  constructor(options: OwnerAuthOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => Date.now());
    this.onSetupToken = options.onSetupToken ?? printSetupToken;
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
    if (!this.store.consumeSetupToken(sha256(request.setupToken), now)) return fail("SETUP_UNAVAILABLE");
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
    const ticketHash = sha256(ticket);
    const now = this.now();
    const e = this.store.enrolment(ticketHash);
    if (e === null || e.expiresAt <= now || e.attempts >= MAX_TICKET_ATTEMPTS) {
      if (e !== null) this.store.deleteEnrolment(ticketHash);
      return fail("SETUP_UNAVAILABLE");
    }
    const counter = this.matchingCounter(e.totpSecret, e.username, code, now);
    if (counter === null) {
      this.store.bumpEnrolmentAttempts(ticketHash);
      return fail("INVALID_CODE");
    }
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    const hashes = recoveryCodes.map((c) => sha256(normaliseRecoveryCode(c)));
    if (!this.store.completeEnrolment(ticketHash, counter, hashes, now)) return fail("SETUP_UNAVAILABLE");
    return { ok: true, value: { recoveryCodes, session: this.newSession(e.username) } };
  }

  // ---- sign-in ----------------------------------------------------------------

  private locked(now: number): AuthResult<never> | null {
    const { lockedUntil } = this.store.lockout();
    return lockedUntil > now ? fail("LOCKED_OUT", Math.max(1, Math.ceil((lockedUntil - now) / 1000))) : null;
  }

  private failure<T>(error: AuthErrorCode, now: number): AuthResult<T> {
    const state = this.store.recordFailure(now, lockDurationMs);
    return state.lockedUntil > now ? fail("LOCKED_OUT", Math.max(1, Math.ceil((state.lockedUntil - now) / 1000))) : fail(error);
  }

  /** Step 1: password. Returns a short-lived ticket for the TOTP step, never a session. */
  async login(username: string, password: string): Promise<AuthResult<{ ticket: string }>> {
    const now = this.now();
    const locked = this.locked(now);
    if (locked !== null) return locked;
    const owner = this.store.owner();
    const against = owner?.passwordHash ?? this.dummyHash;
    if (against === null) throw new Error("OwnerAuth.init() was not called");
    const passwordOk = await verify(against, password).catch(() => false);
    const usernameOk = owner !== null && sameText(username, owner.username);
    if (!(owner !== null && passwordOk && usernameOk)) return this.failure("INVALID_CREDENTIALS", now);
    const ticket = token();
    this.store.createMfaTicket(sha256(ticket), now + MFA_TICKET_MS);
    return { ok: true, value: { ticket } };
  }

  /** Step 2: TOTP code or a recovery code. The only way to a session after setup. */
  secondFactor(ticket: string | undefined, proof: { code: string } | { recoveryCode: string }): AuthResult<NewSession> {
    const now = this.now();
    const locked = this.locked(now);
    if (locked !== null) return locked;
    if (ticket === undefined || !OPAQUE.test(ticket)) return fail("MFA_REQUIRED");
    const ticketHash = sha256(ticket);
    const t = this.store.mfaTicket(ticketHash);
    const owner = this.store.owner();
    if (t === null || owner === null || t.expiresAt <= now || t.attempts >= MAX_TICKET_ATTEMPTS) {
      if (t !== null) this.store.deleteMfaTicket(ticketHash);
      return fail("MFA_REQUIRED");
    }

    let ok: boolean;
    if ("code" in proof) {
      const counter = this.matchingCounter(owner.totpSecret, owner.username, proof.code, now);
      // The atomic update refuses a step already used (a replay) or older than the last one.
      ok = counter !== null && this.store.acceptTotpCounter(counter);
    } else {
      ok = this.store.useRecoveryCode(sha256(normaliseRecoveryCode(proof.recoveryCode)), now);
    }
    if (!ok) {
      this.store.bumpMfaAttempts(ticketHash);
      return this.failure("INVALID_CODE", now);
    }
    this.store.deleteMfaTicket(ticketHash);
    this.store.resetFailures();
    return { ok: true, value: this.newSession(owner.username) };
  }

  private totp(secretBase32: string, username: string): TOTP {
    return new TOTP({ issuer: TOTP_ISSUER, label: username, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });
  }

  /** The time step `code` belongs to (current step +-1), or null. */
  private matchingCounter(secretBase32: string, username: string, code: string, now: number): number | null {
    if (!/^\d{6}$/.test(code)) return null;
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
      idleExpiresAt: new Date(Math.min(lastSeenAt + IDLE_TIMEOUT_MS, absoluteExpiresAt)).toISOString(),
      absoluteExpiresAt: new Date(absoluteExpiresAt).toISOString(),
    };
  }

  private newSession(username: string): NewSession {
    const now = this.now();
    const id = token();
    const csrfToken = token();
    const absoluteExpiresAt = now + ABSOLUTE_TIMEOUT_MS;
    this.store.createSession(sha256(id), { csrfToken, createdAt: now, lastSeenAt: now, absoluteExpiresAt });
    return { id, info: this.info(username, csrfToken, now, absoluteExpiresAt) };
  }

  /** The session for a cookie value, refreshed for idle time; null if missing, malformed or expired. */
  resolve(cookieValue: string | undefined): ResolvedSession | null {
    if (cookieValue === undefined || !OPAQUE.test(cookieValue)) return null;
    const idHash = sha256(cookieValue);
    const s = this.store.session(idHash);
    const owner = this.store.owner();
    if (s === null || owner === null) return null;
    const now = this.now();
    if (now >= s.absoluteExpiresAt || now >= s.lastSeenAt + IDLE_TIMEOUT_MS) {
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
