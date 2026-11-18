/**
 * [FIXTURE] STUB client for findings and scheduler state (T-070, PRD FR-20,
 * UX Spec §13.1/§13.2). There is no findings-state contract or endpoint yet:
 * /api/fleet carries each server's current findings (id, rule, severity,
 * summary) but not first/last observed times, acknowledgement, snooze or
 * resolution. These types are local and PROVISIONAL; Coder should propose a
 * contract in packages/contracts and replace this file. Proposed endpoints:
 *
 *   GET  /api/findings                      -> { findings: FindingRecord[], scheduler: SchedulerStatus }
 *   POST /api/findings/:id/acknowledge      -> FindingRecord   (records that the owner has seen it; never resolves it)
 *   POST /api/findings/:id/snooze {for}     -> FindingRecord   (delays notifications only)
 *
 * Rules the API must keep (the UI relies on them): repeated detections of one
 * issue update the same record; acknowledge and snooze never change `state` to
 * resolved; "resolved" is set only by an observation that no longer shows the
 * issue and says which one (`resolvedBy`); a finding on a server whose checks
 * cannot run is "not-rechecked", never "resolved".
 */

export type FindingSeverity = "critical" | "warning" | "advisory";
export type FindingState = "new" | "acknowledged" | "snoozed" | "resolved" | "not-rechecked";
export type SnoozeFor = "1h" | "1d" | "1w";

export const SNOOZE_MS: Readonly<Record<SnoozeFor, number>> = { "1h": 3_600_000, "1d": 86_400_000, "1w": 604_800_000 };

export interface FindingRecord {
  readonly id: string;
  readonly serverId: string;
  readonly serverName: string;
  readonly production: boolean;
  readonly rule: string;
  readonly severity: FindingSeverity;
  readonly summary: string;
  readonly state: FindingState;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly acknowledgedAt: string | null;
  readonly snoozedUntil: string | null;
  readonly resolvedAt: string | null;
  /** Fixed text naming the observation that established recovery. Set only when resolved. */
  readonly resolvedBy: string | null;
}

export type SchedulerStatus =
  | { readonly status: "running"; readonly nextRunAt: string | null }
  | { readonly status: "paused"; readonly since: string; readonly reason: string }
  | { readonly status: "delayed"; readonly dueAt: string }
  | { readonly status: "unavailable"; readonly reason: string };

export interface FindingsSnapshot {
  readonly findings: readonly FindingRecord[];
  readonly scheduler: SchedulerStatus;
}

export type FindingsResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: "NOT_FOUND" | "NOT_ALLOWED" | "NETWORK" };

export interface FindingsClient {
  list(): Promise<FindingsResult<FindingsSnapshot>>;
  acknowledge(id: string): Promise<FindingsResult<FindingRecord>>;
  snooze(id: string, forDuration: SnoozeFor): Promise<FindingsResult<FindingRecord>>;
}

// ── [FIXTURE] in-memory model ────────────────────────────────────────────��───

export type FixtureScheduler = SchedulerStatus["status"];

export function createFixtureFindingsClient(now: () => Date = () => new Date(), scheduler: () => FixtureScheduler = () => "running"): FindingsClient {
  const t = (minAgo: number): string => new Date(now().getTime() - minAgo * 60_000).toISOString();
  const base = { acknowledgedAt: null, snoozedUntil: null, resolvedAt: null, resolvedBy: null } as const;
  const records = new Map<string, FindingRecord>(
    ([
      { ...base, id: "f1", serverId: "s-timika", serverName: "Fixture Timika", production: true, rule: "disk.usage.v1", severity: "critical", summary: "Disk space on / is at 96 %", state: "new", firstObservedAt: t(3 * 24 * 60), lastObservedAt: t(4) },
      { ...base, id: "f2", serverId: "s-timika", serverName: "Fixture Timika", production: true, rule: "clock.skew.v1", severity: "warning", summary: "This server's clock is about 7 h behind ServrSit's clock", state: "new", firstObservedAt: t(26 * 60), lastObservedAt: t(4) },
      { ...base, id: "f3", serverId: "s-nabire", serverName: "Fixture Nabire", production: false, rule: "updates.pending.v1", severity: "warning", summary: "12 package updates are waiting", state: "acknowledged", acknowledgedAt: t(90), firstObservedAt: t(5 * 24 * 60), lastObservedAt: t(9) },
      { ...base, id: "f4", serverId: "s-sentani", serverName: "Fixture Sentani", production: false, rule: "reboot.required.v1", severity: "advisory", summary: "A reboot is needed to finish earlier updates", state: "snoozed", snoozedUntil: t(-26 * 60), firstObservedAt: t(2 * 24 * 60), lastObservedAt: t(9) },
      { ...base, id: "f5", serverId: "s-nabire", serverName: "Fixture Nabire", production: false, rule: "memory.pressure.v1", severity: "warning", summary: "Memory was above 90 % for three samples", state: "resolved", resolvedAt: t(120), resolvedBy: "The check at 09:15 found memory at 61 %, below the 90 % threshold.", firstObservedAt: t(8 * 60), lastObservedAt: t(130) },
      { ...base, id: "f6", serverId: "s-merauke", serverName: "Fixture Merauke", production: false, rule: "disk.usage.v1", severity: "warning", summary: "Disk space on /srv was at 88 % when last checked", state: "not-rechecked", firstObservedAt: t(4 * 24 * 60), lastObservedAt: t(52) },
    ] as const satisfies readonly FindingRecord[]).map((r) => [r.id, r]),
  );
  const wait = (): Promise<void> => new Promise((r) => globalThis.setTimeout(r, 200));
  const sched = (): SchedulerStatus => {
    switch (scheduler()) {
      case "paused": return { status: "paused", since: t(180), reason: "You paused checks." };
      case "delayed": return { status: "delayed", dueAt: t(18) };
      case "unavailable": return { status: "unavailable", reason: "ServrSit could not reach its scheduler." };
      default: return { status: "running", nextRunAt: new Date(now().getTime() + 11 * 60_000).toISOString() };
    }
  };
  return {
    async list() { await wait(); return { ok: true, data: { findings: [...records.values()], scheduler: sched() } }; },
    async acknowledge(id) {
      await wait();
      const r = records.get(id);
      if (!r) return { ok: false, error: "NOT_FOUND" };
      if (r.state === "resolved" || r.state === "not-rechecked") return { ok: false, error: "NOT_ALLOWED" };
      // Acknowledging never resolves: state moves to acknowledged only from new; a snoozed finding stays snoozed.
      const next: FindingRecord = { ...r, acknowledgedAt: now().toISOString(), state: r.state === "new" ? "acknowledged" : r.state };
      records.set(id, next);
      return { ok: true, data: next };
    },
    async snooze(id, forDuration) {
      await wait();
      const r = records.get(id);
      if (!r) return { ok: false, error: "NOT_FOUND" };
      if (r.state === "resolved" || r.state === "not-rechecked") return { ok: false, error: "NOT_ALLOWED" };
      const next: FindingRecord = { ...r, state: "snoozed", snoozedUntil: new Date(now().getTime() + SNOOZE_MS[forDuration]).toISOString() };
      records.set(id, next);
      return { ok: true, data: next };
    },
  };
}
