/**
 * Local owner authentication (T-053, ADR-017 "Local owner auth until Cognito").
 *
 *   POST /api/auth/setup          {setupToken, username, password} -> TOTP secret to enrol (first run only)
 *   POST /api/auth/setup/confirm  {code}                            -> 10 recovery codes (shown once) + session
 *   POST /api/auth/login          {username, password}              -> {next: "totp"}; no session yet
 *   POST /api/auth/totp           {code} | {recoveryCode}           -> session
 *   GET  /api/auth/session                                          -> session info, or {authenticated: false}
 *   POST /api/auth/logout                                           -> 204
 *
 * No response says whether an owner account exists.
 */

import { z } from "zod";

export const AUTH_SESSION_COOKIE = "servrsit_session";
/** Header that carries the session's CSRF token on every state-changing request. */
export const AUTH_CSRF_HEADER = "x-csrf-token";

export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const PASSWORD_MIN_CHARS = 12;
export const PASSWORD_MAX_CHARS = 256;
export const RECOVERY_CODE_COUNT = 10;

const Username = z.string().regex(USERNAME_PATTERN);
const TotpCode = z.string().regex(/^\d{6}$/);

export const SetupStartRequestSchema = z
  .object({
    setupToken: z.string().min(16).max(128),
    username: Username,
    password: z.string().min(PASSWORD_MIN_CHARS).max(PASSWORD_MAX_CHARS),
  })
  .strict();
export type SetupStartRequest = z.infer<typeof SetupStartRequestSchema>;

export const SetupStartResponseSchema = z
  .object({
    /** Base32 TOTP secret to add to an authenticator app. Shown once, during enrolment only. */
    totpSecret: z.string().regex(/^[A-Z2-7]+$/),
    otpauthUri: z.string().startsWith("otpauth://totp/"),
    /** Seconds the enrolment stays open for the confirming code. */
    expiresInSeconds: z.number().int().positive(),
  })
  .strict();
export type SetupStartResponse = z.infer<typeof SetupStartResponseSchema>;

export const SetupConfirmRequestSchema = z.object({ code: TotpCode }).strict();
export type SetupConfirmRequest = z.infer<typeof SetupConfirmRequestSchema>;

export const LoginRequestSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(PASSWORD_MAX_CHARS),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({ next: z.literal("totp") }).strict();
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const TotpRequestSchema = z.union([
  z.object({ code: TotpCode }).strict(),
  z.object({ recoveryCode: z.string().min(8).max(64) }).strict(),
]);
export type TotpRequest = z.infer<typeof TotpRequestSchema>;

export const SessionInfoSchema = z
  .object({
    authenticated: z.literal(true),
    username: Username,
    /** Send in the X-CSRF-Token header on every POST, PUT, PATCH and DELETE. */
    csrfToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
    csrfHeader: z.literal(AUTH_CSRF_HEADER),
    /** Ends after 60 minutes without a request. */
    idleExpiresAt: z.string().datetime(),
    /** Ends 8 hours after sign-in, whatever the activity. */
    absoluteExpiresAt: z.string().datetime(),
  })
  .strict();
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

export const SessionResponseSchema = z.union([
  SessionInfoSchema,
  z.object({ authenticated: z.literal(false) }).strict(),
]);
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const SetupConfirmResponseSchema = z
  .object({
    /** Shown exactly once. Each works once, in place of a TOTP code. */
    recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT),
    session: SessionInfoSchema,
  })
  .strict();
export type SetupConfirmResponse = z.infer<typeof SetupConfirmResponseSchema>;

export const AuthErrorCodeSchema = z.enum([
  /** No valid session. */
  "UNAUTHENTICATED",
  /** Wrong username or password. Same answer whether or not the account exists. */
  "INVALID_CREDENTIALS",
  /** Wrong, reused or expired TOTP or recovery code. */
  "INVALID_CODE",
  /** The password step was not completed, or it expired. Sign in again. */
  "MFA_REQUIRED",
  /** Too many failed attempts. Wait `retryAfterSeconds`. */
  "LOCKED_OUT",
  "RATE_LIMITED",
  "INVALID_INPUT",
  /** Missing or wrong CSRF token, or a disallowed Origin. */
  "CSRF_INVALID",
  /** Setup token wrong, already used, or setup already done. */
  "SETUP_UNAVAILABLE",
]);
export type AuthErrorCode = z.infer<typeof AuthErrorCodeSchema>;

export const AuthErrorSchema = z
  .object({
    error: AuthErrorCodeSchema,
    retryAfterSeconds: z.number().int().positive().optional(),
  })
  .strict();
export type AuthError = z.infer<typeof AuthErrorSchema>;
