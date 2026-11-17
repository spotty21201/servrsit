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

import {
  collectLocal,
  collectViaSsh,
  pinStateFor,
  type CollectionResult,
  type InspectionObservation,
  type PinState,
} from "@servrsit/ssh";
import type { HostConfig, FleetConfig } from "./config.js";
import { evaluateFindings } from "./findings.js";
import type { FleetResponse, FleetServer } from "./schema.js";
import { coverageOf, deriveStatus, freshUntil, type Attempt } from "./status.js";

export type Collector = (host: HostConfig) => Promise<CollectionResult>;
export type PinChecker = (host: HostConfig) => Promise<PinState>;

export interface FleetServiceOptions {
  readonly config: FleetConfig;
  readonly knownHostsFile: string;
  readonly collector?: Collector | undefined;
  readonly pinChecker?: PinChecker | undefined;
  readonly now?: (() => Date) | undefined;
  readonly log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void } | undefined;
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
              { knownHostsFile: options.knownHostsFile },
            ));
    this.pinChecker =
      options.pinChecker ??
      (async (host) =>
        host.access === "local" ? "pinned" : pinStateFor(options.knownHostsFile, host.address, host.port));
    for (const host of options.config.hosts) {
      this.states.set(host.id, {
        pin: host.access === "local" ? "pinned" : "unknown",
        latestAttempt: null,
        lastSuccess: null,
        previousSuccess: null,
        consecutiveFailures: 0,
        retryBlocked: false,
      });
    }
  }

  private get intervalMs(): number {
    return this.options.config.healthIntervalMinutes * 60_000;
  }

  /** Run one pass over all hosts, serially. Concurrent calls share one run. */
  refreshAll(): Promise<void> {
    if (this.running !== null) return this.running;
    this.running = this.runPass().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runPass(): Promise<void> {
    for (const host of this.options.config.hosts) {
      await this.refreshOne(host);
    }
    this.lastRunAt = this.now();
  }

  private async refreshOne(host: HostConfig): Promise<void> {
    const state = this.states.get(host.id);
    if (state === undefined) return;
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
    if (this.timer !== null) return;
    void this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.running !== null) await this.running;
  }

  snapshot(): FleetResponse {
    const now = this.now();
    const servers = this.options.config.hosts.map((host) => this.serverView(host, now));
    const next =
      this.timer === null
        ? null
        : new Date((this.lastRunAt ?? now).getTime() + this.intervalMs).toISOString();
    return {
      mode: "live",
      generatedAt: now.toISOString(),
      healthIntervalMinutes: this.options.config.healthIntervalMinutes,
      ownerTimeZone: this.options.config.ownerTimeZone,
      nextCheckAt: next,
      servers,
    };
  }

  private serverView(host: HostConfig, now: Date): FleetServer {
    const state = this.states.get(host.id);
    if (state === undefined) throw new Error(`no state for ${host.id}`);
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
        current: success?.observation ?? null,
        previous: state.previousSuccess,
        consecutiveFailures: state.consecutiveFailures,
        latestFailureCode: state.latestAttempt?.failure?.code ?? null,
      }),
      observation: success?.observation ?? null,
    };
  }
}
