/**
 * ServrSit API server factory.
 *
 * Technical Spec §13: Fastify with TypeScript; schema-validated HTTP endpoints;
 * server-managed authentication sessions.
 */

import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import fastifyCors from "@fastify/cors";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { authStub } from "./auth/stub.js";
import healthPlugin from "./routes/health.js";
import fleetPlugin from "./routes/fleet.js";
import { FleetService } from "./fleet/service.js";
import { knownHostsPath, loadFleetConfig, type FleetConfig } from "./fleet/config.js";

const isDev = process.env["NODE_ENV"] !== "production";

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export interface BuildServerOptions {
  readonly config?: FleetConfig | undefined;
  readonly fleetService?: FleetService | undefined;
  readonly mode?: "live" | "fixture" | undefined;
  /** Start the background refresh timer. Tests leave this off. */
  readonly startChecks?: boolean | undefined;
  readonly logger?: boolean | undefined;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? (await loadFleetConfig());
  const mode = options.mode ?? (process.env["SERVRSIT_FLEET_MODE"] === "fixture" ? "fixture" : "live");
  const fastify = Fastify({
    logger: options.logger === false ? false : { level: isDev ? "info" : "warn" },
  });

  // Set Zod as the schema validator and serializer for all routes
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // ---------------------------------------------------------------------------
  // CORS — development only, localhost:5173 (Vite default)
  // In production the reverse proxy handles CORS and this plugin is not needed.
  // ---------------------------------------------------------------------------
  if (isDev) {
    await fastify.register(fastifyCors, {
      origin: "http://localhost:5173",
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    });
  }

  // ---------------------------------------------------------------------------
  // Cookie and session
  //
  // Session secret must be provided via SESSION_SECRET environment variable.
  // In development a generated fallback is used so the server starts without
  // configuration, but it logs a warning.
  //
  // Technical Spec §5: "Secure, HttpOnly, SameSite cookies. Store a hash of
  // the session identifier."
  // ---------------------------------------------------------------------------
  const sessionSecret = process.env["SESSION_SECRET"];
  if (!sessionSecret && !isDev) {
    throw new Error(
      "SESSION_SECRET environment variable is required in production"
    );
  }

  const effectiveSecret =
    sessionSecret ??
    "dev-only-insecure-secret-32-chars-min!!";

  if (!sessionSecret && isDev) {
    // Log at warn so it appears even at reduced log levels
    process.stderr.write(
      "[WARN] SESSION_SECRET not set — using insecure dev default. " +
        "Set SESSION_SECRET before any real data or external access.\n"
    );
  }

  await fastify.register(fastifyCookie);

  await fastify.register(fastifySession, {
    secret: effectiveSecret,
    cookieName: "servrsit_session",
    cookie: {
      secure: !isDev, // true in production (HTTPS required)
      httpOnly: true,
      sameSite: "strict",
      maxAge: 60 * 60 * 1000, // 60 minutes; matches Technical Spec §5 inactivity expiry
      path: "/",
    },
    saveUninitialized: false,
  });

  // ---------------------------------------------------------------------------
  // Auth hook
  //
  // Replace authStub with Cognito PKCE token validation before any real data
  // or external access. See apps/api/src/auth/stub.ts.
  // ---------------------------------------------------------------------------
  fastify.addHook("preHandler", authStub);

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------
  await fastify.register(healthPlugin);

  const service =
    options.fleetService ??
    new FleetService({ config, knownHostsFile: knownHostsPath(), log: fastify.log });
  await fastify.register(fleetPlugin, { mode, service, config });

  // Fixture mode never contacts any server.
  if (mode === "live" && options.startChecks !== false) service.start();
  fastify.addHook("onClose", async () => {
    await service.stop();
  });

  return fastify;
}

