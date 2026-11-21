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
import { createAssistant, createScrubber, resolveAiConfig, type AiConfig, type AssistantResponder } from "@servrsit/ai";
import assistantRoutes from "./routes/assistant.js";
import careRoutes, { type CareServer } from "./routes/care.js";
import { DEFAULT_ALLOWED_ORIGINS } from "./csrf.js";
import serverRoutes from "./routes/servers.js";
import findingRoutes, { PAUSE_KEY, type PausedSetting } from "./routes/findings.js";
import { FindingTracker } from "./findings/tracker.js";
import activityRoutes from "./routes/activity.js";
import baselineRoutes from "./routes/baselines.js";
import settingsRoutes, { aiEnabled, SCHEDULE_KEY, storedSchedule, type AiDescription } from "./routes/settings.js";
import { BaselineService, type BaselineServerInfo } from "./baselines/service.js";
import { collectInventoryLocal, collectInventoryViaSsh, TargetRejectedError, type Inventory, type InventoryDirectory } from "@servrsit/ssh";
import { userInfo } from "node:os";
import type { PlanRequest } from "@servrsit/contracts";
import { ActivityService, InspectionRecorder } from "./activity/history.js";
import { AddressPolicy, type Resolver } from "./servers/address.js";
import { ServerRegistry, type FirstCheckCollector, type PrivilegeProbe } from "./servers/registry.js";
import { createHostKeyScanner, createKeyVault, probeTcp, type HostKeyScanner, type KeyVault } from "./servers/ssh-tools.js";
import { DEFAULT_OWNER_CONTEXT_PATH, OwnerContextFile } from "./owner-context-file.js";
import { MemoryIntentStore, SqliteAuthStore, SqliteCareStore, SqliteServerStore, SqliteFindingStore, SqliteSettingsStore, SqliteActivityStore, SqliteBaselineStore, type CareStore, type IntentStore, type NewServer, type StoredServer } from "@servrsit/store";
import { Dispatcher, SshWriteTarget, type WriteTarget } from "@servrsit/worker";
import type { CommandRunner } from "@servrsit/ssh";
import type { WriteAccess, WriteGate } from "./writes/write-gate.js";
import { startDispatchLoop } from "./writes/dispatch-loop.js";
import { buildFixtureFleet } from "./fleet/fixture.js";
import { ControllerClockMonitor, NOT_CHECKED_CLOCK } from "./clock/controller-clock.js";
import { createLoggerOptions, installResponseRedaction, type LogStream } from "./redaction.js";

const isDev = process.env["NODE_ENV"] !== "production";

declare module "fastify" {
  interface FastifyInstance {
    /** T-089: the care-loop dispatcher, or null when no real server can be written to. Tests drive it directly. */
    careDispatcher: Dispatcher | null;
  }
}

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
  /** T-079: what the configured AI provider is, in plain words (no key). Default: none. */
  readonly aiDescription?: AiDescription | undefined;
  /** T-076 findings and scheduler. Defaults: in-memory stores (the entry point passes files). */
  readonly findings?: FindingsWiring | undefined;
}

