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

export type ServerEmblemVariant = "lilac" | "citron" | "tangerine" | "bubblegum";

/**
 * Where a server card's data comes from (T-040). Shown as a per-card badge.
 * "fixture" = synthetic data in this file; "live" = an authenticated API
 * observation. Everything is "fixture" until the API is wired.
 */
export type DataSource = "fixture" | "live";

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
  | "working"     // Operation currently running
  /**
   * Host key not yet verified by the owner, so ServrSit has NOT contacted the
   * server at all (T-040). Distinct from "unreachable": there is no historical
   * result, no failed attempt — just an owner action outstanding.
   */
  | "unverified-host";

export interface ServerFixture {
  id: string;
  name: string;
  /** Data source for this card; drives the FIXTURE / LIVE badge. */
  source: DataSource;
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
  primaryAction: "view" | "review-updates" | "check-connection" | "verify-host";
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
  lastObservedAt: "2026-11-15T09:39:00+07:00",
  serversChecked: 3,
  nextCheckAt: "2026-11-15T09:54:00+07:00",
  nextCheckRelative: "in 12 minutes",

  // ── Servers ──────────────────────────────────────────────────────────────
  servers: [
    {
      // Timika — fresh, all checks passed
      id: "srv_timika_fixture",
      source: "fixture",
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
      source: "fixture",
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
      source: "fixture",
      name: "Sentani",
      role: "Build machine",
      isProduction: false,
      emblemVariant: "tangerine",
      cardState: "unreachable",
      statusLabel: "Unreachable from ServrSit",
      statusSemanticKey: "unknown",
      primaryFinding: "Disk at 71% · 6 services running",
      lastHealthCheckAt: "2026-11-15T07:41:00+07:00",
      lastHealthCheckRelative: "2 hours ago",
      isFresh: false,
      primaryAction: "check-connection",
      primaryActionLabel: "Check connection",
      primaryActionHref: "/servers/srv_sentani_fixture",
    },
    {
      // Merauke — fresh, non-production dev host (T-040)
      id: "srv_merauke_fixture",
      source: "fixture",
      name: "Merauke",
      role: "Dev host",
      isProduction: false,
      emblemVariant: "bubblegum",
      cardState: "fresh",
      statusLabel: "All checks passed",
      statusSemanticKey: "passed",
      primaryFinding: "No pending updates · 3 services healthy",
      lastHealthCheckAt: "2026-11-15T09:39:15+07:00",
      lastHealthCheckRelative: "3 minutes ago",
      isFresh: true,
      primaryAction: "view",
      primaryActionLabel: "View server",
      primaryActionHref: "/servers/srv_merauke_fixture",
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

/**
 * [FIXTURE DATA] Example of the "unverified-host" state (T-040), not rendered
 * on the Overview (the brief keeps 4 cards). To preview it, replace one entry
 * in overviewFixture.data.servers with this object.
 * No timestamps: the server has never been contacted.
 */
export const unverifiedHostExample: ServerFixture = {
  id: "srv_wamena_fixture",
  source: "fixture",
  name: "Wamena",
  role: "New server",
  isProduction: false,
  emblemVariant: "lilac",
  cardState: "unverified-host",
  statusLabel: "Host key not verified",
  statusSemanticKey: "attention",
  primaryFinding: "Not contacted: host key not verified yet",
  lastHealthCheckAt: null,
  lastHealthCheckRelative: "never",
  isFresh: false,
  primaryAction: "verify-host",
  primaryActionLabel: "Verify host key",
  primaryActionHref: "/servers/srv_wamena_fixture/verify",
};
