/**
 * Test support (T-053): enrol the owner and sign in through the REAL public
 * endpoints, exactly as a browser would. There is no bypass here: the helper
 * needs the setup token that buildServer hands to `onSetupToken`, and it
 * computes TOTP codes from the secret the setup step returned.
 *
 * Not imported by production code.
 */

import type { InjectOptions as FastifyInjectOptions, LightMyRequestResponse } from "fastify";
import { Secret, TOTP } from "otpauth";
import { AUTH_SESSION_COOKIE, SetupConfirmResponseSchema, SetupStartResponseSchema } from "@servrsit/contracts";
import { CSRF_HEADER } from "../csrf.js";
import { buildServer, type BuildServerOptions } from "../server.js";
import { ENROL_COOKIE } from "./routes.js";

interface Injectable {
  inject(opts: {
    method: "GET" | "POST";
    url: string;
    payload?: object;
    headers?: Record<string, string>;
  }): Promise<{ statusCode: number; body: string; cookies: Array<{ name: string; value: string }> }>;
}

export const TEST_USERNAME = "owner";
/** An obviously fake test password. Not, and never, a real credential. */
export const TEST_PASSWORD = "test-only-password-not-real-0001";
export const TEST_ORIGIN = "http://127.0.0.1:5173";

/** Collects the setup token buildServer prints at startup. */
export function setupTokenSink(): { onSetupToken: (t: string) => void; token: () => string } {
  let value: string | null = null;
  return {
    onSetupToken: (t) => {
      value = t;
    },
    token: () => {
      if (value === null) throw new Error("no setup token was issued (an owner already exists?)");
      return value;
    },
  };
}

export function totpCode(secretBase32: string, atMs: number): string {
  return new TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) }).generate({ timestamp: atMs });
}

export interface SignedInOwner {
  readonly cookie: string;
  readonly csrfToken: string;
  readonly totpSecret: string;
  readonly recoveryCodes: readonly string[];
  /** Headers for an authenticated request; with `write`, also the CSRF token and an allowed Origin. */
  headers(write?: boolean): Record<string, string>;
}

/** Run first-run setup and confirmation; returns the signed-in owner. */
export async function enrolOwner(
  app: Injectable,
  setupToken: string,
  opts: { now?: () => number; username?: string; password?: string } = {},
): Promise<SignedInOwner> {
  const now = opts.now ?? (() => Date.now());
  const start = await app.inject({
    method: "POST",
    url: "/api/auth/setup",
    payload: { setupToken, username: opts.username ?? TEST_USERNAME, password: opts.password ?? TEST_PASSWORD },
    headers: { "content-type": "application/json", origin: TEST_ORIGIN },
  });
  if (start.statusCode !== 200) throw new Error(`setup failed: ${start.statusCode}`);
  const { totpSecret } = SetupStartResponseSchema.parse(JSON.parse(start.body));
  const ticket = start.cookies.find((c) => c.name === ENROL_COOKIE)?.value;
  if (ticket === undefined) throw new Error("setup did not set the enrolment cookie");

  const confirm = await app.inject({
    method: "POST",
    url: "/api/auth/setup/confirm",
    payload: { code: totpCode(totpSecret, now()) },
    headers: { "content-type": "application/json", origin: TEST_ORIGIN, cookie: `${ENROL_COOKIE}=${ticket}` },
  });
  if (confirm.statusCode !== 200) throw new Error(`setup confirmation failed: ${confirm.statusCode}`);
  const body = SetupConfirmResponseSchema.parse(JSON.parse(confirm.body));
  const sid = confirm.cookies.find((c) => c.name === AUTH_SESSION_COOKIE)?.value;
  if (sid === undefined) throw new Error("setup confirmation did not set the session cookie");
  const cookie = `${AUTH_SESSION_COOKIE}=${sid}`;
  const csrfToken = body.session.csrfToken;
  return {
    cookie,
    csrfToken,
    totpSecret,
    recoveryCodes: body.recoveryCodes,
    headers: (write = false) => (write ? { cookie, [CSRF_HEADER]: csrfToken, origin: TEST_ORIGIN } : { cookie }),
  };
}

type App = Awaited<ReturnType<typeof buildServer>>;
type InjectOptions = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  payload?: NonNullable<FastifyInjectOptions["payload"]>;
  headers?: Record<string, string>;
};

/**
 * buildServer + first-run setup. `inject` sends the owner's session cookie, and
 * for state-changing methods the CSRF token and an allowed Origin; headers the
 * caller passes win.
 */
export async function signedInServer(
  options: BuildServerOptions = {},
  beforeReady?: (app: App) => void,
): Promise<{ app: App; owner: SignedInOwner; inject: (o: InjectOptions) => Promise<LightMyRequestResponse> }> {
  const sink = setupTokenSink();
  const app = await buildServer({ ...options, auth: { ...options.auth, onSetupToken: sink.onSetupToken } });
  beforeReady?.(app);
  const owner = await enrolOwner(app as unknown as Injectable, sink.token(), options.auth?.now === undefined ? {} : { now: options.auth.now });
  const inject = (o: InjectOptions) =>
    app.inject({
      method: o.method,
      url: o.url,
      ...(o.payload === undefined ? {} : { payload: o.payload }),
      headers: { ...owner.headers(o.method !== "GET"), ...(o.headers ?? {}) },
    });
  return { app, owner, inject };
}
