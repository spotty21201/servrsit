/**
 * ServrSit API server factory.
 *
 * Technical Spec §13: Fastify with TypeScript; schema-validated HTTP endpoints;
 * server-managed authentication sessions.
 */

import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { OwnerAuth } from "./auth/owner-auth.js";
import authRoutes, { installAuthGuard } from "./auth/routes.js";
import healthPlugin from "./routes/health.js";
import fleetPlugin from "./routes/fleet.js";
import { FleetService } from "./fleet/service.js";
import {
  DEFAULT_SERVER_KEYS_DIR,
  knownHostsPath,
  loadFleetConfig,
  type FleetConfig,
  type FleetHost,
  type HostConfig,
} from "./fleet/config.js";
import { createAssistant, createScrubber, resolveAiConfig, type AssistantResponder } from "@servrsit/ai";
import assistantRoutes from "./routes/assistant.js";
import careRoutes, { type CareServer } from "./routes/care.js";
import { DEFAULT_ALLOWED_ORIGINS } from "./csrf.js";
import serverRoutes from "./routes/servers.js";
import { AddressPolicy, type Resolver } from "./servers/address.js";
import { ServerRegistry, type FirstCheckCollector } from "./servers/registry.js";
import { createHostKeyScanner, createKeyVault, probeTcp, type HostKeyScanner, type KeyVault } from "./servers/ssh-tools.js";
import { DEFAULT_OWNER_CONTEXT_PATH, OwnerContextFile } from "./owner-context-file.js";
import { SqliteAuthStore, SqliteCareStore, SqliteServerStore, type CareStore, type NewServer, type StoredServer } from "@servrsit/store";
import { SshWriteTarget, type WriteTarget } from "@servrsit/worker";
import { buildFixtureFleet } from "./fleet/fixture.js";
import { ControllerClockMonitor, NOT_CHECKED_CLOCK } from "./clock/controller-clock.js";
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
  /** Owner auth (T-053). Always enforced; these only choose where records live and, for tests, the clock. */
  readonly auth?: AuthOptions | undefined;
  /**
   * T-063: ServrSit's own clock check. Default: a monitor that runs with the
   * background checks (live mode, startChecks not false); otherwise none, and
   * the clock is reported "not-checked".
   */
  readonly controllerClock?: ControllerClockMonitor | null | undefined;
  /** T-069 server registry wiring. Defaults: in-memory registry, real OpenSSH tools. */
  readonly servers?: ServerRegistryWiring | undefined;
}

export interface ServerRegistryWiring {
  /** Default ":memory:" (tests). The entry point passes the persistent file. */
  readonly store?: SqliteServerStore | undefined;
  readonly keysDir?: string | undefined;
  readonly vault?: KeyVault | undefined;
  readonly scanner?: HostKeyScanner | undefined;
  readonly probe?: ((address: string, port: number) => Promise<boolean>) | undefined;
  readonly collector?: FirstCheckCollector | undefined;
  readonly resolver?: Resolver | undefined;
  readonly selfAddresses?: (() => readonly string[]) | undefined;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
}

export interface AuthOptions {
  /** Default: an in-memory store (nothing survives a restart). The entry point passes the .data file. */
  readonly store?: SqliteAuthStore | undefined;
  /** Milliseconds since the epoch. For tests. */
  readonly now?: (() => number) | undefined;
  /** Receives the first-run setup token. Default: printed to stderr (not the structured log). */
  readonly onSetupToken?: ((setupToken: string) => void) | undefined;
  readonly allowedOrigins?: readonly string[] | undefined;
}

/** Where the entry point keeps owner auth records (gitignored). */
export const DEFAULT_AUTH_DB_PATH = new URL("../.data/auth.db", import.meta.url).pathname;

/** A simulated server, injectable only in code (tests and local demos), never via config or API. */
export interface SimulatedCareServer {
  readonly server: CareServer & { readonly kind: "simulated" };
  readonly target: WriteTarget;
}

