/**
 * T-063: ServrSit checks its OWN clock (the controller's). Tech Spec §8.2, PRD FR-06.
 *
 * Every observation time, freshness window, age and plan expiry comes from
 * this machine's clock. If it is wrong, every one of them is wrong, and the
 * T-061 skew of each target is measured against a wrong reference. Found
 * live: Merauke ran about 7 hours fast with time sync failing, so every target
 * looked 7 hours slow.
 *
 * Evidence, all read-only:
 *  - `timedatectl show --property=NTPSynchronized --value` (fixed arguments, no shell, no sudo)
 *  - the HTTP `Date` header from two independent HTTPS sources (HEAD requests)
 *  - when neither gives an offset: whether most targets agree with each other
 *    on the same skew, which points at the controller rather than at them all
 *
 * ServrSit never changes the system clock. Fixing it is the owner's job.
 */

import { execFile } from "node:child_process";
import { CLOCK_SKEW_TOLERANCE_SECONDS } from "@servrsit/contracts";
import type { ControllerClock, Finding } from "@servrsit/contracts";

export const DEFAULT_TIME_SOURCES: ReadonlyArray<{ readonly name: string; readonly url: string }> = [
  { name: "google.com", url: "https://www.google.com/" },
  { name: "cloudflare.com", url: "https://www.cloudflare.com/" },
];
const HTTPS_TIMEOUT_MS = 5_000;
const TIMEDATECTL_TIMEOUT_MS = 3_000;

export interface HttpsDateReading {
  readonly sentMs: number;
  readonly receivedMs: number;
  readonly remoteMs: number;
}

/** The two read-only probes. Replaced in tests. */
export interface ClockProbe {
  ntpSynchronized(): Promise<boolean | null>;
  httpsDate(url: string): Promise<HttpsDateReading | null>;
}

export const systemClockProbe: ClockProbe = {
  ntpSynchronized: () =>
    new Promise((resolve) => {
      execFile(
        "timedatectl",
        ["show", "--property=NTPSynchronized", "--value"],
        { timeout: TIMEDATECTL_TIMEOUT_MS, maxBuffer: 1024, shell: false, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } },
        (error, stdout) => {
          const v = String(stdout).trim();
          resolve(error !== null ? null : v === "yes" ? true : v === "no" ? false : null);
        },
      );
    }),
  httpsDate: async (url) => {
    const sentMs = Date.now();
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(HTTPS_TIMEOUT_MS) });
      const receivedMs = Date.now();
      const date = res.headers.get("date");
      const remoteMs = date === null ? Number.NaN : Date.parse(date);
      return Number.isFinite(remoteMs) ? { sentMs, receivedMs, remoteMs } : null;
    } catch {
      return null;
    }
  },
};

export interface ClockEvidence {
  readonly checkedAt: Date;
  readonly ntpSynchronized: boolean | null;
  readonly sources: ReadonlyArray<{ readonly name: string; readonly reading: HttpsDateReading | null }>;
}

const tolerance = CLOCK_SKEW_TOLERANCE_SECONDS;
const beyond = (offset: number, uncertainty: number) => Math.abs(offset) - uncertainty > tolerance;

/** "7 h", "3 min", "45 s": the size of a clock difference. */
export function describeSpan(seconds: number): string {
  const abs = Math.abs(seconds);
  return abs >= 3600 ? `${Math.round(abs / 3600)} h` : abs >= 60 ? `${Math.round(abs / 60)} min` : `${abs} s`;
}

/** "about 7 h fast", "about 3 min slow". */
export function describeOffset(offsetSeconds: number): string {
  return `about ${describeSpan(offsetSeconds)} ${offsetSeconds > 0 ? "fast" : "slow"}`;
}

/** Turn the raw evidence into a status. Pure: no I/O. */
export function evaluateControllerClock(e: ClockEvidence): ControllerClock {
  const readings = e.sources.map((s) => {
    if (s.reading === null) return { name: s.name, ok: false, offsetSeconds: null, uncertainty: null };
    const { sentMs, receivedMs, remoteMs } = s.reading;
    // The server stamped its Date somewhere between our send and receive; Date has 1 s resolution.
    const localMid = (sentMs + receivedMs) / 2;
    const offsetSeconds = Math.round((localMid - remoteMs) / 1000) || 0;
    const uncertainty = Math.ceil(Math.max(0, receivedMs - sentMs) / 2000) + 1;
    return { name: s.name, ok: true, offsetSeconds, uncertainty };
  });
  const good = readings.filter((r) => r.ok) as Array<{ name: string; ok: true; offsetSeconds: number; uncertainty: number }>;
  const sources = readings.map(({ name, ok, offsetSeconds }) => ({ name, ok, offsetSeconds }));
  const base = { checkedAt: e.checkedAt.toISOString(), ntpSynchronized: e.ntpSynchronized, sources };

  let offsetSeconds: number | null = null;
  let uncertaintySeconds: number | null = null;
  let disagree = false;
  if (good.length > 0) {
    const offsets = good.map((g) => g.offsetSeconds);
    const spread = Math.max(...offsets) - Math.min(...offsets);
    disagree = spread > tolerance;
    offsetSeconds = Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length);
    uncertaintySeconds = Math.max(...good.map((g) => g.uncertainty)) + Math.ceil(spread / 2);
  }
  const basis = offsetSeconds === null || disagree ? "none" : "https-date";
  const known = basis === "https-date" ? { offsetSeconds, uncertaintySeconds } : { offsetSeconds: null, uncertaintySeconds: null };

  if (disagree) {
    return { ...base, status: "untrusted", ...known, basis, reason: "The internet time sources disagree with each other, so ServrSit cannot confirm its own clock." };
  }
  if (offsetSeconds !== null && uncertaintySeconds !== null && beyond(offsetSeconds, uncertaintySeconds)) {
    const sync = e.ntpSynchronized === false ? " and time synchronisation is not working" : "";
    return { ...base, status: "untrusted", ...known, basis, reason: `ServrSit's own clock is ${describeOffset(offsetSeconds)}${sync}.` };
  }
  if (e.ntpSynchronized === false) {
    return { ...base, status: "untrusted", ...known, basis, reason: "ServrSit's own clock is not synchronised with a time server." };
  }
  if (offsetSeconds === null && e.ntpSynchronized !== true) {
    return { ...base, status: "untrusted", ...known, basis, reason: "ServrSit could not verify its own clock: no time source answered and synchronisation status is unknown." };
  }
  return { ...base, status: "trusted", ...known, basis, reason: "ServrSit's own clock is synchronised and within 2 minutes of internet time." };
}

