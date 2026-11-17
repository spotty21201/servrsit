/**
 * Owner sign-in client (T-053, ADR-017). Data layer only: no UI.
 *
 * The session lives in an HttpOnly cookie the browser handles; this module
 * never sees it. What it keeps in memory is the session's CSRF token, which
 * every state-changing request must send (see `csrfHeaders`). Nothing is
 * written to localStorage or sessionStorage.
 *
 * Flow:
 *   first run:  startSetup(token, username, password) -> show the TOTP secret
 *               confirmSetup(code)                    -> show the 10 recovery codes ONCE
 *   sign-in:    login(username, password) -> verifySecondFactor({code}) or ({recoveryCode})
 *   any time:   getSession(), logout()
 */

import {
  AUTH_CSRF_HEADER,
  AuthErrorSchema,
  LoginResponseSchema,
  SessionResponseSchema,
  SessionInfoSchema,
  SetupConfirmResponseSchema,
  SetupStartResponseSchema,
  type AuthErrorCode,
  type SessionInfo,
  type SessionResponse,
  type SetupConfirmResponse,
  type SetupStartResponse,
} from "@servrsit/contracts";

/** The part of a runtime schema this client needs (keeps zod out of the web app's direct dependencies). */
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export const AUTH_TIMEOUT_MS = 10_000;
const AUTH_MAX_BYTES = 16 * 1024;

export type AuthClientErrorKind = AuthErrorCode | "NETWORK" | "TIMEOUT" | "INVALID_RESPONSE";

export interface AuthClientError {
  readonly kind: AuthClientErrorKind;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
}

export type AuthResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: AuthClientError };

export interface AuthClientOptions {
  /** For tests. Defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

// ---- the CSRF token of the current session (memory only) ---------------------------

let csrfToken: string | null = null;

/** Headers to add to every POST, PUT, PATCH or DELETE. Empty when signed out. */
export function csrfHeaders(): Record<string, string> {
  return csrfToken === null ? {} : { [AUTH_CSRF_HEADER]: csrfToken };
}

function remember(info: SessionResponse): void {
  csrfToken = info.authenticated ? info.csrfToken : null;
}

/** For tests. */
export function resetAuthClientState(): void {
  csrfToken = null;
}

// ---- transport ------------------------------------------------------------------

async function call<T>(
  method: "GET" | "POST",
  url: string,
  body: unknown,
  schema: Parser<T> | null,
  options: AuthClientOptions,
  extraHeaders: Record<string, string> = {},
): Promise<AuthResult<T>> {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? AUTH_TIMEOUT_MS);
  try {
    const response = await doFetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    const text = response.status === 204 ? "" : await response.text();
    if (new TextEncoder().encode(text).length > AUTH_MAX_BYTES) return { ok: false, error: { kind: "INVALID_RESPONSE", status: response.status } };
    let json: unknown = null;
    try {
      json = text.length === 0 ? null : (JSON.parse(text) as unknown);
    } catch {
      return { ok: false, error: { kind: "INVALID_RESPONSE", status: response.status } };
    }
    if (!response.ok) {
      const parsed = AuthErrorSchema.safeParse(json);
      if (!parsed.success) return { ok: false, error: { kind: "INVALID_RESPONSE", status: response.status } };
      return {
        ok: false,
        error: {
          kind: parsed.data.error,
          status: response.status,
          ...(parsed.data.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: parsed.data.retryAfterSeconds }),
        },
      };
    }
    if (schema === null) return { ok: true, data: undefined as T };
    const parsed = schema.safeParse(json);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, error: { kind: "INVALID_RESPONSE", status: response.status } };
  } catch {
    return { ok: false, error: { kind: timedOut ? "TIMEOUT" : "NETWORK" } };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

// ---- the API ------------------------------------------------------------------------

/** Whether this browser has a session. Never says whether an owner account exists. */
export async function getSession(options: AuthClientOptions = {}): Promise<AuthResult<SessionResponse>> {
  const r = await call("GET", "/api/auth/session", undefined, SessionResponseSchema, options);
  if (r.ok) remember(r.data);
  return r;
}

/** First run, step 1. The response holds the TOTP secret: show it, never store it. */
export function startSetup(
  setupToken: string,
  username: string,
  password: string,
  options: AuthClientOptions = {},
): Promise<AuthResult<SetupStartResponse>> {
  return call("POST", "/api/auth/setup", { setupToken, username, password }, SetupStartResponseSchema, options);
}

/** First run, step 2. The recovery codes are shown once: the API cannot show them again. */
export async function confirmSetup(code: string, options: AuthClientOptions = {}): Promise<AuthResult<SetupConfirmResponse>> {
  const r = await call("POST", "/api/auth/setup/confirm", { code }, SetupConfirmResponseSchema, options);
  if (r.ok) remember(r.data.session);
  return r;
}

/** Sign-in, step 1. Success means "now ask for the code", not "signed in". */
export function login(username: string, password: string, options: AuthClientOptions = {}): Promise<AuthResult<{ next: "totp" }>> {
  return call("POST", "/api/auth/login", { username, password }, LoginResponseSchema, options);
}

/** Sign-in, step 2: a 6-digit code from the authenticator, or one recovery code. */
export async function verifySecondFactor(
  proof: { readonly code: string } | { readonly recoveryCode: string },
  options: AuthClientOptions = {},
): Promise<AuthResult<SessionInfo>> {
  const r = await call("POST", "/api/auth/totp", proof, SessionInfoSchema, options);
  if (r.ok) remember(r.data);
  return r;
}

export async function logout(options: AuthClientOptions = {}): Promise<AuthResult<void>> {
  const r = await call<void>("POST", "/api/auth/logout", undefined, null, options, csrfHeaders());
  if (r.ok) csrfToken = null;
  return r;
}
