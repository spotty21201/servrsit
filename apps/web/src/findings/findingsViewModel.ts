/**
 * findingsViewModel — finding records and scheduler state → what the Findings
 * screen and the Overview notice show (T-070, PRD FR-20, UX Spec §13.1/§13.2).
 * Pure; no React.
 *
 * Wording rules carried here:
 *   - "Acknowledged" means seen, never resolved; the text says so.
 *   - "Snoozed" delays notifications; the text says so.
 *   - "Resolved" appears only with the observation that established recovery.
 *   - A finding with no current evidence reads "Previously detected, not
 *     rechecked", never "Resolved".
 *   - Paused or delayed or unavailable checking is never an all-clear.
 *   - Plain wording, no cheek: these are issues.
 */
import type { FleetResponse } from "@servrsit/contracts";
import type { FindingRecord, FindingSeverity, FindingState, SchedulerStatus } from "../api/stubs/findings";
import { formatClock, formatClockWithAge, parseIso } from "../lib/time";

export type TagKey = "failed" | "attention" | "unknown" | "passed" | "progress";

export const SEVERITY_LABEL: Readonly<Record<FindingSeverity, string>> = { critical: "Critical", warning: "Needs attention", advisory: "Advisory" };
const SEVERITY_RANK: Readonly<Record<FindingSeverity, number>> = { critical: 0, warning: 1, advisory: 2 };

export const STATE_LABEL: Readonly<Record<FindingState, string>> = {
  new: "New",
  acknowledged: "Acknowledged",
  snoozed: "Snoozed",
  resolved: "Resolved",
  "not-rechecked": "Previously detected, not rechecked",
};

export interface FindingVM {
  readonly id: string;
  readonly serverId: string;
  readonly serverName: string;
  readonly production: boolean;
  readonly severity: FindingSeverity;
  readonly severityLabel: string;
  readonly summary: string;
  readonly rule: string;
  readonly state: FindingState;
  readonly stateLabel: string;
  readonly stateTag: TagKey;
  /** One sentence that says what the state does and does not mean. */
  readonly stateNote: string;
  readonly firstObserved: string;
  readonly lastObserved: string;
  readonly canAcknowledge: boolean;
  readonly canSnooze: boolean;
  /** Active findings sort above earlier ones. */
  readonly active: boolean;
}

function tagFor(state: FindingState, sev: FindingSeverity): TagKey {
  if (state === "new") return sev === "critical" ? "failed" : sev === "warning" ? "attention" : "unknown";
  if (state === "resolved") return "passed";
  return "unknown";
}

export function toFindingVM(r: FindingRecord, now: Date, tz: string, uncertain = false): FindingVM {
  const at = (iso: string | null): string => {
    const d = parseIso(iso);
    return d ? formatClockWithAge(d, now, tz, uncertain) : "unknown time";
  };
  let note: string;
  switch (r.state) {
    case "new":
      note = "You have not looked at this yet.";
      break;
    case "acknowledged":
      note = `You saw this ${at(r.acknowledgedAt)}. Acknowledged is not resolved: it stays on the list until a check no longer finds it.`;
      break;
    case "snoozed": {
      const until = parseIso(r.snoozedUntil);
      note = `Snoozed until ${until ? formatClock(until, now, tz) : "an unknown time"}. Snoozing only delays notifications. It is not resolved, and the checks keep running.`;
      break;
    }
    case "resolved":
      note = `${r.resolvedBy ?? "A later check no longer found it."} Resolved ${at(r.resolvedAt)}.`;
      break;
    case "not-rechecked":
      note = "No check has been able to look at this since. There is no current evidence either way, so it is not resolved.";
      break;
  }
  const active = r.state === "new" || r.state === "acknowledged" || r.state === "snoozed";
  return {
    id: r.id, serverId: r.serverId, serverName: r.serverName, production: r.production,
    severity: r.severity, severityLabel: SEVERITY_LABEL[r.severity], summary: r.summary, rule: r.rule,
    state: r.state, stateLabel: STATE_LABEL[r.state], stateTag: tagFor(r.state, r.severity), stateNote: note,
    firstObserved: `First seen ${at(r.firstObservedAt)}`,
    lastObserved: `Last seen ${at(r.lastObservedAt)}`,
    canAcknowledge: r.state === "new",
    canSnooze: active,
    active,
  };
}

export function sortFindings(list: readonly FindingVM[]): FindingVM[] {
  return [...list].sort((a, b) => Number(b.active) - Number(a.active) || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.serverName.localeCompare(b.serverName));
}

export interface FindingsSummary {
  readonly active: number;
  readonly fresh: number;
  readonly earlier: number;
  readonly text: string;
}

export function summarise(list: readonly FindingVM[]): FindingsSummary {
  const active = list.filter((f) => f.active).length;
  const fresh = list.filter((f) => f.state === "new").length;
  const earlier = list.length - active;
  const text = active === 0
    ? "No open findings from the checks that ran."
    : `${active} open finding${active === 1 ? "" : "s"}${fresh > 0 ? `, ${fresh} new` : ""}.`;
  return { active, fresh, earlier, text };
}

// ── Scheduler state (UX Spec §13.2) ─────────────────────────────────────────

export interface SchedulerNoticeVM {
  readonly key: "paused" | "delayed" | "unavailable";
  readonly title: "Checks paused" | "Check delayed" | "Scheduler unavailable";
  readonly text: string;
  readonly tone: "attention" | "failed";
}

/** null when checks are running normally. Never an all-clear while anything else is true. */
export function schedulerNotice(s: SchedulerStatus | null, now: Date, tz: string, uncertain = false): SchedulerNoticeVM | null {
  if (!s || s.status === "running") return null;
  const t = (iso: string): string => { const d = parseIso(iso); return d ? formatClockWithAge(d, now, tz, uncertain) : "an unknown time"; };
  switch (s.status) {
    case "paused":
      return { key: "paused", title: "Checks paused", tone: "attention", text: `${s.reason} Paused since ${t(s.since)}. Nothing is being checked, so a quiet Overview is not an all-clear. Resume checks to see current facts.` };
    case "delayed":
      return { key: "delayed", title: "Check delayed", tone: "attention", text: `The next check was due ${t(s.dueAt)} and has not run. What you see may be older than it looks. When checking resumes, one current check replaces the missed ones.` };
    case "unavailable":
      return { key: "unavailable", title: "Scheduler unavailable", tone: "failed", text: `${s.reason} No scheduled checks are running. What you see is the last data received, not a current check.` };
  }
}

/**
 * Scheduler state that can be derived from what /api/fleet really says: a
 * next check that is overdue. Paused and unavailable need the findings API
 * and are not guessed here.
 */
export const OVERDUE_GRACE_MS = 2 * 60_000;

export function schedulerFromFleet(fleet: Pick<FleetResponse, "nextCheckAt"> | null, now: Date): SchedulerStatus | null {
  const due = parseIso(fleet?.nextCheckAt);
  if (!due) return null;
  return now.getTime() - due.getTime() > OVERDUE_GRACE_MS ? { status: "delayed", dueAt: due.toISOString() } : { status: "running", nextRunAt: due.toISOString() };
}


