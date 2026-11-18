/**
 * [FIXTURE DATA] Findings and scheduler client (T-070, moved here by T-080).
 * Implements the real FindingsClient interface (api/findings.ts) over an
 * in-memory model of synthetic servers. Used only by /fixtures/findings.
 * The real /findings screen uses createFindingsClient and never imports this.
 */
import type { FindingRecord, FindingsClient, FindingsResponse, FindingsResult, SchedulerStatus } from "../api/findings";
import { SNOOZE_MS } from "@servrsit/contracts";
import { gate } from "../lib/fixtureState";

export type FixtureScheduler = SchedulerStatus["status"];

// ── in-memory model ────────────────────────────────────────────��───

export function createFixtureFindingsClient(
  now: () => Date = () => new Date(),
  scheduler: () => FixtureScheduler = () => "running",
  onScheduler: (next: FixtureScheduler) => void = () => undefined,
): FindingsClient {
  const t = (minAgo: number): string => new Date(now().getTime() - minAgo * 60_000).toISOString();
  const base = { acknowledgedAt: null, snoozedUntil: null, resolvedAt: null, resolvedBy: null } as const;
  const records = new Map<string, FindingRecord>(
    ([
      { ...base, id: "f1", key: "disk:/", serverId: "s-timika", serverName: "Fixture Timika", production: true, rule: "disk.usage.v1", severity: "critical", summary: "Disk space on / is at 96 %", state: "new", firstObservedAt: t(3 * 24 * 60), lastObservedAt: t(4) },
      { ...base, id: "f2", key: "clock.skew", serverId: "s-timika", serverName: "Fixture Timika", production: true, rule: "clock.skew.v1", severity: "warning", summary: "This server's clock is about 7 h behind ServrSit's clock", state: "new", firstObservedAt: t(26 * 60), lastObservedAt: t(4) },
      { ...base, id: "f3", key: "updates.pending", serverId: "s-nabire", serverName: "Fixture Nabire", production: false, rule: "updates.pending.v1", severity: "warning", summary: "12 package updates are waiting", state: "acknowledged", acknowledgedAt: t(90), firstObservedAt: t(5 * 24 * 60), lastObservedAt: t(9) },
      { ...base, id: "f4", key: "reboot.required", serverId: "s-sentani", serverName: "Fixture Sentani", production: false, rule: "reboot.required.v1", severity: "advisory", summary: "A reboot is needed to finish earlier updates", state: "snoozed", snoozedUntil: t(-26 * 60), firstObservedAt: t(2 * 24 * 60), lastObservedAt: t(9) },
      { ...base, id: "f5", key: "memory.pressure", serverId: "s-nabire", serverName: "Fixture Nabire", production: false, rule: "memory.pressure.v1", severity: "warning", summary: "Memory was above 90 % for three samples", state: "resolved", resolvedAt: t(120), resolvedBy: "The check at 09:15 found memory at 61 %, below the 90 % threshold.", firstObservedAt: t(8 * 60), lastObservedAt: t(130) },
      { ...base, id: "f6", key: "disk:/srv", serverId: "s-merauke", serverName: "Fixture Merauke", production: false, rule: "disk.usage.v1", severity: "warning", summary: "Disk space on /srv was at 88 % when last checked", state: "not-rechecked", firstObservedAt: t(4 * 24 * 60), lastObservedAt: t(52) },
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
    async list() {
      await wait();
      return gate<FindingsResult<FindingsResponse>>(
        () => ({ ok: true, data: { mode: "fixture", findings: [...records.values()], scheduler: sched(), externalAlerts: { available: false, reason: "External alerts such as email are not available in this stage." } } }),
        () => ({ ok: false, error: "NETWORK" }),
      );
    },
    async scheduler() { await wait(); return { ok: true, data: sched() }; },
    async pause() { await wait(); onScheduler("paused"); return { ok: true, data: { status: "paused", since: now().toISOString(), reason: "You paused checks." } }; },
    async resume() { await wait(); onScheduler("running"); return { ok: true, data: { status: "running", nextRunAt: new Date(now().getTime() + 11 * 60_000).toISOString() } }; },
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
