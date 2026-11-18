/**
 * FleetService: holds the latest result per server and refreshes on a timer.
 *
 * - GET /api/fleet reads this cache. It never triggers a collection.
 * - Hosts are checked one at a time.
 * - An ssh host whose key is not pinned is NOT contacted: no ssh, no DNS.
 * - After a failure that retrying cannot fix (rejected credentials, changed
 *   host key, rejected target) the host is not retried until restart. This
 *   avoids hammering production machines with failing logins.
 * - Overlapping refreshes coalesce into one.
 */

import type { ControlPlane, ControllerClock } from "@servrsit/contracts";
import { attributeToController, controllerClockFindings, NOT_CHECKED_CLOCK } from "../clock/controller-clock.js";
import {
  collectLocal,
  collectViaSsh,
  pinStateFor,
  type CollectionResult,
  type InspectionObservation,
  type PinState,
} from "@servrsit/ssh";
import type { FleetConfig, FleetHost } from "./config.js";
import { evaluateFindings } from "./findings.js";
import type { FleetResponse, FleetServer } from "./schema.js";
import { coverageOf, deriveStatus, freshUntil, type Attempt } from "./status.js";

export type Collector = (host: FleetHost) => Promise<CollectionResult>;
export type PinChecker = (host: FleetHost) => Promise<PinState>;

export interface FleetServiceOptions {
  readonly config: FleetConfig;
  readonly knownHostsFile: string;
  /**
   * T-069: the servers to check, read on every pass and snapshot (the server
   * registry). Default: config.hosts. A server that leaves this list is no
   * longer checked.
   */
  readonly hosts?: (() => readonly FleetHost[]) | undefined;
  readonly collector?: Collector | undefined;
  readonly pinChecker?: PinChecker | undefined;
  readonly now?: (() => Date) | undefined;
  readonly log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void } | undefined;
  /** T-063: ServrSit's own clock, as last checked. Absent means not checked (tests). */
  readonly controllerClock?: (() => ControllerClock) | undefined;
  /** T-076: called after every pass and single-server check (findings tracking). */
  readonly onPassComplete?: (() => void) | undefined;
}

interface ServerState {
  pin: PinState | "unknown";
  latestAttempt: Attempt | null;
  lastSuccess: { at: Date; observation: InspectionObservation } | null;
  previousSuccess: InspectionObservation | null;
  consecutiveFailures: number;
  retryBlocked: boolean;
}

const NON_RETRYABLE = new Set(["AUTH_FAILED", "HOST_KEY_CHANGED", "TARGET_REJECTED", "HOST_UNTRUSTED"]);

export class FleetService {
  private readonly states = new Map<string, ServerState>();
  private readonly collector: Collector;
  private readonly pinChecker: PinChecker;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private lastRunAt: Date | null = null;
  /** start() was called: background checks belong to this process. */
  private scheduled = false;
  /** T-076: the owner paused background checks. */
  private paused = false;
  private passStartedAt: Date | null = null;

  constructor(private readonly options: FleetServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.collector =
      options.collector ??
      ((host) =>
        host.access === "local"
          ? collectLocal()
          : collectViaSsh(
              {
                host: host.address,
                port: host.port,
                user: host.user,
                ...(host.identityFile === undefined ? {} : { identityFile: host.identityFile }),
              },
              { knownHostsFile: host.knownHostsFile ?? options.knownHostsFile },
            ));
    this.pinChecker =
      options.pinChecker ??
      (async (host) =>
        host.access === "local"
          ? "pinned"
          : pinStateFor(host.knownHostsFile ?? options.knownHostsFile, host.address, host.port));
    this.hosts = options.hosts ?? (() => options.config.hosts);
  }

  private readonly hosts: () => readonly FleetHost[];

  private stateFor(host: FleetHost): ServerState {
    let state = this.states.get(host.id);
    if (state === undefined) {
      state = {
        pin: host.access === "local" ? "pinned" : "unknown",
        latestAttempt: null,
        lastSuccess: null,
        previousSuccess: null,
        consecutiveFailures: 0,
        retryBlocked: false,
      };
      this.states.set(host.id, state);
    }
    return state;
  }

  /** Forget servers that left the list (disconnected), so nothing about them lingers. */
  private prune(hosts: readonly FleetHost[]): void {
    const ids = new Set(hosts.map((h) => h.id));
    for (const id of this.states.keys()) if (!ids.has(id)) this.states.delete(id);
  }