export interface CareOptions {
  readonly store?: CareStore | undefined;
  readonly simulated?: readonly SimulatedCareServer[] | undefined;
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

/** hosts.json entry -> registry row (T-069 one-time import). */
function importedServer(h: HostConfig, at: Date): NewServer {
  return {
    id: h.id,
    source: "import",
    access: h.access,
    name: h.name,
    role: h.role,
    production: h.production,
    address: h.access === "ssh" ? h.address : null,
    port: h.access === "ssh" ? h.port : null,
    user: h.access === "ssh" ? h.user : null,
    identityFile: h.access === "ssh" ? (h.identityFile ?? null) : null,
    knownHostsFile: null,
    importantServices: [...h.importantServices],
    collect: h.collect,
    collectDisabledReason: h.collectDisabledReason ?? null,
    hostKey: null,
    accessKey: null,
    createdAt: at.toISOString(),
  };
}

/** Registry row -> the host the fleet service checks. */
function fleetHost(s: StoredServer): FleetHost {
  const base = {
    id: s.id,
    name: s.name,
    role: s.role,
    production: s.production,
    importantServices: [...s.importantServices],
    collect: s.collect,
    ...(s.collectDisabledReason === null ? {} : { collectDisabledReason: s.collectDisabledReason }),
    writesEnabled: false as const,
  };
  if (s.access === "local" || s.address === null || s.port === null || s.user === null) return { ...base, access: "local" };
  return {
    ...base,
    access: "ssh",
    address: s.address,
    port: s.port,
    user: s.user,
    ...(s.identityFile === null ? {} : { identityFile: s.identityFile }),
    ...(s.knownHostsFile === null ? {} : { knownHostsFile: s.knownHostsFile }),
  };
}

/**
 * Real servers come from the registry on every call, so a server added or
 * disconnected through the API is seen at once. Simulated servers are fixed.
 */
class CareTargets extends Map<string, WriteTarget> {
  constructor(private readonly isReal: (id: string) => boolean) {
    super();
  }

