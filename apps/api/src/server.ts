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
import { createAssistant, createScrubber, resolveAiConfig, type AssistantResponder } from "@servrsit/ai";
import assistantRoutes from "./routes/assistant.js";
import careRoutes, { type CareServer } from "./routes/care.js";
import { CsrfGuard } from "./csrf.js";
import { DEFAULT_OWNER_CONTEXT_PATH, OwnerContextFile } from "./owner-context-file.js";
import { SqliteCareStore, type CareStore } from "@servrsit/store";
import { SshWriteTarget, type WriteTarget } from "@servrsit/worker";
import { buildFixtureFleet } from "./fleet/fixture.js";
import { createLoggerOptions, installResponseRedaction, type LogStream } from "./redaction.js";

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
  /** Secret values (for example the AI API key) that must never appear in logs, errors or responses. */
  readonly redactSecrets?: readonly string[] | undefined;
  /** For tests: capture log lines. */
  readonly logStream?: LogStream | undefined;
  /** The assistant. Defaults to deterministic-only (no AI) when not given. */
  readonly assistant?: AssistantResponder | undefined;
  /** For tests: the clock the assistant uses for local times and ages. */
  readonly now?: (() => Date) | undefined;
  /** Care loop wiring. Defaults to an in-memory store and real servers only (all writes disabled). */
  readonly care?: CareOptions | undefined;
  /**
   * Owner-context file for the assistant (T-050). Default: apps/api/config/assistant-context.md.
   * null disables it (tests).
   */
  readonly ownerContextPath?: string | null | undefined;
}

/** A simulated server, injectable only in code (tests and local demos), never via config or API. */
export interface SimulatedCareServer {
  readonly server: CareServer & { readonly kind: "simulated" };
  readonly target: WriteTarget;
}

export interface CareOptions {
  readonly store?: CareStore | undefined;
  readonly simulated?: readonly SimulatedCareServer[] | undefined;
  readonly csrf?: CsrfGuard | undefined;
  readonly now?: (() => Date) | undefined;
}

/** Simulated servers use obviously fake ids and can never shadow a real server. */
const SIMULATED_ID = /^00000000-0000-4000-8000-[0-9a-f]{12}$/;

function ownerContextSource(
  options: BuildServerOptions,
  log: { info(o: object, m: string): void; warn(o: object, m: string): void },
): (() => string | null) | undefined {
  if (options.ownerContextPath === null) return undefined;
  const file = new OwnerContextFile(options.ownerContextPath ?? DEFAULT_OWNER_CONTEXT_PATH, options.redactSecrets ?? [], log);
  return () => file.get();
}

function careWiring(config: FleetConfig, care: CareOptions | undefined) {
  const real: CareServer[] = config.hosts.map((h) => ({
    id: h.id,
    name: h.name,
    production: h.production,
    kind: "ssh",
    writesEnabled: h.writesEnabled,
  }));
  if (real.some((s) => s.writesEnabled)) throw new Error("writesEnabled must be false for real servers (ADR-014)");
  const targets = new Map<string, WriteTarget>(real.map((s) => [s.id, new SshWriteTarget(s.id)]));
  const realIds = new Set(real.map((s) => s.id));
  const realNames = new Set(real.map((s) => s.name.toLowerCase()));
  const simulated: CareServer[] = [];
  for (const sim of care?.simulated ?? []) {
    const s = sim.server;
    if (s.kind !== "simulated" || sim.target.kind !== "simulated") throw new Error("only simulated targets can be injected");
    if (!SIMULATED_ID.test(s.id) || realIds.has(s.id) || realNames.has(s.name.toLowerCase())) {
      throw new Error("a simulated server must use a fake id and must not shadow a real server");
    }
    simulated.push(s);
    targets.set(s.id, sim.target);
  }
  const servers = [...real, ...simulated];
  return { servers: () => servers, targets };
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? (await loadFleetConfig());
  const mode = options.mode ?? (process.env["SERVRSIT_FLEET_MODE"] === "fixture" ? "fixture" : "live");
  const fastify = Fastify({
    logger:
      options.logger === false
        ? false
        : createLoggerOptions({
            level: isDev ? "info" : "warn",
            secrets: options.redactSecrets ?? [],
            stream: options.logStream,
          }),
  });
  const secrets = options.redactSecrets ?? [];
  installResponseRedaction(fastify, createScrubber(secrets), secrets.length > 0);

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
  await fastify.register(assistantRoutes, {
    assistant: options.assistant ?? createAssistant(resolveAiConfig({ AI_PROVIDER: "none" })),
    fleet: () => (mode === "fixture" ? buildFixtureFleet(config, new Date()) : service.snapshot()),
    timeZone: config.ownerTimeZone,
    now: options.now,
    ownerContext: ownerContextSource(options, fastify.log),
  });
  const care = careWiring(config, options.care);
  const careStore = options.care?.store ?? new SqliteCareStore({ path: ":memory:" });
  await fastify.register(careRoutes, {
    store: careStore,
    servers: care.servers,
    targets: care.targets,
    csrf: options.care?.csrf ?? new CsrfGuard(),
    // AUTH STUB (D3): a fixed owner until Cognito sessions (T-023).
    owner: () => "owner-dev-stub",
    now: options.care?.now,
  });

  // Fixture mode never contacts any server.
  if (mode === "live" && options.startChecks !== false) service.start();
  fastify.addHook("onClose", async () => {
    await service.stop();
  });

  return fastify;
}

