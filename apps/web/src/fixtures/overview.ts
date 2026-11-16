/**
 * [FIXTURE DATA] — Overview screen fixture
 *
 * Synthetic data for the Overview screen (UX-04).
 * All server names, states, findings, and timestamps are illustrative.
 * None of this represents a real observation of Sentani, Nabire, or Timika.
 *
 * This fixture must carry a [FIXTURE DATA] label wherever it is rendered.
 * The FixtureData<T> wrapper enforces this at the type level.
 * Remove only when replaced by an authenticated API response.
 */

import { asFixture, type FixtureData } from "@servrsit/ui";
import type { OperationState } from "@servrsit/contracts";

// ---------------------------------------------------------------------------
// Server state types (web-local — full types come from T-007/T-023 API work)
// ---------------------------------------------------------------------------

export type ServerEmblemVariant = "lilac" | "citron" | "tangerine";

/** Observation-derived status for a single check category. */
export type CheckStatus =
  | "passed"
  | "attention"
  | "failed"
  | "unknown"
  | "progress";

/** The combined display state of a server card. */
export type ServerCardState =
  | "fresh"       // All expected checks fresh and passed
  | "attention"   // Fresh issue detected
  | "unreachable" // Latest connection attempt failed
  | "stale"       // Checks overdue / stale
  | "working";    // Operation currently running

export interface ServerFixture {
  id: string;
  name: string;
  /** Short role descriptor: "Database", "Web server", "Build machine", etc. */
  role: string;
  /** Whether this server is classified as production. */
  isProduction: boolean;
  /** Stable identity emblem color — represents identity, never health. */
  emblemVariant: ServerEmblemVariant;
  /** Derived card display state from latest observation. */
  cardState: ServerCardState;
  /** Primary status text shown below the server name. */
  statusLabel: string;
  /** Semantic state key matching the CSS token pairs. */
  statusSemanticKey: CheckStatus;
  /**
   * Most useful single finding or checked result to surface on the card.
   * UX Spec §8.2: "one most useful finding or checked result"
   */
  primaryFinding: string;
  /**
   * ISO-8601 timestamp of last successful health check.
   * null when never successfully checked.
   */
  lastHealthCheckAt: string | null;
  /** Human-readable relative time for display (pre-computed for fixture). */
  lastHealthCheckRelative: string;
  /**
   * Whether the last check is still within freshness window.
   * UX Spec §8: freshness rules.
   */
  isFresh: boolean;
  /**
   * Primary action for this card's current state.
   * UX Spec §8.2: "View server / Review updates / Check connection"
   */
  primaryAction: "view" | "review-updates" | "check-connection";
  /** Label for the primary action button. */
  primaryActionLabel: string;
  /** Route path for the primary action link. */
  primaryActionHref: string;
}

export interface FindingFixture {
  id: string;
  serverId: string;
  serverName: string;
  /** Severity determines which semantic state color is used. */
  severity: "attention" | "failed";
  title: string;
  detail: string;
  /** ISO-8601 timestamp of when this finding was first observed. */
  firstObservedAt: string;
  /** Human-readable relative time. */
  firstObservedRelative: string;
}

export interface RecentOperationFixture {
  id: string;
  serverId: string;
  serverName: string;
  title: string;
  state: OperationState;
  /** Human-readable state label matching UX Spec §11 table. */
  stateLabel: string;
  /** ISO-8601 timestamp of completion. */
  completedAt: string;
  /** Human-readable relative time. */
  completedRelative: string;
  /** Short summary of what changed. */
  changeSummary: string;
}

