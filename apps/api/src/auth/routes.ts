/**
 * Auth routes and the global auth guard (T-053, ADR-017).
 *
 * The guard runs on every request before routing, validation and handlers:
 *  - /health and other non-/api routes: open.
 *  - The session-creating routes below: open; they check Origin themselves.
 *  - Every other /api route (registered or not): 401 without a valid session.
 *    State-changing methods also need an allowed Origin and the session's
 *    CSRF token, else 403.
 *
 * Responses never contain stack traces, server names or data, and never say
 * whether the owner account exists. Log lines carry outcome codes only:
 * never usernames, passwords, codes, tokens, tickets or session ids.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AUTH_SESSION_COOKIE,
  LoginRequestSchema,
  SetupConfirmRequestSchema,
  SetupStartRequestSchema,
  TotpRequestSchema,
  type AuthErrorCode,
} from "@servrsit/contracts";
import { SlidingWindowLimiter } from "../assistant/rate-limit.js";
import { CSRF_HEADER, originAllowed, STATE_CHANGING_METHODS } from "../csrf.js";
import {
  ABSOLUTE_TIMEOUT_MS,
  ENROLMENT_MS,
  MFA_TICKET_MS,
  TRUSTED_DEVICE_MS,
  type AttemptSource,
  type AuthResult,
  type OwnerAuth,
  type ResolvedSession,
} from "./owner-auth.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the auth guard for every authenticated /api request. */
    authSession: ResolvedSession | null;
  }
}

export const MFA_COOKIE = "servrsit_mfa";
/** T-066: set after a full sign-in; this browser then keeps its own rate-limit and lockout allowance. */
export const DEVICE_COOKIE = "servrsit_device";
export const ENROL_COOKIE = "servrsit_enrol";
export const AUTH_RATE_LIMIT = 10;
export const AUTH_RATE_WINDOW_MS = 60_000;

/** Routes that answer without a session: they create one. Matched against the registered route pattern. */
export const PUBLIC_AUTH_ROUTES: ReadonlySet<string> = new Set([
  "/api/auth/setup",
  "/api/auth/setup/confirm",
  "/api/auth/login",
  "/api/auth/totp",
  "/api/auth/session",
  "/api/auth/logout",
]);

const STATUS: Readonly<Record<AuthErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_CODE: 401,
  MFA_REQUIRED: 401,
  LOCKED_OUT: 429,
  RATE_LIMITED: 429,
  INVALID_INPUT: 400,
  CSRF_INVALID: 403,
  SETUP_UNAVAILABLE: 403,
  CLOCK_UNTRUSTED: 409,
};

function sendError(reply: FastifyReply, error: AuthErrorCode, retryAfterSeconds?: number): FastifyReply {
  reply.code(STATUS[error]).header("cache-control", "no-store");
  if (retryAfterSeconds !== undefined) {
    reply.header("retry-after", String(retryAfterSeconds));
    return reply.send({ error, retryAfterSeconds });
  }
  return reply.send({ error });
}

export interface AuthGuardOptions {
  readonly auth: OwnerAuth;
  readonly allowedOrigins?: readonly string[] | undefined;
}

/** Install on the ROOT instance so it covers every route, including 404s. */
export function installAuthGuard(fastify: FastifyInstance, options: AuthGuardOptions): void {
  fastify.decorateRequest("authSession", null);
  fastify.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") return;
    const route = request.routeOptions.url;
    const rawPath = request.url.split("?")[0] ?? "";
    const underApi = route === undefined ? rawPath === "/api" || rawPath.startsWith("/api/") : route === "/api" || route.startsWith("/api/");
    if (!underApi) return;
    if (route !== undefined && PUBLIC_AUTH_ROUTES.has(route)) return;

    const session = options.auth.resolve(request.cookies[AUTH_SESSION_COOKIE]);
    if (session === null) return sendError(reply, "UNAUTHENTICATED");
    if (
      STATE_CHANGING_METHODS.has(request.method) &&
      (!originAllowed(request.headers, options.allowedOrigins) || !options.auth.csrfMatches(session, request.headers[CSRF_HEADER]))
    ) {
      request.log.info({ method: request.method }, "auth: CSRF or Origin check failed");
      return sendError(reply, "CSRF_INVALID");
    }
    request.authSession = session;
  });
}

