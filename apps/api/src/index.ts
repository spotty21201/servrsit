/**
 * ServrSit API server entry point.
 *
 * Technical Spec §13: Fastify with TypeScript; schema-validated HTTP endpoints;
 * server-managed authentication sessions.
 *
 * Session security: Secure, HttpOnly, SameSite=Strict cookies.
 * Technical Spec §5: "Exchange the login for an opaque, server-side session
 * with Secure, HttpOnly, SameSite cookies."
 */

import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import fastifyCors from "@fastify/cors";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { authStub } from "./auth/stub.js";
import healthPlugin from "./routes/health.js";
import fleetPlugin from "./routes/fleet.js";

const PORT = 3001;
const HOST = "127.0.0.1";

const isDev = process.env["NODE_ENV"] !== "production";

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: isDev ? "info" : "warn",
    },
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
  await fastify.register(fleetPlugin);

  return fastify;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function start() {
  const fastify = await buildServer();

  const shutdown = async (signal: string) => {
    fastify.log.info({ signal }, "Received shutdown signal — closing server");
    try {
      await fastify.close();
      fastify.log.info("Server closed cleanly");
      process.exit(0);
    } catch (err) {
      fastify.log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await fastify.listen({ port: PORT, host: HOST });
  } catch (err) {
    fastify.log.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

await start();