export interface OverviewFixture {
  /**
   * Briefing headline text.
   * UX Spec §8.1: "Two things need a look." pattern.
   */
  briefingHeadline: string;
  /** Subtitle below the headline with coverage and freshness. */
  briefingSubtitle: string;
  /** ISO-8601 timestamp of most recent fleet observation. */
  lastObservedAt: string;
  /** Number of servers checked in this observation. */
  serversChecked: number;
  servers: ServerFixture[];
  findings: FindingFixture[];
  recentOperations: RecentOperationFixture[];
  /**
   * Next scheduled health check time.
   * UX Spec §5.2: "next scheduled check" shown in briefing column.
   */
  nextCheckAt: string;
  nextCheckRelative: string;
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------
//
// Timestamps use 2026-11-15 as the reference date to make it obvious these
// are synthetic. Times are realistic for a small VPS fleet.

const FIXTURE_NOW = "2026-11-15T09:42:00+07:00"; // Asia/Jakarta, morning

export const overviewFixture: FixtureData<OverviewFixture> = asFixture({
  briefingHeadline: "Two things need a look.",
  briefingSubtitle: "3 servers · 2 checked 3 minutes ago · 1 unreachable",
  lastObservedAt: "2026-11-15T09:39:00+07:00",
  serversChecked: 2,
  nextCheckAt: "2026-11-15T09:54:00+07:00",
  nextCheckRelative: "in 12 minutes",

  // ── Servers ──────────────────────────────────────────────────────────────
  servers: [
    {
      // Timika — fresh, all checks passed
      id: "srv_timika_fixture",
      name: "Timika",
      role: "Web server",
      isProduction: true,
      emblemVariant: "citron",
      cardState: "fresh",
      statusLabel: "All checks passed",
      statusSemanticKey: "passed",
      primaryFinding: "No pending updates · 4 services healthy",
      lastHealthCheckAt: "2026-11-15T09:39:12+07:00",
      lastHealthCheckRelative: "3 minutes ago",
      isFresh: true,
      primaryAction: "view",
      primaryActionLabel: "View server",
      primaryActionHref: "/servers/srv_timika_fixture",
    },
    {
      // Nabire — needs attention, pending package updates
      id: "srv_nabire_fixture",
      name: "Nabire",
      role: "Database server",
      isProduction: true,
      emblemVariant: "lilac",
      cardState: "attention",
      statusLabel: "Needs attention",
      statusSemanticKey: "attention",
      primaryFinding: "7 packages can be updated · 1 security patch",
      lastHealthCheckAt: "2026-11-15T09:39:08+07:00",
      lastHealthCheckRelative: "3 minutes ago",
      isFresh: true,
      primaryAction: "review-updates",
      primaryActionLabel: "Review updates",
      primaryActionHref: "/servers/srv_nabire_fixture/care",
    },
    {
      // Sentani — unreachable, checks stale
      id: "srv_sentani_fixture",
      name: "Sentani",
      role: "Build machine",
      isProduction: false,
      emblemVariant: "tangerine",
      cardState: "unreachable",
      statusLabel: "Unreachable from ServrSit",
      statusSemanticKey: "unknown",
      primaryFinding: "Last successful check 2 hours ago — disk at 71%",
      lastHealthCheckAt: "2026-11-15T07:41:00+07:00",
      lastHealthCheckRelative: "2 hours ago",
      isFresh: false,
      primaryAction: "check-connection",
      primaryActionLabel: "Check connection",
      primaryActionHref: "/servers/srv_sentani_fixture",
    },
  ],

  // ── Findings ─────────────────────────────────────────────────────────────
  findings: [
    {
      id: "finding_nabire_updates_fixture",
      serverId: "srv_nabire_fixture",
      serverName: "Nabire",
      severity: "attention",
      title: "7 packages can be updated",
      detail: "Includes 1 security patch for openssh-server (9.6p1-3ubuntu13.3).",
      firstObservedAt: "2026-11-15T09:39:08+07:00",
      firstObservedRelative: "3 minutes ago",
    },
    {
      id: "finding_sentani_unreachable_fixture",
      serverId: "srv_sentani_fixture",
      serverName: "Sentani",
      severity: "attention",
      title: "Sentani is unreachable",
      detail: "Connection failed at 07:54. Last result was 2 hours ago.",
      firstObservedAt: "2026-11-15T07:54:00+07:00",
      firstObservedRelative: "1 hour 48 minutes ago",
    },
  ],

  // ── Recent operations ─────────────────────────────────────────────────────
  recentOperations: [
    {
      id: "op_timika_updates_fixture",
      serverId: "srv_timika_fixture",
      serverName: "Timika",
      title: "Updated 3 packages on Timika",
      state: "succeeded",
      stateLabel: "Completed and verified",
      completedAt: "2026-11-14T22:17:00+07:00",
      completedRelative: "Yesterday at 22:17",
      changeSummary: "curl 8.5.0-2ubuntu10.5, libcurl4 8.5.0-2ubuntu10.5, openssl 3.0.13-0ubuntu3.4",
    },
  ],
});

// Unused but exported to confirm the reference timestamp is in the file
export { FIXTURE_NOW };