export interface AuthRouteOptions {
  readonly auth: OwnerAuth;
  readonly allowedOrigins?: readonly string[] | undefined;
  /** Force the Secure cookie attribute (production). Otherwise it follows the request protocol. */
  readonly secureCookies?: boolean | undefined;
  /** For tests: one limiter for every source, replacing the per-source limits. */
  readonly limiter?: SlidingWindowLimiter | undefined;
  /** Milliseconds since the epoch, shared with OwnerAuth. For tests. */
  readonly now?: (() => number) | undefined;
}

export async function authRoutes(fastify: FastifyInstance, o: AuthRouteOptions): Promise<void> {
  // T-066 D-A1: one allowance per source (trusted device, else address), so an anonymous caller
  // cannot use up the owner's. Bounded: the map is cleared if it ever grows past MAX_LIMITERS.
  const MAX_LIMITERS = 1000;
  const limiters = new Map<string, SlidingWindowLimiter>();
  const limiterFor = (key: string): SlidingWindowLimiter => {
    if (o.limiter !== undefined) return o.limiter;
    let l = limiters.get(key);
    if (l === undefined) {
      if (limiters.size >= MAX_LIMITERS) limiters.clear();
      l = new SlidingWindowLimiter(AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_MS, o.now);
      limiters.set(key, l);
    }
    return l;
  };
  const sourceOf = (request: FastifyRequest): AttemptSource => ({ address: request.ip, deviceCookie: request.cookies[DEVICE_COOKIE] });

  const cookie = (request: FastifyRequest, reply: FastifyReply, name: string, value: string, path: string, maxAgeMs: number) =>
    reply.setCookie(name, value, {
      path,
      httpOnly: true,
      sameSite: "strict",
      secure: o.secureCookies === true || request.protocol === "https",
      maxAge: Math.floor(maxAgeMs / 1000),
    });
  const clear = (reply: FastifyReply, name: string, path: string) =>
    reply.clearCookie(name, { path, httpOnly: true, sameSite: "strict" });

  // Malformed bodies use the auth error contract, never Fastify's default body.
  fastify.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 400 && status < 500) return sendError(reply, "INVALID_INPUT");
    request.log.error({ code: (error as { code?: string }).code ?? null }, "auth: request failed");
    return reply.code(500).send({ error: "INTERNAL" });
  });

  /** Origin check for the session-creating POSTs. Returns true when the request may continue. */
  const admit = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!originAllowed(request.headers, o.allowedOrigins)) {
      sendError(reply, "CSRF_INVALID");
      return false;
    }
    return true;
  };

  /** T-066 D-A1: counted only after the body is valid, against the request's own source. */
  const withinLimit = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const limiter = limiterFor(o.auth.sourceKey(sourceOf(request)).key);
    if (limiter.tryAcquire()) return true;
    sendError(reply, "RATE_LIMITED", Math.max(1, Math.ceil(limiter.retryAfterMs() / 1000)));
    return false;
  };

  const issueDevice = (request: FastifyRequest, reply: FastifyReply, device: string | null) => {
    if (device !== null) cookie(request, reply, DEVICE_COOKIE, device, "/api/auth", TRUSTED_DEVICE_MS);
  };

  const outcome = (request: FastifyRequest, step: string, result: AuthResult<unknown>) =>
    request.log.info({ step, ok: result.ok, error: result.ok ? null : result.error }, "auth: attempt");

  fastify.post("/api/auth/setup", { bodyLimit: 1024 }, async (request, reply) => {
    if (!admit(request, reply)) return reply;
    const parsed = SetupStartRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "INVALID_INPUT");
    if (!withinLimit(request, reply)) return reply;
    const result = await o.auth.startSetup(parsed.data);
    outcome(request, "setup", result);
    if (!result.ok) return sendError(reply, result.error);
    cookie(request, reply, ENROL_COOKIE, result.value.ticket, "/api/auth/setup", ENROLMENT_MS);
    return reply.header("cache-control", "no-store").send({
      totpSecret: result.value.totpSecret,
      otpauthUri: result.value.otpauthUri,
      expiresInSeconds: result.value.expiresInSeconds,
    });
  });

  fastify.post("/api/auth/setup/confirm", { bodyLimit: 256 }, async (request, reply) => {
    if (!admit(request, reply)) return reply;
    const parsed = SetupConfirmRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "INVALID_INPUT");
    if (!withinLimit(request, reply)) return reply;
    const result = o.auth.confirmSetup(request.cookies[ENROL_COOKIE], parsed.data.code);
    outcome(request, "setup-confirm", result);
    if (!result.ok) return sendError(reply, result.error);
    clear(reply, ENROL_COOKIE, "/api/auth/setup");
    cookie(request, reply, AUTH_SESSION_COOKIE, result.value.session.id, "/", ABSOLUTE_TIMEOUT_MS);
    issueDevice(request, reply, o.auth.trustThisDevice(sourceOf(request)));
    return reply.header("cache-control", "no-store").send({ recoveryCodes: result.value.recoveryCodes, session: result.value.session.info });
  });

  fastify.post("/api/auth/login", { bodyLimit: 1024 }, async (request, reply) => {
    if (!admit(request, reply)) return reply;
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "INVALID_INPUT");
    if (!withinLimit(request, reply)) return reply;
    const result = await o.auth.login(parsed.data.username, parsed.data.password, sourceOf(request));
    outcome(request, "password", result);
    if (!result.ok) return sendError(reply, result.error, result.retryAfterSeconds);
    cookie(request, reply, MFA_COOKIE, result.value.ticket, "/api/auth", MFA_TICKET_MS);
    return reply.header("cache-control", "no-store").send({ next: "totp" });
  });

  fastify.post("/api/auth/totp", { bodyLimit: 256 }, async (request, reply) => {
    if (!admit(request, reply)) return reply;
    const parsed = TotpRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "INVALID_INPUT");
    if (!withinLimit(request, reply)) return reply;
    const result = o.auth.secondFactor(request.cookies[MFA_COOKIE], parsed.data, sourceOf(request));
    outcome(request, "code" in parsed.data ? "totp" : "recovery-code", result);
    if (!result.ok) return sendError(reply, result.error, result.retryAfterSeconds);
    clear(reply, MFA_COOKIE, "/api/auth");
    cookie(request, reply, AUTH_SESSION_COOKIE, result.value.id, "/", ABSOLUTE_TIMEOUT_MS);
    issueDevice(request, reply, result.value.device);
    return reply.header("cache-control", "no-store").send(result.value.info);
  });

  fastify.get("/api/auth/session", async (request, reply) => {
    const session = o.auth.resolve(request.cookies[AUTH_SESSION_COOKIE]);
    return reply.header("cache-control", "no-store").send(session === null ? { authenticated: false } : session.info);
  });

  fastify.post("/api/auth/logout", { bodyLimit: 256 }, async (request, reply) => {
    const session = o.auth.resolve(request.cookies[AUTH_SESSION_COOKIE]);
    if (session !== null) {
      if (!originAllowed(request.headers, o.allowedOrigins) || !o.auth.csrfMatches(session, request.headers[CSRF_HEADER])) {
        return sendError(reply, "CSRF_INVALID");
      }
      o.auth.logout(session);
    }
    clear(reply, AUTH_SESSION_COOKIE, "/");
    return reply.code(204).header("cache-control", "no-store").send();
  });

  /** The session's CSRF token (authenticated: not in PUBLIC_AUTH_ROUTES). */
  fastify.get("/api/csrf", async (request, reply) =>
    reply.header("cache-control", "no-store").send({ token: request.authSession?.csrfToken, header: CSRF_HEADER }),
  );
}

export default authRoutes;
