/**
 * AUTH STUB — not for production.
 *
 * This module allows all requests through in development mode without any
 * token validation. It exists solely to allow the API scaffold to run while
 * the Cognito PKCE integration is pending.
 *
 * Replace with Cognito PKCE validation before any real data or external access.
 * See Technical Spec §5: Cognito authorization-code flow with PKCE and TOTP MFA.
 * The production middleware must validate: issuer, audience/client, token use,
 * signature, expiry, and allowed subject. Session cookies: Secure, HttpOnly,
 * SameSite. Tokens never go into browser local storage.
 */

import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Dev-only stub that logs a warning and passes every request through.
 * The function signature matches Fastify's preHandler hook so it can be
 * used as a route-level or plugin-level hook without modification when
 * replaced.
 */
export async function authStub(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  request.log.warn(
    { url: request.url, method: request.method },
    "AUTH STUB — not for production"
  );
}
