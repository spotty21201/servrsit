/**
 * activityViewModel — filters, search, grouping and row text for the Activity
 * page (T-071, UX-10, UX Spec §14). Pure; no React.
 *
 * Rules carried here:
 *   - the default list shows meaningful records (operations and findings);
 *     routine inspection checks stay available behind the type filter;
 *   - search matches server name, title and id only, never summaries, so no
 *     output text is searched;
 *   - an operation in an unknown or partial state never reads as success;
 *   - export states its date range, time zone and what was redacted.
 */
import type { ActivityRecord, ActivityResult, ActivityType, ExportRequest } from "../api/stubs/activity";
import { formatClockWithAge, formatClock, parseIso, zoneLabel, resolveTimeZone } from "../lib/time";

export type Period = "24h" | "7d" | "30d" | "all";

export interface Filters {
  readonly types: readonly ActivityType[];
  readonly serverId: string;
  readonly result: ActivityResult | "any";
  readonly period: Period;
  readonly query: string;
}

export const DEFAULT_FILTERS: Filters = { types: ["operation", "finding"], serverId: "", result: "any", period: "30d", query: "" };

export const PERIOD_LABEL: Readonly<Record<Period, string>> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };
const PERIOD_MS: Readonly<Record<Period, number | null>> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, all: null };

export const TYPE_LABEL: Readonly<Record<ActivityType, string>> = { operation: "Operations", finding: "Findings", inspection: "Routine checks" };
export const TYPE_TAG: Readonly<Record<ActivityType, string>> = { operation: "Operation", finding: "Finding", inspection: "Check" };

export const RESULT_LABEL: Readonly<Record<ActivityResult, string>> = {
  succeeded: "Completed",
  partial: "Partly completed",
  failed: "Could not complete",
  unknown: "Result not confirmed",
  cancelled: "Cancelled",
  "in-progress": "In progress",
  info: "Recorded",
};

/** Operations use the UX §11 wording; other types get a neutral label. */
export function resultLabel(type: ActivityType, r: ActivityResult): string {
  if (type === "operation") {
    return { succeeded: "Completed and verified", partial: "Some work completed", failed: "Could not complete", unknown: "Result not yet confirmed", cancelled: "Cancelled, no work started", "in-progress": "In progress", info: "Recorded" }[r];
  }
  if (type === "inspection") return { succeeded: "All checks ran", partial: "Partly checked", failed: "Check failed", unknown: "Not confirmed", cancelled: "Cancelled", "in-progress": "In progress", info: "Recorded" }[r];
  return { succeeded: "Resolved", partial: "Partly resolved", failed: "Open, critical", unknown: "Not rechecked", cancelled: "Dismissed", "in-progress": "In progress", info: "Opened" }[r];
}

export type ResultTone = "passed" | "attention" | "failed" | "unknown" | "progress";
export const RESULT_TONE: Readonly<Record<ActivityResult, ResultTone>> = {
  succeeded: "passed", partial: "attention", failed: "failed", unknown: "unknown", cancelled: "unknown", "in-progress": "progress", info: "unknown",
};

export function filterRecords(records: readonly ActivityRecord[], f: Filters, now: Date): ActivityRecord[] {
  const span = PERIOD_MS[f.period];
  const q = f.query.trim().toLowerCase();
  return records
    .filter((r) => f.types.includes(r.type))
    .filter((r) => f.serverId === "" || r.serverId === f.serverId)
    .filter((r) => f.result === "any" || r.result === f.result)
    .filter((r) => span === null || now.getTime() - Date.parse(r.at) <= span)
    .filter((r) => q === "" || r.serverName.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export interface RowVM {
  readonly id: string;
  readonly typeTag: string;
  readonly title: string;
  readonly serverName: string;
  readonly production: boolean;
  readonly resultLabel: string;
  readonly tone: ResultTone;
  readonly summary: string;
  readonly when: string;
  readonly href: string | null;
}

export function toRow(r: ActivityRecord, now: Date, tz: string, uncertain = false): RowVM {
  const at = parseIso(r.at);
  return {
    id: r.id, typeTag: TYPE_TAG[r.type], title: r.title, serverName: r.serverName, production: r.production,
    resultLabel: resultLabel(r.type, r.result), tone: RESULT_TONE[r.result], summary: r.summary,
    when: at ? formatClockWithAge(at, now, tz, uncertain) : "unknown time", href: r.href,
  };
}

/** "Today", "Yesterday" or "14 Nov", in the owner's zone. */
export function dayLabel(iso: string, now: Date, tz: string): string {
  const d = parseIso(iso);
  if (!d) return "Unknown day";
  const z = resolveTimeZone(tz);
  const key = (x: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  if (key(d) === key(now)) return "Today";
  if (key(d) === key(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { timeZone: z, day: "numeric", month: "short" }).format(d);
}

export function groupByDay(records: readonly ActivityRecord[], now: Date, tz: string): Array<{ label: string; records: ActivityRecord[] }> {
  const out: Array<{ label: string; records: ActivityRecord[] }> = [];
  for (const r of records) {
    const label = dayLabel(r.at, now, tz);
    const last = out[out.length - 1];
    if (last && last.label === label) last.records.push(r);
    else out.push({ label, records: [r] });
  }
  return out;
}

export function countText(shown: number, total: number): string {
  return shown === total ? `${total} record${total === 1 ? "" : "s"}` : `${shown} of ${total} records match`;
}

export function isDefault(f: Filters): boolean {
  return f.serverId === "" && f.result === "any" && f.period === DEFAULT_FILTERS.period && f.query.trim() === "" &&
    f.types.length === DEFAULT_FILTERS.types.length && DEFAULT_FILTERS.types.every((t) => f.types.includes(t));
}

// ── Export ──────────────────────────────────────────────────────────────────

export interface ExportPlan {
  readonly request: ExportRequest;
  /** The sentence shown before and after exporting. */
  readonly statement: string;
}

export function planExport(format: ExportRequest["format"], records: readonly ActivityRecord[], f: Filters, now: Date, tz: string): ExportPlan {
  const span = PERIOD_MS[f.period];
  const times = records.map((r) => Date.parse(r.at)).filter(Number.isFinite);
  const from = span !== null ? new Date(now.getTime() - span) : new Date(times.length ? Math.min(...times) : now.getTime());
  const z = resolveTimeZone(tz);
  return {
    request: { format, from: from.toISOString(), to: now.toISOString(), timeZone: z, recordIds: records.map((r) => r.id) },
    statement: `${records.length} record${records.length === 1 ? "" : "s"}, ${formatClock(from, now, z)} to ${formatClock(now, now, z)}, times in ${z} (${zoneLabel(z, now)}).`,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KiB`;
}