  /** T-079: the owner's interval, when set; otherwise the configured one. */
  private intervalMinutes: number | null = null;
  /** T-079: the owner's time zone, when set; otherwise the configured one. */
  private timeZone: string | null = null;

  setOwnerTimeZone(zone: string): void {
    this.timeZone = zone;
  }

  ownerTimeZone(): string {
    return this.timeZone ?? this.options.config.ownerTimeZone;
  }

  private get intervalMs(): number {
    return (this.intervalMinutes ?? this.options.config.healthIntervalMinutes) * 60_000;
  }

  /**
   * T-079: change the check interval. A running timer restarts on the new
   * interval without an extra pass; nothing is replayed.
   */
  setIntervalMinutes(minutes: number): void {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("interval must be 1..1440 minutes");
    this.intervalMinutes = minutes;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = setInterval(() => void this.refreshAll(), this.intervalMs);
      this.timer.unref();
    }
  }

  /** Every check runs through this chain, so no two collections overlap. */
  private chain: Promise<void> = Promise.resolve();

  private serial(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /**
   * T-078: run other read-only work on servers (the baseline inventory) in
   * the same queue as checks, so no two connections overlap.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  /** Run one pass over all hosts, serially. Concurrent calls share one run. */
  refreshAll(): Promise<void> {
    if (this.running !== null) return this.running;
    this.running = this.serial(() => this.runPass()).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runPass(): Promise<void> {
    this.passStartedAt = this.now();
    try {
      await this.checkAll();
    } finally {
      this.passStartedAt = null;
    }
    this.notifyPass();
  }

  /** T-076: tell listeners (the findings tracker) that new results exist. Their errors never stop checks. */
  private notifyPass(): void {
    try {
      this.options.onPassComplete?.();
    } catch (error) {
      this.options.log?.warn({ err: error }, "pass listener failed");
    }
  }

  private async checkAll(): Promise<void> {
    const hosts = this.hosts();
    this.prune(hosts);
    for (const host of hosts) {
      // A server disconnected during the pass is skipped.
      if (!this.hosts().some((h) => h.id === host.id)) continue;
      await this.refreshOne(host);
    }
    this.lastRunAt = this.now();
  }

  /**
   * T-069: check one server now (just after it was added), without touching
   * any other server. It queues behind a running pass, so checks stay serial.
   */
  refreshHost(id: string): Promise<void> {
    if (this.paused) return Promise.resolve();
    return this.serial(async () => {
      const host = this.hosts().find((h) => h.id === id);
      if (host !== undefined) await this.refreshOne(host);
      this.notifyPass();
    });
  }

  private async refreshOne(host: FleetHost): Promise<void> {
    const state = this.stateFor(host);
    state.pin = await this.pinChecker(host);
    if (state.pin !== "pinned" || !host.collect || state.retryBlocked) return;

    const result = await this.collector(host);
    const at = this.now();
    if (result.ok) {
      if (state.lastSuccess !== null) state.previousSuccess = state.lastSuccess.observation;
      state.lastSuccess = { at: new Date(result.observation.collectedAt), observation: result.observation };
      state.latestAttempt = { at, succeeded: true, failure: null };
      state.consecutiveFailures = 0;
      this.options.log?.info({ host: host.name, result: "ok" }, "check finished");
      return;
    }
    state.latestAttempt = { at, succeeded: false, failure: result.failure };
    state.consecutiveFailures += 1;
    if (NON_RETRYABLE.has(result.failure.code)) state.retryBlocked = true;
    this.options.log?.warn(
      { host: host.name, code: result.failure.code, contacted: result.contacted, retryBlocked: state.retryBlocked },
      "check failed",
    );
  }

  /** Start periodic refresh. The first pass runs immediately in the background. */
  start(): void {
    this.scheduled = true;
    if (this.timer !== null || this.paused) return;
    void this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), this.intervalMs);
    this.timer.unref();
  }

  /**
   * T-076 (FR-19): stop background checks until resume(). A pass already
   * running finishes; nothing new starts.
   */
  pause(): void {
    this.paused = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resume: one current check now, then the normal interval. Missed runs are not replayed. */
  resume(): void {
    this.paused = false;
    if (this.scheduled) this.start();
  }

  /** T-076: what the scheduler is doing, for GET /api/scheduler. */
  schedulerState(): { scheduled: boolean; paused: boolean; passStartedAt: Date | null; nextRunAt: Date | null; intervalMs: number } {
    const base = this.lastRunAt ?? this.passStartedAt;
    return {
      scheduled: this.scheduled,
      paused: this.paused,
      passStartedAt: this.passStartedAt,
      nextRunAt: this.timer === null || base === null ? null : new Date(base.getTime() + this.intervalMs),
      intervalMs: this.intervalMs,
    };
  }

  async stop(): Promise<void> {
    this.scheduled = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.running !== null) await this.running;
    await this.chain;
  }

  /** T-063: the controller clock, with skew attributed to it when most targets agree. */
  controlPlane(): ControlPlane {
    const targets: Array<{ skewSeconds: number; uncertaintySeconds: number }> = [];
    for (const state of this.states.values()) {
      const c = state.lastSuccess?.observation.host.clock;
      if (c?.status === "ok") targets.push({ skewSeconds: c.value.skewSeconds, uncertaintySeconds: c.value.uncertaintySeconds });
    }
    const clock = attributeToController(this.options.controllerClock?.() ?? NOT_CHECKED_CLOCK, targets);
    return { clock, findings: controllerClockFindings(clock) };
  }

  snapshot(): FleetResponse {
    const now = this.now();
    const controlPlane = this.controlPlane();
    const hosts = this.hosts();
    this.prune(hosts);
    // T-056: which listed hosts report the same machine id (observed, read-only).
    const byMachine = new Map<string, string[]>();
    for (const host of hosts) {
      const mid = this.states.get(host.id)?.lastSuccess?.observation.host.machineId;
      if (mid?.status === "ok") byMachine.set(mid.value, [...(byMachine.get(mid.value) ?? []), host.name]);
    }
    const sameAs = (host: FleetHost): string[] => {
      const mid = this.states.get(host.id)?.lastSuccess?.observation.host.machineId;
      return mid?.status === "ok" ? (byMachine.get(mid.value) ?? []).filter((n) => n !== host.name) : [];
    };
    const servers = hosts.map((host) => this.serverView(host, now, controlPlane.clock, sameAs(host)));
    const next =
      this.timer === null
        ? null
        : new Date((this.lastRunAt ?? now).getTime() + this.intervalMs).toISOString();
    return {
      mode: "live",
      generatedAt: now.toISOString(),
      healthIntervalMinutes: this.intervalMs / 60_000,
      ownerTimeZone: this.ownerTimeZone(),
      nextCheckAt: next,
      controlPlane,
      servers,
    };
  }

  private serverView(host: FleetHost, now: Date, controllerClock: ControllerClock, sameMachineIdAs: readonly string[]): FleetServer {
    const state = this.stateFor(host);
    const success = state.lastSuccess;
    const coverage = success === null ? null : coverageOf(success.observation);
    const derived = deriveStatus({
      collect: host.collect,
      collectDisabledReason: host.collectDisabledReason,
      pin: state.pin,
      latestAttempt: state.latestAttempt,
      lastSuccessAt: success?.at ?? null,
      lastSuccessCoverageComplete: coverage === null ? false : coverage.unavailable.length === 0,
      healthIntervalMs: this.intervalMs,
      now,
    });
    return {
      id: host.id,
      name: host.name,
      role: host.role,
      production: host.production,
      importantServices: [...host.importantServices],
      access: host.access,
      source: success === null ? "none" : "live",
      status: derived.status,
      statusReason: derived.statusReason,
      observedAt: success === null ? null : success.at.toISOString(),
      freshUntil: success === null ? null : freshUntil(success.at, this.intervalMs).toISOString(),
      coverage,
      latestAttempt:
        state.latestAttempt === null
          ? null
          : {
              at: state.latestAttempt.at.toISOString(),
              succeeded: state.latestAttempt.succeeded,
              failure: state.latestAttempt.failure,
              consecutiveFailures: state.consecutiveFailures,
            },
      findings: evaluateFindings({
        controllerClock,
        sameMachineIdAs,
        current: success?.observation ?? null,
        previous: state.previousSuccess,
        consecutiveFailures: state.consecutiveFailures,
        latestFailureCode: state.latestAttempt?.failure?.code ?? null,
      }),
      observation: success?.observation ?? null,
    };
  }
}