export interface FindingsWiring {
  readonly store?: SqliteFindingStore | undefined;
  /** T-077: inspection history and exports. */
  readonly activity?: SqliteActivityStore | undefined;
  /** T-078: baselines and their exceptions. */
  readonly baselines?: SqliteBaselineStore | undefined;
  readonly settings?: SqliteSettingsStore | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface ServerRegistryWiring {
  /** Default ":memory:" (tests). The entry point passes the persistent file. */
  readonly store?: SqliteServerStore | undefined;
  readonly keysDir?: string | undefined;
  readonly vault?: KeyVault | undefined;
  readonly scanner?: HostKeyScanner | undefined;
  readonly probe?: ((address: string, port: number) => Promise<boolean>) | undefined;
  readonly collector?: FirstCheckCollector | undefined;
  /** T-081: the `sudo -n -l` probe. Tests must inject one; the default uses ssh. */
  readonly privilegeProbe?: PrivilegeProbe | undefined;
  /** T-081: draft sweep interval. Setting it starts the sweeper even when background checks are off (tests). */
  readonly sweepIntervalMs?: number | undefined;
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
  /** T-089: durable intent records (the entry point passes a directory). Default: in memory. */
  readonly intents?: IntentStore | undefined;
  readonly simulated?: readonly SimulatedCareServer[] | undefined;
  readonly now?: (() => Date) | undefined;
  /**
   * T-089: the write gate for real servers (config/writes.json, Sentani only). Default: none, so every
   * real server's writes stay disabled. The entry point passes the controller's gate.
   */
  readonly writeGate?: WriteGate | undefined;
  /** T-089: test seam for the write target's ssh runner. Production uses the real OpenSSH runner. */
  readonly sshRunner?: CommandRunner | undefined;
  /**
   * T-089: run the dispatcher in this process. Default: when a write gate is given and background
   * checks run (live mode, startChecks not false). Tests drive it through `dispatcher` instead.
   */
  readonly startDispatcher?: boolean | undefined;
  readonly dispatchIntervalMs?: number | undefined;
}

const NO_AI: AiDescription = { available: false, providerLabel: "None: answers come from the checks only.", route: "No external service.", region: null };

/** T-079: describe an AI configuration without its key. */
export function describeAi(config: AiConfig): AiDescription {
  if (config.provider !== "openai_compatible" || config.openai === null) return NO_AI;
  let host = "the configured endpoint";
  try {
    host = new URL(config.openai.baseUrl).host;
  } catch {
    // keep the generic text
  }
  return { available: true, providerLabel: `An OpenAI-compatible model service (model ${config.openai.model}).`, route: `HTTPS to ${host}.`, region: null };
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
    productionStatus: h.production ? "yes" : "no",
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
 * T-089: a real server's target is made on every lookup from the write gate:
 * connected only while the gate grants access, otherwise one that refuses
 * every write and contacts nothing.
 */
class CareTargets extends Map<string, WriteTarget> {
  constructor(private readonly real: (id: string) => WriteTarget | undefined) {
    super();
  }

  override get(id: string): WriteTarget | undefined {
    return super.get(id) ?? this.real(id);
  }
}

function careWiring(realServers: () => readonly CareServer[], realTarget: (id: string) => WriteTarget | undefined, care: CareOptions | undefined) {
  const initial = realServers();
  const targets = new CareTargets(realTarget);
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
    // T-089 (ADR-021): only Sentani can ever be write-enabled; the gate already refuses any other name.
    if (real.some((s) => s.writesEnabled && s.name.toLowerCase() !== "sentani")) throw new Error("only Sentani may be write-enabled (ADR-021)");
    return [...real, ...simulated];
  };
  return { servers, targets };
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? (await loadFleetConfig());
  const mode = options.mode ?? (process.env["SERVRSIT_FLEET_MODE"] === "fixture" ? "fixture" : "live");
  const fastify = Fastify({
    // T-081 (D-R1): long path parameters reach the routes, which answer with the
    // contract's own error; Fastify's default error would echo the path.
    routerOptions: { maxParamLength: 2048 },
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

  // T-076: findings are recorded after every pass; bound once the tracker exists.
  let onPass: () => void = () => undefined;
  const service =
    options.fleetService ??
    new FleetService({
      config,
      hosts: registryHosts,
      knownHostsFile: knownHostsPath(),
      log: fastify.log,
      onPassComplete: () => onPass(),
      ...(clockMonitor === null ? {} : { controllerClock: () => clockMonitor.current() }),
    });
  const controllerClock = () => (mode === "fixture" ? NOT_CHECKED_CLOCK : service.controlPlane().clock);
  clockStatus = () => controllerClock().status;
  await fastify.register(fleetPlugin, { mode, service, config });
  // T-079: installation settings (schedule, AI on/off, pause). The owner's
  // saved schedule and time zone win over hosts.json.
  const settings = options.findings?.settings ?? new SqliteSettingsStore({ path: ":memory:" });
  // An assistant passed in without a description (tests) counts as available.
  const aiDescription =
    options.aiDescription ??
    (options.assistant === undefined ? NO_AI : { available: true, providerLabel: "The assistant this process was started with.", route: "Set by the caller.", region: null });
  const schedule = storedSchedule({ settings, defaults: { intervalMinutes: config.healthIntervalMinutes, timeZone: config.ownerTimeZone } });
  if (settings.get(SCHEDULE_KEY) !== null) {
    service.setIntervalMinutes(schedule.intervalMinutes);
    service.setOwnerTimeZone(schedule.timeZone);
  }
  const deterministic = createAssistant(resolveAiConfig({ AI_PROVIDER: "none" }));
  const configuredAssistant = options.assistant ?? deterministic;
  await fastify.register(assistantRoutes, {
    // Turning AI off takes effect on the next message: no new inference.
    assistant: () => (aiEnabled(settings, aiDescription) ? configuredAssistant : deterministic),
    fleet: () => (mode === "fixture" ? buildFixtureFleet(config, new Date()) : service.snapshot()),
    timeZone: () => (mode === "fixture" ? config.ownerTimeZone : service.ownerTimeZone()),
    now: options.now,
    controllerClock,
    ownerContext: ownerContextSource(options, fastify.log),
  });
  // T-089: write access for a real server comes only from the controller's write gate (config/writes.json,
  // Sentani only), re-checked on every call. hosts.json and the registry still only ever say false.
  const writeGate = options.care?.writeGate;
  writeGate?.useLog(fastify.log);
  const writeAccess = (id: string, forWrites = true): WriteAccess | null => {
    if (writeGate === undefined) return null;
    const active = registryStore.listActive();
    const row = active.find((s) => s.id === id);
    return row === undefined ? null : writeGate.accessFor(row, active, forWrites);
  };
  // The target may read Sentani's ledger and installed versions even when writes.json is closed, so an
  // operation already sent can be followed to its end. Every submit is still behind the write gate.
  const realTarget = (id: string): WriteTarget | undefined => {
    if (registryStore.get(id)?.disconnectedAt !== null) return undefined;
    const access = writeAccess(id, false);
    if (access === null) return new SshWriteTarget(id);
    return new SshWriteTarget(id, access.hostKeyFingerprint, {
      gateway: access.gateway,
      inspect: access.inspect,
      machineId: () => service.machineIdOf(id),
      runner: options.care?.sshRunner,
    });
  };
  const care = careWiring(
    () =>
      registryHosts().map((h) => ({
        id: h.id,
        name: h.name,
        production: h.production,
        kind: "ssh" as const,
        writesEnabled: writeAccess(h.id) !== null,
        selectedServices: [...h.importantServices],
        ...(h.access === "ssh" ? { user: h.user } : {}),
      })),
    realTarget,
    options.care,
  );
  const careStore = options.care?.store ?? new SqliteCareStore({ path: ":memory:" });
  // T-089: the dispatcher moves approved operations through the target's ledger. The write gate is read
  // on every step, so closing writes.json stops new dispatches at once; an operation that may already be
  // on the target is only ever queried, never re-sent blindly (invariants 6-8).
  const signer = writeGate?.signer() ?? null;
  const installationId = writeGate?.installationId() ?? null;
  const dispatcher =
    writeGate !== undefined && signer !== null && installationId !== null
      ? new Dispatcher({
          store: careStore,
          intents: options.care?.intents ?? new MemoryIntentStore(),
          targets: care.targets,
          writesEnabled: (id) => care.servers().some((s) => s.id === id && s.writesEnabled),
          signer,
          installationId,
          workerId: `api-${process.pid}`,
          now: options.care?.now ?? (() => new Date()),
        })
      : null;
  if (writeGate !== undefined && dispatcher === null) fastify.log.warn("writes: no dispatcher (the signing key or test-bench.json is not ready); approvals stay queued");
  const runDispatcher = options.care?.startDispatcher ?? (mode === "live" && options.startChecks !== false);
  if (dispatcher !== null && runDispatcher) {
    const stop = startDispatchLoop(dispatcher, { intervalMs: options.care?.dispatchIntervalMs, log: fastify.log });
    fastify.addHook("onClose", async () => stop());
  }
  fastify.decorate("careDispatcher", dispatcher);
  // T-078: the care plan builder, shared with baseline setup plans.
  let carePlanner: ((request: PlanRequest) => Promise<{ plan: { id: string } } | null>) | null = null;
  await fastify.register(careRoutes, {
    exposePlanner: (create) => {
      carePlanner = create;
    },
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
    privilegeProbe: options.servers?.privilegeProbe,
    sweepIntervalMs: options.servers?.sweepIntervalMs,
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

  // T-078: baselines. Inventory is read-only and runs in the check queue.
  const baselineServers = (): BaselineServerInfo[] => {
    const observed = new Map(fleetSnapshot().servers.map((x) => [x.id, x.observedAt]));
    const real = registryHosts().map((h) => ({
      id: h.id, name: h.name, role: h.role, production: h.production, writesEnabled: false, simulated: false,
      observedAt: observed.get(h.id) ?? null, user: h.access === "ssh" ? h.user : userInfo().username,
    }));
    const sims = (options.care?.simulated ?? []).map(({ server: x }) => ({
      id: x.id, name: x.name, role: "[SIMULATED]", production: x.production, writesEnabled: x.writesEnabled, simulated: true, observedAt: null, user: x.user ?? null,
    }));
    return [...real, ...sims];
  };
  const unavailableInventory = (message: string) => ({ ok: false as const, code: "UNAVAILABLE" as const, message });
  await fastify.register(baselineRoutes, {
    service: new BaselineService({
      store: options.findings?.baselines ?? new SqliteBaselineStore({ path: ":memory:" }),
      servers: baselineServers,
      plan: () => carePlanner,
      now: options.findings?.now,
      inventory: async (serverId) => {
        if (mode === "fixture") return unavailableInventory("Fixture mode: no server is inspected.");
        const sim = options.care?.simulated?.find((x) => x.server.id === serverId);
        if (sim !== undefined) {
          const simTarget = sim.target as unknown as { inventorySnapshot?: () => { directories: InventoryDirectory[]; installed: Record<string, string> } };
          const snap = simTarget.inventorySnapshot?.();
          if (snap === undefined) return unavailableInventory("This simulated server has no inventory.");
          const inventory: Inventory = {
            collectedAt: new Date().toISOString(),
            source: "simulated",
            home: sim.server.user === undefined ? { status: "unavailable", reason: "no login user" } : { status: "ok", value: `/home/${sim.server.user}`, partial: false },
            directories: { status: "ok", value: snap.directories, partial: false },
            packages: { status: "ok", value: snap.installed, partial: false },
            ubuntuPackages: { status: "ok", value: Object.keys(snap.installed), partial: false },
          };
          return { ok: true, inventory };
        }
        const host = registryHosts().find((h) => h.id === serverId);
        if (host === undefined) return unavailableInventory("Unknown server.");
        if (!host.collect) return unavailableInventory("Checks are switched off for this server.");
        return service.exclusive(() =>
          host.access === "local"
            ? collectInventoryLocal()
            : collectInventoryViaSsh(
                { host: host.address, port: host.port, user: host.user, ...(host.identityFile === undefined ? {} : { identityFile: host.identityFile }) },
                { knownHostsFile: host.knownHostsFile ?? knownHostsPath(), allowedPorts: reg.allowedPorts },
                {
                  checkResolution: async (name) => {
                    const c = await policy.check(name, host.port);
                    if (!c.ok) throw new TargetRejectedError(c.reason);
                  },
                },
              ),
        );
      },
    }),
    owner: (request) => {
      if (request.authSession === null) throw new Error("baseline route reached without a session");
      return request.authSession.info.username;
    },
  });

  await fastify.register(settingsRoutes, {
    mode,
    settings,
    service,
    care: careStore,
    servers: () => registryStore.listActive(),
    ai: aiDescription,
    defaults: { intervalMinutes: config.healthIntervalMinutes, timeZone: config.ownerTimeZone },
    owner: (request) => {
      if (request.authSession === null) throw new Error("settings route reached without a session");
      return request.authSession.info.username;
    },
    now: options.findings?.now,
  });

  // Fixture mode never contacts any server.
  // T-076: findings and the scheduler. Fixture mode keeps its [FIXTURE DATA]
  // findings in memory only, never in the persistent store.
  const findingStore = mode === "fixture" ? new SqliteFindingStore({ path: ":memory:" }) : (options.findings?.store ?? new SqliteFindingStore({ path: ":memory:" }));
  const fleetSnapshot = () => (mode === "fixture" ? buildFixtureFleet(config, new Date()) : service.snapshot());
  const tracker = new FindingTracker({ store: findingStore, fleet: fleetSnapshot, now: options.findings?.now });
  const activityStore = mode === "fixture" ? new SqliteActivityStore({ path: ":memory:" }) : (options.findings?.activity ?? new SqliteActivityStore({ path: ":memory:" }));
  const inspections = new InspectionRecorder(activityStore, options.findings?.now);
  onPass = () => {
    const snapshot = fleetSnapshot();
    tracker.sync(snapshot);
    inspections.sync(snapshot);
  };
  const scrub = createScrubber(secrets);
  await fastify.register(activityRoutes, {
    service: new ActivityService({
      activity: activityStore,
      care: careStore,
      findings: findingStore,
      serverInfo: (id) => {
        const known0 = care.servers().find((x) => x.id === id);
        if (known0 !== undefined) return { name: known0.name, production: known0.production };
        const known = registryStore.get(id);
        return known === null ? null : { name: known.name, production: known.production };
      },
      scrub: (text) => String(scrub(text)),
      refresh: () => onPass(),
      now: options.findings?.now,
    }),
    owner: (request) => {
      if (request.authSession === null) throw new Error("activity route reached without a session");
      return request.authSession.info.username;
    },
  });
  await fastify.register(findingRoutes, {
    mode,
    tracker,
    store: findingStore,
    settings,
    service,
    fleet: fleetSnapshot,
    owner: (request) => {
      if (request.authSession === null) throw new Error("findings route reached without a session");
      return request.authSession.info.username;
    },
    now: options.findings?.now,
  });
  // A pause survives restarts.
  if (mode === "live" && settings.get<PausedSetting>(PAUSE_KEY) !== null) service.pause();

  if (mode === "live" && options.startChecks !== false) service.start();
  if (options.startChecks !== false) clockMonitor?.start();
  // T-081 (D-R3): expired drafts and their unused keys are removed at start-up and every 15 minutes.
  if (options.startChecks !== false || options.servers?.sweepIntervalMs !== undefined) registry.startSweeper();
  fastify.addHook("onClose", async () => {
    registry.stopSweeper();
    await service.stop();
    await clockMonitor?.stop();
  });

  return fastify;
}

