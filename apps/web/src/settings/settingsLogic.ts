/**
 * settingsLogic — schedule maths, validation and fixed wording for Settings
 * (T-074, PRD FR-19/FR-21/FR-03, UX Spec §13.2 and §14). Pure; no React.
 *
 * Rules carried here:
 *   - schedules only look: no schedule installs, restarts, reboots or cleans up;
 *   - times use the owner's zone; "next run" is none while paused, never a
 *     stale time;
 *   - retention is the PRD's proposal (30 days observations and chat, 90 days
 *     operation records) and says it is a proposal;
 *   - a disconnect never claims the remote key is gone.
 */
import { SCHEDULE_DEFAULTS, type AccessServer, type DisconnectPreview, type DisconnectResponse, type ScheduleSettings } from "@servrsit/contracts";
import type { SettingsClientError } from "../api/settings";
import { formatClock, formatUntil, isValidTimeZone, zoneLabel } from "../lib/time";

const DEFAULT_ZONE = "Asia/Jakarta";

export const INTERVALS = [5, 15, 30, 60] as const;
export const INTERVAL_LABEL: Readonly<Record<number, string>> = { 5: "Every 5 minutes", 15: "Every 15 minutes", 30: "Every 30 minutes", 60: "Every hour" };

export const TIME_ZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "Australia/Sydney", "UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles"] as const;

export const SCHEDULE_STATEMENT = "Schedules only look at your servers. No schedule can install updates, restart a service, reboot or clean anything up. Those need a plan you approve.";
export const DAILY_NOT_IN_EFFECT = "There is no separate daily check yet. Every check runs at the interval above, so this time is saved but not used.";
export const REFRESH_NOTE = "Allow package-list refresh is off and not available yet. Without it, ServrSit shows how old the existing package information is.";
export const AI_OFF_NOTE = "Turning AI off stops new AI requests. Checks, findings, plans, approvals and history keep working.";
export const RETENTION_NOTE = "These are the configured values. They cannot be changed here, and anything longer needs an explicit product decision.";
export const DELETION_NOTE = "Self-service deletion of your data and account arrives with Stage B. When it does, active data is deleted within 30 days and backups expire within a further 30 days. Until then, nothing here deletes data.";

export const COLLECTED = [
  "Facts about each server: hostname, operating system, load, memory, storage, uptime, failed services, pending updates, reboot flag.",
  "ServrSit's own records: findings, plans, approvals, operation steps and times, your schedule and settings.",
];
export const NOT_COLLECTED = "ServrSit does not collect the contents of home directories, repositories, databases or application files.";
/** What is sent comes from the API (`ai.sends`); this is what the AI's text can and cannot do. */
export const SENT_TO_AI = [
  "AI text only explains. It never approves a change and is never proof of a server's state.",
];

export function validateDailyTime(v: string): string | null {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : "Enter a time as HH:MM, for example 03:00.";
}

export interface ScheduleDraft {
  readonly intervalMinutes: number;
  readonly dailyTime: string;
  readonly timeZone: string;
}

export function validateSchedule(d: ScheduleDraft): { dailyTime?: string; timeZone?: string; intervalMinutes?: string } {
  const e: { dailyTime?: string; timeZone?: string; intervalMinutes?: string } = {};
  const t = validateDailyTime(d.dailyTime);
  if (t) e.dailyTime = t;
  if (!isValidTimeZone(d.timeZone)) e.timeZone = "Choose a time zone from the list.";
  if (!(INTERVALS as readonly number[]).includes(d.intervalMinutes)) e.intervalMinutes = "Choose one of the intervals.";
  return e;
}

export const isDirty = (saved: ScheduleDraft, draft: ScheduleDraft): boolean =>
  saved.intervalMinutes !== draft.intervalMinutes || saved.dailyTime !== draft.dailyTime || saved.timeZone !== draft.timeZone;

export const isDefaultSchedule = (s: ScheduleDraft): boolean =>
  s.intervalMinutes === SCHEDULE_DEFAULTS.intervalMinutes && s.dailyTime === SCHEDULE_DEFAULTS.dailyTime && s.timeZone === DEFAULT_ZONE;

// ── Next run ────────────────────────────────────────────────────────────────

/** The next health check: the next wall-clock multiple of the interval. Null while paused. */
export function nextHealthRun(now: Date, intervalMinutes: number, paused: boolean): Date | null {
  if (paused) return null;
  const ms = intervalMinutes * 60_000;
  return new Date((Math.floor(now.getTime() / ms) + 1) * ms);
}

function partsInZone(utcMs: number, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  );
  return { y: Number(p["year"]), m: Number(p["month"]), d: Number(p["day"]), h: Number(p["hour"]), mi: Number(p["minute"]), s: Number(p["second"]) };
}

/** The UTC instant at which the wall clock in `tz` reads y-m-d h:mi (DST-aware, resolved twice). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = (at: number): number => { const p = partsInZone(at, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at / 1000) * 1000; };
  let t = guess - off(guess);
  const second = off(t);
  if (second !== off(guess)) t = guess - second;
  return t;
}

/** The next daily check at HH:MM in the owner's zone. Null while paused or when the time is invalid. */
export function nextDailyRun(now: Date, dailyTime: string, tz: string, paused: boolean): Date | null {
  if (paused || validateDailyTime(dailyTime) !== null || !isValidTimeZone(tz)) return null;
  const [hh, mm] = dailyTime.split(":").map(Number) as [number, number];
  const p = partsInZone(now.getTime(), tz);
  let t = zonedToUtc(p.y, p.m, p.d, hh, mm, tz);
  if (t <= now.getTime()) {
    const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    t = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hh, mm, tz);
  }
  return new Date(t);
}

