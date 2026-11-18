/**
 * Finding tracker (T-076, PRD FR-20). Turns each fleet snapshot into durable
 * finding records.
 *
 *  - A detection updates the open record for (server, finding key).
 *  - A finding is resolved only when a successful check covered the issue
 *    and did not show it. The record says which check (`resolvedBy`).
 *  - When the server's checks are not running, or the covering check was
 *    unavailable, the record becomes "not-rechecked". Missing evidence is
 *    never treated as recovery.
 *  - A rule this tracker does not know is never resolved automatically.
 */

import { randomUUID } from "node:crypto";
import type { FindingRecord, FindingState, FleetResponse } from "@servrsit/contracts";
import type { CheckName } from "@servrsit/ssh";
import type { SqliteFindingStore, StoredFinding } from "@servrsit/store";

/**
 * What evidence each rule depends on:
 *  - a check name: a successful, fresh observation in which that check ran
 *  - "observation": any successful, fresh observation
 *  - "attempt": the latest connection attempt (unreachable, host key)
 *  - "controller": ServrSit's own state (its clock), re-evaluated on every pass
 */
type Evidence = CheckName | "observation" | "attempt" | "controller";

export const RULE_EVIDENCE: Readonly<Record<string, Evidence>> = {
  "disk.usage.v1": "filesystems",
  "inode.usage.v1": "inodes",
  "time.skew.v1": "clock",
  "systemd.failed-unit.v1": "failedUnits",
  "packages.pending.v1": "pendingPackages",
  "packages.reboot-required.v1": "rebootRequired",
  "identity.duplicate.v1": "observation",
  "connection.unreachable.v1": "attempt",
  "host.key-changed.v1": "attempt",
  "control.clock.v1": "controller",
};

/** How long resolved records stay in the list. */
export const RESOLVED_VISIBLE_MS = 7 * 86_400_000;

export interface FindingTrackerOptions {
  readonly store: SqliteFindingStore;
  readonly fleet: () => FleetResponse;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
}

export function stateOf(f: StoredFinding, now: Date): FindingState {
  if (f.resolvedAt !== null) return "resolved";
  if (f.notRecheckedSince !== null) return "not-rechecked";
  if (f.snoozedUntil !== null && new Date(f.snoozedUntil).getTime() > now.getTime()) return "snoozed";
  if (f.acknowledgedAt !== null) return "acknowledged";
  return "new";
}

export class FindingTracker {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly o: FindingTrackerOptions) {
    this.now = o.now ?? (() => new Date());
    this.newId = o.newId ?? (() => randomUUID());
  }

  /** Record what the latest snapshot shows. Safe to call as often as needed. */
  sync(snapshot: FleetResponse = this.o.fleet()): void {
    const now = this.now().toISOString();
    for (const s of snapshot.servers) {
      const attemptOk = s.latestAttempt?.succeeded === true;
      const checksOk = attemptOk && s.observedAt !== null && s.status !== "stale";
      const attemptAt = s.latestAttempt?.at ?? now;
      const observedAt = s.observedAt ?? attemptAt;
      const unavailable = new Set((s.coverage?.unavailable ?? []).map((u) => u.check));
      const present = new Set<string>();

      for (const f of s.findings) {
        present.add(f.id);
        const evidence = RULE_EVIDENCE[f.rule];
        const fromAttempt = evidence === "attempt" || evidence === "controller";
        this.o.store.observe(
          s.id,
          { key: f.id, rule: f.rule, severity: f.severity, summary: f.summary },
          fromAttempt ? attemptAt : observedAt,
          fromAttempt || checksOk,
          this.newId,
        );
      }

      for (const r of this.o.store.listOpen(s.id)) {
        if (present.has(r.key)) continue;
        const evidence = RULE_EVIDENCE[r.rule];
        let by: string | null = null;
        if (evidence === "controller") {
          by = `ServrSit's own clock check at ${now} no longer showed this.`;
        } else if (evidence === "attempt") {
          if (attemptOk) by = `The check at ${attemptAt} reached and identified the server.`;
        } else if (evidence !== undefined && checksOk && observedAt >= r.lastObservedAt) {
          if (evidence === "observation" || !unavailable.has(evidence)) by = `The check at ${observedAt} covered this and no longer showed it.`;
        }
        if (by !== null) this.o.store.resolve(r.id, evidence === "attempt" ? attemptAt : evidence === "controller" ? now : observedAt, by);
        else this.o.store.markNotRechecked(r.id, now);
      }
    }
  }

  /** Open records and recently resolved ones, for servers still in the fleet. */
  list(snapshot: FleetResponse = this.o.fleet()): FindingRecord[] {
    this.sync(snapshot);
    const now = this.now();
    const servers = new Map(snapshot.servers.map((s) => [s.id, s]));
    const since = new Date(now.getTime() - RESOLVED_VISIBLE_MS).toISOString();
    const out: FindingRecord[] = [];
    for (const f of this.o.store.list(since)) {
      const s = servers.get(f.serverId);
      if (s !== undefined) out.push(this.view(f, s.name, s.production, now));
    }
    return out;
  }

  view(f: StoredFinding, serverName: string, production: boolean, now: Date = this.now()): FindingRecord {
    return {
      id: f.id,
      serverId: f.serverId,
      serverName,
      production,
      key: f.key,
      rule: f.rule,
      severity: f.severity,
      summary: f.summary,
      state: stateOf(f, now),
      firstObservedAt: f.firstObservedAt,
      lastObservedAt: f.lastObservedAt,
      acknowledgedAt: f.acknowledgedAt,
      snoozedUntil: f.snoozedUntil,
      resolvedAt: f.resolvedAt,
      resolvedBy: f.resolvedBy,
    };
  }
}
