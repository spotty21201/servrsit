/**
 * Cross-site request protection (Technical Spec §5, §9.2; T-053).
 *
 * Two checks, both on every state-changing /api request:
 *  - Origin: a browser-reported cross-site request is refused, and a request
 *    that carries an Origin header must come from an allowed origin.
 *  - CSRF token: the X-CSRF-Token header must equal the token bound to the
 *    caller's session (see auth/owner-auth.ts). Requests that create a
 *    session (setup, login, TOTP) have no session yet, so they get the
 *    Origin check only; SameSite=Strict cookies cover the rest.
 */

import { AUTH_CSRF_HEADER } from "@servrsit/contracts";

export const CSRF_HEADER = AUTH_CSRF_HEADER;

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://100.104.220.8:5173",
];

export const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function originAllowed(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  allowedOrigins: readonly string[] = DEFAULT_ALLOWED_ORIGINS,
): boolean {
  if (headers["sec-fetch-site"] === "cross-site") return false;
  const origin = headers["origin"];
  if (origin === undefined) return true;
  return typeof origin === "string" && allowedOrigins.includes(origin);
}