/**
 * When no HTTPS source gave an offset, but most measured targets agree with
 * each other on one skew beyond tolerance, the controller is the odd one out:
 * attribute that skew to it (T-063).
 */
export function attributeToController(
  clock: ControllerClock,
  targets: ReadonlyArray<{ readonly skewSeconds: number; readonly uncertaintySeconds: number }>,
): ControllerClock {
  if (clock.status === "not-checked" || clock.offsetSeconds !== null || targets.length < 2) return clock;
  const sorted = [...targets].map((t) => t.skewSeconds).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] as number;
  const agreeing = targets.filter((t) => Math.abs(t.skewSeconds - median) <= tolerance);
  if (agreeing.length * 2 <= targets.length) return clock;
  const uncertaintySeconds = Math.max(...agreeing.map((t) => t.uncertaintySeconds)) + tolerance;
  if (!beyond(median, uncertaintySeconds)) return clock;
  // Targets read target - controller; the controller's offset is the opposite.
  const offsetSeconds = -median;
  return {
    ...clock,
    status: "untrusted",
    offsetSeconds,
    uncertaintySeconds,
    basis: "target-agreement",
    reason: `ServrSit's own clock appears to be ${describeOffset(offsetSeconds)}: ${agreeing.length} of ${targets.length} servers agree with each other and differ from it by the same amount.`,
  };
}

export const NOT_CHECKED_CLOCK: ControllerClock = {
  status: "not-checked",
  checkedAt: null,
  ntpSynchronized: null,
  offsetSeconds: null,
  uncertaintySeconds: null,
  basis: "none",
  sources: [],
  reason: "This process does not check ServrSit's own clock (tests or fixture mode).",
};

/** The control-plane finding for an untrusted controller clock. */
export function controllerClockFindings(clock: ControllerClock): Finding[] {
  if (clock.status !== "untrusted") return [];
  return [
    {
      id: "controller-clock",
      rule: "control.clock.v1",
      severity: "critical",
      summary: `${clock.reason} Times, ages and expiries ServrSit shows may be wrong, and plan approval is blocked until the clock is fixed. ServrSit does not change the system clock.`,
    },
  ];
}

export interface ControllerClockMonitorOptions {
  readonly probe?: ClockProbe | undefined;
  readonly sources?: ReadonlyArray<{ readonly name: string; readonly url: string }> | undefined;
  readonly intervalMs: number;
  readonly now?: (() => Date) | undefined;
  readonly log?: { info(o: object, m: string): void; warn(o: object, m: string): void } | undefined;
}

/** Runs the check on a schedule. Until the first check finishes the clock is untrusted. */
export class ControllerClockMonitor {
  private state: ControllerClock = {
    ...NOT_CHECKED_CLOCK,
    status: "untrusted",
    reason: "ServrSit has not checked its own clock yet.",
  };
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly probe: ClockProbe;
  private readonly sources: ReadonlyArray<{ readonly name: string; readonly url: string }>;
  private readonly now: () => Date;

  constructor(private readonly options: ControllerClockMonitorOptions) {
    this.probe = options.probe ?? systemClockProbe;
    this.sources = options.sources ?? DEFAULT_TIME_SOURCES;
    this.now = options.now ?? (() => new Date());
  }

  current(): ControllerClock {
    return this.state;
  }

  check(): Promise<void> {
    if (this.running !== null) return this.running;
    this.running = (async () => {
      const [ntp, ...readings] = await Promise.all([
        this.probe.ntpSynchronized(),
        ...this.sources.map((s) => this.probe.httpsDate(s.url)),
      ]);
      this.state = evaluateControllerClock({
        checkedAt: this.now(),
        ntpSynchronized: ntp as boolean | null,
        sources: this.sources.map((s, i) => ({ name: s.name, reading: (readings[i] ?? null) as HttpsDateReading | null })),
      });
      const fields = { status: this.state.status, offsetSeconds: this.state.offsetSeconds, ntpSynchronized: this.state.ntpSynchronized };
      if (this.state.status === "trusted") this.options.log?.info(fields, "controller clock checked");
      else this.options.log?.warn(fields, "controller clock untrusted");
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  start(): void {
    if (this.timer !== null) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.running !== null) await this.running;
  }
}