  override get(id: string): WriteTarget | undefined {
    const known = super.get(id);
    if (known !== undefined) return known;
    if (!this.isReal(id)) return undefined;
    const target = new SshWriteTarget(id);
    super.set(id, target);
    return target;
  }
}

function careWiring(realServers: () => readonly CareServer[], care: CareOptions | undefined) {
  const initial = realServers();
  const targets = new CareTargets((id) => realServers().some((s) => s.id === id));
  const realIds = new Set(initial.map((s) => s.id));
  const realNames = new Set(initial.map((s) => s.name.toLowerCase()));
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
  const simulatedIds = new Set(simulated.map((s) => s.id));
  const servers = (): CareServer[] => {
    const real = realServers().filter((s) => !simulatedIds.has(s.id));
    if (real.some((s) => s.writesEnabled)) throw new Error("writesEnabled must be false for real servers (ADR-014)");
    return [...real, ...simulated];
  };
  return { servers, targets };
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
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    });
  }

  // ---------------------------------------------------------------------------
  // Owner auth (T-053, ADR-017). The guard runs on every request before routing
  // completes: every /api route except /api/auth/{setup,login,totp,session,logout}
  // needs a session, and every state-changing one also needs Origin + CSRF.
  // ---------------------------------------------------------------------------
  await fastify.register(fastifyCookie);
  // T-066 D-A3: enrolment is refused while ServrSit's own clock is untrusted. The clock source is
  // wired below, after the fleet service exists, so it is read through this late-bound function.
  let clockStatus: () => string = () => "not-checked";
  const auth = new OwnerAuth({
    clockTrusted: () => clockStatus() !== "untrusted",
    store: options.auth?.store ?? new SqliteAuthStore({ path: ":memory:" }),
    now: options.auth?.now,
    onSetupToken: options.auth?.onSetupToken,
  });
  await auth.init();
  const allowedOrigins = options.auth?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  installAuthGuard(fastify, { auth, allowedOrigins });
  await fastify.register(authRoutes, { auth, allowedOrigins, secureCookies: !isDev, now: options.auth?.now });

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------
  await fastify.register(healthPlugin);

  const clockMonitor =
    options.controllerClock !== undefined
      ? options.controllerClock
      : mode === "live" && options.startChecks !== false
        ? new ControllerClockMonitor({ intervalMs: config.healthIntervalMinutes * 60_000, log: fastify.log })
        : null;
  // T-069: the server registry. hosts.json is imported once; after that the
  // registry is the source of truth for which servers exist.
  const registryStore = options.servers?.store ?? new SqliteServerStore({ path: ":memory:" });
  const registryNow = options.servers?.now ?? (() => new Date());
  const imported = registryStore.importOnce(config.hosts.map((h) => importedServer(h, registryNow())), registryNow());
  fastify.log.info(
    imported.kind === "imported" ? { imported: imported.count } : { importedAt: imported.at },
    imported.kind === "imported" ? "servers: hosts.json imported into the registry" : "servers: hosts.json was imported before; its host list is not read",
  );
  const registryHosts = () => registryStore.listActive().map(fleetHost);

  const service =
    options.fleetService ??
    new FleetService({
      config,
      hosts: registryHosts,
      knownHostsFile: knownHostsPath(),
      log: fastify.log,
      ...(clockMonitor === null ? {} : { controllerClock: () => clockMonitor.current() }),
    });
  const controllerClock = () => (mode === "fixture" ? NOT_CHECKED_CLOCK : service.controlPlane().clock);
  clockStatus = () => controllerClock().status;
  await fastify.register(fleetPlugin, { mode, service, config });
  await fastify.register(assistantRoutes, {
    assistant: options.assistant ?? createAssistant(resolveAiConfig({ AI_PROVIDER: "none" })),
    fleet: () => (mode === "fixture" ? buildFixtureFleet(config, new Date()) : service.snapshot()),
    timeZone: config.ownerTimeZone,
    now: options.now,
    controllerClock,
    ownerContext: ownerContextSource(options, fastify.log),
  });
  const care = careWiring(
    () =>
      registryHosts().map((h) => ({
        id: h.id,
        name: h.name,
        production: h.production,
        kind: "ssh" as const,
        writesEnabled: h.writesEnabled,
        selectedServices: [...h.importantServices],
        ...(h.access === "ssh" ? { user: h.user } : {}),
      })),
    options.care,
  );
  const careStore = options.care?.store ?? new SqliteCareStore({ path: ":memory:" });
  await fastify.register(careRoutes, {
    store: careStore,
    servers: care.servers,
    targets: care.targets,
    owner: (request) => {
      // The guard has already refused any request without a session; reaching here without one is a bug.
      if (request.authSession === null) throw new Error("care route reached without a session");
      return request.authSession.info.username;
    },
    now: options.care?.now,
    controllerClock,
  });

  const reg = config.registration;
  const policy = new AddressPolicy(reg, { resolver: options.servers?.resolver, selfAddresses: options.servers?.selfAddresses });
  const registry = new ServerRegistry({
    store: registryStore,
    policy,
    controllerAddress: reg.controllerAddress,
    scanner: options.servers?.scanner ?? createHostKeyScanner(),
    vault: options.servers?.vault ?? createKeyVault(options.servers?.keysDir ?? DEFAULT_SERVER_KEYS_DIR.pathname),
    probe: options.servers?.probe ?? probeTcp,
    collector: options.servers?.collector,
    now: options.servers?.now,
    newId: options.servers?.newId,
    hasUnresolvedOperation: (id) => careStore.unresolvedFor(id) !== null,
    // Check a new server right away, but only where background checks run at all.
    onActivated: (id) => {
      if (mode === "live" && options.startChecks !== false) void service.refreshHost(id);
    },
    log: fastify.log,
  });
  await fastify.register(serverRoutes, {
    registry,
    // The global auth guard (T-053) already requires a session, the session's CSRF token and an allowed Origin on every /api route.
    csrf: null,
    owner: (request) => {
      if (request.authSession === null) throw new Error("server route reached without a session");
      return request.authSession.info.username;
    },
  });

  // Fixture mode never contacts any server.
  if (mode === "live" && options.startChecks !== false) service.start();
  if (options.startChecks !== false) clockMonitor?.start();
  fastify.addHook("onClose", async () => {
    await service.stop();
    await clockMonitor?.stop();
  });

  return fastify;
}

