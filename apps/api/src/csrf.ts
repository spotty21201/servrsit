/**
 * CSRF protection for state-changing care requests (Technical Spec §5, §9.2).
 *
 * "CSRF-ready" for the auth stub: a per-process random token, fetched by the
 * same-origin UI from GET /api/csrf and sent back in the X-CSRF-Token header,
 * compared in constant time. Requests carrying an Origin header must come
 * from an allowed origin, and a browser-reported cross-site request is
 * refused. When real sessions arrive (Cognito, T-023), the token binds to the
 * session instead of the process.
 *
 * This blocks cross-site browser requests. It does not authenticate a direct
 * client: that is the job of the missing login (D3).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

export const CSRF_HEADER = "x-csrf-token";

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://100.104.220.8:5173",
];

export class CsrfGuard {
  readonly token: string;

  constructor(private readonly allowedOrigins: readonly string[] = DEFAULT_ALLOWED_ORIGINS) {
    this.token = randomBytes(32).toString("hex");
  }

  check(headers: Readonly<Record<string, string | string[] | undefined>>): boolean {
    const site = headers["sec-fetch-site"];
    if (site === "cross-site") return false;
    const origin = headers["origin"];
    if (typeof origin === "string" && !this.allowedOrigins.includes(origin)) return false;
    const given = headers[CSRF_HEADER];
    if (typeof given !== "string" || given.length !== this.token.length) return false;
    return timingSafeEqual(Buffer.from(given), Buffer.from(this.token));
  }
}
