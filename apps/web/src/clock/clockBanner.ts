/**
 * Wording and rules for the control-plane clock banner. Pure; no React.
 *
 *   trusted      no banner; ages are certain
 *   untrusted    critical banner: "ServrSit's own clock is wrong (about 7 h
 *                fast), so ages and expiry times may be off. Approvals are
 *                paused until it is fixed." Ages are marked "≈". Approval is
 *                disabled in the UI (the API blocks it too).
 *   not-checked  attention banner: the check isn't running in this mode. Ages
 *                are not marked and approval is not paused by this banner.
 *   unknown      (no controlPlane in the response, older API) no banner
 *
 * Plain wording only. No cheek: this is a failure state.
 */
import { ControllerClockSchema } from "@servrsit/contracts";
import type { ControllerClockView } from "./clockTypes";

export const CLOCK_TOLERANCE_SECONDS = 120;

export type ClockSeverity = "critical" | "attention";

export interface ClockBannerView {
  readonly severity: ClockSeverity;
  readonly title: string;
  readonly text: string;
  /** The API's reason text, shown as supporting detail. */
  readonly reason: string;
  /** Relative ages should carry a "≈" and expiry should be treated as uncertain. */
  readonly agesUncertain: boolean;
  /** Plan approval must stay disabled. */
  readonly approvalsPaused: boolean;
}

/** "7 h", "12 min", "3 days": coarse on purpose; the offset is itself an estimate. */
export function describeSpan(seconds: number): string {
  const s = Math.abs(seconds);
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export function clockBanner(clock: ControllerClockView | null | undefined): ClockBannerView | null {
  if (!clock || clock.status === "trusted") return null;
  if (clock.status === "not-checked") {
    return {
      severity: "attention",
      title: "Clock not checked",
      text: "ServrSit is not checking its own clock in this mode, so ages and expiry times are not confirmed.",
      reason: clock.reason,
      agesUncertain: false,
      approvalsPaused: false,
    };
  }
  const known = clock.offsetSeconds !== null && Math.abs(clock.offsetSeconds) > CLOCK_TOLERANCE_SECONDS;
  const lead = known
    ? `ServrSit's own clock is wrong (about ${describeSpan(clock.offsetSeconds as number)} ${(clock.offsetSeconds as number) > 0 ? "fast" : "slow"})`
    : "ServrSit can't confirm its own clock is right";
  return {
    severity: "critical",
    title: "Clock problem",
    text: `${lead}, so ages and expiry times may be off. Approvals are paused until it is fixed.`,
    reason: clock.reason,
    agesUncertain: true,
    approvalsPaused: true,
  };
}

/** Read controlPlane.clock from a raw /api/fleet body with the contract schema; null when absent or invalid. */
export function parseClock(json: unknown): ControllerClockView | null {
  if (typeof json !== "object" || json === null) return null;
  const cp = (json as { controlPlane?: unknown }).controlPlane;
  if (typeof cp !== "object" || cp === null) return null;
  const parsed = ControllerClockSchema.safeParse((cp as { clock?: unknown }).clock);
  return parsed.success ? parsed.data : null;
}

/**
 * [FIXTURE DATA] Synthetic clock states for tests and /fixtures/clock.
 * They describe no real machine.
 */
export const FIXTURE_CLOCKS: Readonly<Record<"trusted" | "untrusted-fast" | "untrusted-unverified" | "not-checked", ControllerClockView>> = {
  trusted: { status: "trusted", checkedAt: "2026-11-17T08:00:00Z", ntpSynchronized: true, offsetSeconds: 1, uncertaintySeconds: 1, basis: "https-date", sources: [], reason: "[FIXTURE DATA] Synchronized and within 2 minutes of two independent sources." },
  "untrusted-fast": { status: "untrusted", checkedAt: "2026-11-17T08:00:00Z", ntpSynchronized: false, offsetSeconds: 25_200, uncertaintySeconds: 1, basis: "https-date", sources: [], reason: "[FIXTURE DATA] Not synchronized with NTP, and two HTTPS sources agree this clock is about 7 hours ahead." },
  "untrusted-unverified": { status: "untrusted", checkedAt: "2026-11-17T08:00:00Z", ntpSynchronized: null, offsetSeconds: null, uncertaintySeconds: null, basis: "none", sources: [], reason: "[FIXTURE DATA] The sync status could not be read and no outside source answered." },
  "not-checked": { status: "not-checked", checkedAt: null, ntpSynchronized: null, offsetSeconds: null, uncertaintySeconds: null, basis: "none", sources: [], reason: "[FIXTURE DATA] This process does not run the clock check." },
};