export function describeNext(at: Date | null, now: Date, tz: string, uncertain = false): string {
  return at === null ? "None while checks are paused" : `${formatClock(at, now, tz)} (${formatUntil(at, now, uncertain)})`;
}

/** "Asia/Jakarta (WIB)" for details; abbreviations alone can be ambiguous. */
export const zoneName = (tz: string, at: Date): string => `${tz} (${zoneLabel(tz, at)})`;

// ── Disconnect ──────────────────────────────────────────────────────────────

export interface DisconnectCopy {
  readonly title: string;
  readonly stops: readonly string[];
  /** Why disconnecting is blocked right now, or null when it is allowed. */
  readonly blocked: string | null;
  readonly queued: readonly string[];
  readonly active: readonly string[];
  readonly keep: readonly string[];
  readonly yourStep: string;
  readonly confirmLabel: string;
}

export function disconnectCopy(s: AccessServer, p: DisconnectPreview): DisconnectCopy {
  const blocked = p.canDisconnect ? null : "This server has an operation that is not finished. Disconnecting is blocked until it finishes or its outcome is confirmed, because ServrSit cannot stop work that is already on the server.";
  return {
    title: `Disconnect ${s.name}?`,
    stops: [
      "ServrSit stops every scheduled check for this server.",
      "No new work will be started for it, and stored access is disabled.",
      "Reconnecting later needs valid access and a new host key verification.",
    ],
    blocked,
    queued: p.queued.length === 0 ? ["No queued work."] : p.queued.map((w) => `${w.title}: waiting to start.`),
    active: p.active.length === 0 ? ["No work is running."] : p.active.map((w) => `${w.title}: running. ServrSit cannot stop it.`),
    keep: [
      "Disconnecting does not delete the server or shut it down.",
      "Your records of past checks and operations stay in History until retention removes them.",
    ],
    yourStep: s.keyKind === "owner key"
      ? "ServrSit used your own key. After you disconnect you will get steps if you want to stop that key working."
      : s.keyKind === "local"
        ? "This server is reached without a key. There is nothing to remove on it."
        : "ServrSit cannot remove its key from the server. After you disconnect you will get the exact line and steps to remove it yourself.",
    confirmLabel: `Disconnect ${s.name}`,
  };
}

export interface DisconnectResult {
  readonly headline: string;
  readonly done: readonly string[];
  readonly notDone: readonly string[];
  readonly steps: readonly string[];
  readonly line: string | null;
}

export function describeDisconnect(name: string, r: DisconnectResponse, preview: DisconnectPreview): DisconnectResult {
  const done = [
    r.schedulesStopped ? "Every scheduled check for this server was stopped." : "",
    r.controllerKeyDeleted ? "ServrSit deleted the key it made for this server." : "ServrSit had no key of its own to delete for this server.",
  ].filter((x) => x !== "");
  const notDone = [
    r.remoteKeyRemoved ? "" : "ServrSit cannot confirm that its key line is gone from the server. Deleting its own saved copy does not remove the key on the server.",
    preview.active.length > 0 ? `${preview.active.length} action${preview.active.length === 1 ? " was" : "s were"} already running and may continue: ${preview.active.map((w) => w.title).join("; ")}.` : "",
    "The server itself was not deleted or shut down.",
  ].filter((x) => x !== "");
  return { headline: `${name} is disconnected`, done, notDone, steps: r.remoteSteps, line: r.authorizedKeysLine };
}

export function toScheduleDraft(s: ScheduleSettings): ScheduleDraft {
  return { intervalMinutes: s.intervalMinutes, dailyTime: s.dailyTime, timeZone: s.timeZone };
}

export const KEY_KIND_LABEL: Readonly<Record<AccessServer["keyKind"], string>> = {
  "dedicated ServrSit key": "Dedicated ServrSit key",
  "owner key": "Your own key",
  local: "None: ServrSit's own machine",
};

/** What to tell the owner when a settings call fails. A lost answer never claims nothing changed. */
export function settingsErrorText(code: SettingsClientError, reason?: string): string {
  const why = reason ? ` ${reason}` : "";
  switch (code) {
    case "INVALID_INPUT": return `ServrSit did not accept that value.${why} Nothing was changed.`;
    case "NOT_FOUND":
    case "SERVER_NOT_FOUND": return "ServrSit could not find that. Reload the page. Nothing was changed.";
    case "NOT_ALLOWED": return `ServrSit will not do that.${why} Nothing was changed.`;
    case "STATE_CONFLICT": return `That cannot be done right now.${why} Nothing was changed.`;
    case "UNAUTHENTICATED": return "You are signed out. Sign in again, then repeat that.";
    case "CSRF_INVALID": return "Your session needs a refresh. Reload the page, then repeat that. Nothing was changed.";
    default: return "ServrSit did not get a clear answer, so the change may or may not have been made. Reload the page to see what is saved.";
  }
}
