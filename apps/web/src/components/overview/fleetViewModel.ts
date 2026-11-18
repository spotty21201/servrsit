/**
 * fleetViewModel — the ONE place where the /api/fleet model (from
 * @servrsit/contracts, via useFleet) becomes the Overview's view model (T-046).
 *
 * Rules carried here, not in components:
 *   - Never invent data. No observation → "Never observed", not a zero.
 *   - Never show a non-fresh server as healthy. Only status "fresh" with no
 *     warning/critical finding gets the passed badge.
 *   - A failed latest attempt is shown alongside the last success.
 *   - source "none" cards show the API's statusReason as their main line.
 *   - API text (names, roles, statusReason, findings, failure messages) is
 *     untrusted: it is passed through as plain strings and rendered as text.
 */
import type { Finding, FleetServer, FleetStatus } from "@servrsit/contracts";
import type { FleetState } from "../../api/fleetState";
import { formatClock, formatClockWithAge, formatRelative, parseIso, resolveTimeZone } from "../../lib/time";

// ── View-model types ────────────────────────────────────────────────────────

/** Semantic state keys that map to the badge CSS token pairs. */
export type StatusKey = "passed" | "attention" | "failed" | "unknown" | "progress";

/** Identity colors (never health). */
export type IdentityColor = "lilac" | "citron" | "tangerine" | "bubblegum";

export type DataSourceVM = "live" | "fixture" | "none";

/** Drives card-level CSS (border style). */
export type CardTone = "normal" | "uncertain" | "no-data";

export interface ServerCardVM {
  id: string;
  name: string;
  /** Role text, or a neutral placeholder when the API has none. */
  role: string;
  isProduction: boolean;
  identity: IdentityColor;
  source: DataSourceVM;
  tone: CardTone;
  status: FleetStatus;
  statusLabel: string;
  statusKey: StatusKey;
  statusIcon: "lock" | null;
  /** Main line: top finding, package summary, or the API's statusReason. */
  primaryLine: string;
  /** True when primaryLine describes an older observation than "now". */
  historical: boolean;
  observedAt: string | null;
  observedText: string;
  freshUntil: string | null;
  freshUntilText: string | null;
  /** Latest attempt failure, shown next to the last success. */
  latestFailure: { at: string; text: string } | null;
  actionLabel: string;
  actionHref: string;
}

export interface AttentionItemVM {
  id: string;
  serverId: string;
  serverName: string;
  severity: "attention" | "failed";
  title: string;
  detail: string;
  /** ISO time the item relates to, or "" when unknown. */
  firstObservedAt: string;
  firstObservedRelative: string;
}

export interface OverviewVM {
  phase: FleetState["phase"];
  servers: ServerCardVM[];
  attention: AttentionItemVM[];
  /** Show the [FIXTURE DATA] banner only when at least one card is fixture. */
  anyFixture: boolean;
  /** Counts for the header line. */
  counts: { total: number; live: number; fixture: number; none: number };
  /** Owner time zone (IANA) used for every time on the screen. */
  timeZone: string;
  receivedText: string | null;
  nextCheckText: string | null;
  refreshing: boolean;
  /** Latest refresh failure (shown with or without data). */
  error: { message: string } | null;
}

// ── Time helpers ────────────────────────────────────────────────────────────
// All formatting lives in lib/time.ts and uses the owner's time zone.

const parse = parseIso;

// ── Status mapping ──────────────────────────────────────────────────────────

interface StatusPresentation {
  label: string;
  key: StatusKey;
  icon: "lock" | null;
  tone: CardTone;
  action: { label: string; path: "" | "/verify" | "/settings" };
}

/** Every contract status has an explicit presentation. Only "fresh" can be passed. */
const STATUS: Record<FleetStatus, StatusPresentation> = {
  fresh:                 { label: "All checks passed",         key: "passed",    icon: null,   tone: "normal",    action: { label: "View server", path: "" } },
  partial:               { label: "Partially checked",         key: "attention", icon: null,   tone: "uncertain", action: { label: "View server", path: "" } },
  stale:                 { label: "Check overdue",             key: "unknown",   icon: null,   tone: "uncertain", action: { label: "View server", path: "" } },
  unreachable:           { label: "Unreachable from ServrSit", key: "unknown",   icon: null,   tone: "uncertain", action: { label: "Check connection", path: "" } },
  "not-yet-checked":     { label: "Not checked yet",           key: "progress",  icon: null,   tone: "no-data",   action: { label: "View server", path: "" } },
  "unverified-host":     { label: "Host key not verified",     key: "attention", icon: "lock", tone: "no-data",   action: { label: "Verify host key", path: "/verify" } },
  "collection-disabled": { label: "Checks switched off",       key: "unknown",   icon: null,   tone: "no-data",   action: { label: "View settings", path: "/settings" } },
  "access-denied":       { label: "Access denied",             key: "failed",    icon: "lock", tone: "no-data",   action: { label: "Fix access", path: "/settings" } },
  "host-key-changed":    { label: "Host key changed",          key: "failed",    icon: "lock", tone: "no-data",   action: { label: "Review host key", path: "/verify" } },
  misconfigured:         { label: "Configuration rejected",    key: "failed",    icon: null,   tone: "no-data",   action: { label: "View settings", path: "/settings" } },
};

const SEVERITY_RANK: Record<Finding["severity"], number> = { critical: 0, warning: 1, advisory: 2 };

function topFinding(findings: Finding[]): Finding | null {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0] ?? null;
}

/** Fresh servers with a warning/critical finding are not "All checks passed". */
function effectiveStatus(s: FleetServer): StatusPresentation {
  const base = STATUS[s.status];
  if (s.status !== "fresh") return base;
  const top = topFinding(s.findings);
  if (top?.severity === "critical") return { ...base, label: "Critical issue", key: "failed" };
  if (top?.severity === "warning") return { ...base, label: "Needs attention", key: "attention" };
  return base;
}

function packagesLine(s: FleetServer): string | null {
  const pkg = s.observation?.packages.pendingCount;
  if (!pkg) return null;
  if (pkg.status !== "ok") return `Package updates unknown: ${pkg.reason}`;
  if (pkg.value === 0) return "No pending updates";
  return `${pkg.value} package${pkg.value === 1 ? "" : "s"} can be updated`;
}

function primaryLine(s: FleetServer): string {
  // No observation to describe: the API's reason is the most useful line.
  if (s.source === "none" || s.observation === null) return s.statusReason;
  const top = topFinding(s.findings);
  if (top && top.severity !== "advisory") return top.summary;
  if (s.status === "partial" && s.coverage) {
    return `${s.coverage.passed} of ${s.coverage.total} checks ran`;
  }
  // Light cheek only for routine good news: fresh, no findings, nothing pending.
  if (s.status === "fresh" && s.observation.packages.pendingCount.status === "ok" && s.observation.packages.pendingCount.value === 0) {
    return "No pending updates. Nothing to babysit.";
  }
  return packagesLine(s) ?? s.statusReason;
}

/**
 * Identity color: the API has no stable identity field yet, so this uses the
 * server's position in the API response. FLAGGED for Coder/Orchestrator: the
 * UX Spec wants identity assigned at registration and stable through renames.
 */
const IDENTITY_ORDER: IdentityColor[] = ["tangerine", "lilac", "citron", "bubblegum"];

function toCard(s: FleetServer, index: number, now: Date, tz: string, u: boolean): ServerCardVM {
  const p = effectiveStatus(s);
  const observed = parse(s.observedAt);
  const freshUntil = parse(s.freshUntil);
  const attempt = s.latestAttempt;
  const attemptAt = parse(attempt?.at);

  let latestFailure: ServerCardVM["latestFailure"] = null;
  if (attempt && !attempt.succeeded && attemptAt) {
    const times = attempt.consecutiveFailures > 1 ? ` (${attempt.consecutiveFailures} in a row)` : "";
    const why = attempt.failure?.message ?? "No reason given";
    latestFailure = {
      at: attempt.at,
      text: `Latest check failed ${formatRelative(attemptAt, now, tz, u)}${times}: ${why}`,
    };
  }

  let freshUntilText: string | null = null;
  if (freshUntil) {
    freshUntilText =
      freshUntil.getTime() >= now.getTime()
        ? `fresh until ${formatClock(freshUntil, now, tz)}`
        : `expired ${formatClock(freshUntil, now, tz)}`;
  }

  return {
    id: s.id,
    name: s.name,
    role: s.role ?? "No role set",
    isProduction: s.production,
    identity: IDENTITY_ORDER[index % IDENTITY_ORDER.length] ?? "lilac",
    source: s.source,
    tone: p.tone,
    status: s.status,
    statusLabel: p.label,
    statusKey: p.key,
    statusIcon: p.icon,
    primaryLine: primaryLine(s),
    historical: observed !== null && s.status !== "fresh" && s.status !== "partial",
    observedAt: s.observedAt,
    observedText: observed ? `Observed ${formatRelative(observed, now, tz, u)}` : "Never observed",
    freshUntil: s.freshUntil,
    freshUntilText,
    latestFailure,
    actionLabel: p.action.label,
    actionHref: `/servers/${encodeURIComponent(s.id)}${p.action.path}`,
  };
}

/** Status-derived attention rows (things the owner must act on or know). */
const ATTENTION_STATUSES: ReadonlySet<FleetStatus> = new Set<FleetStatus>([
  "unreachable",
  "stale",
  "partial",
  "unverified-host",
  "access-denied",
  "host-key-changed",
  "misconfigured",
]);

function toAttention(s: FleetServer, now: Date, tz: string, u: boolean): AttentionItemVM[] {
  const items: AttentionItemVM[] = [];
  const p = STATUS[s.status];
  const refIso = s.latestAttempt?.at ?? s.observedAt ?? "";
  const ref = parse(refIso);

  if (ATTENTION_STATUSES.has(s.status)) {
    items.push({
      id: `${s.id}:status:${s.status}`,
      serverId: s.id,
      serverName: s.name,
      severity: p.key === "failed" ? "failed" : "attention",
      title: p.label,
      detail: s.statusReason,
      firstObservedAt: refIso,
      firstObservedRelative: ref ? formatRelative(ref, now, tz, u) : "",
    });
  }

  // Advisory findings (CPU/memory) stay off the attention list (PRD: advisory only).
  const observed = parse(s.observedAt);
  for (const f of s.findings) {
    if (f.severity === "advisory") continue;
    items.push({
      id: `${s.id}:finding:${f.id}`,
      serverId: s.id,
      serverName: s.name,
      severity: f.severity === "critical" ? "failed" : "attention",
      title: f.summary,
      detail: s.status === "fresh" || s.status === "partial" ? `Rule ${f.rule}` : `Rule ${f.rule} · from an older observation`,
      firstObservedAt: s.observedAt ?? "",
      firstObservedRelative: observed ? formatRelative(observed, now, tz, u) : "",
    });
  }
  return items;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** `agesUncertain`: ServrSit's own clock is untrusted, so relative ages carry "≈". */
export function toOverviewVM(state: FleetState, now: Date, agesUncertain = false): OverviewVM {
  const u = agesUncertain;
  const data = state.data;
  const tz = resolveTimeZone(data?.ownerTimeZone);
  const servers = data ? data.servers.map((s, i) => toCard(s, i, now, tz, u)) : [];
  const attention = data
    ? data.servers
        .flatMap((s) => toAttention(s, now, tz, u))
        .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "failed" ? -1 : 1))
    : [];

  const counts = {
    total: servers.length,
    live: servers.filter((s) => s.source === "live").length,
    fixture: servers.filter((s) => s.source === "fixture").length,
    none: servers.filter((s) => s.source === "none").length,
  };

  const received = parse(state.receivedAt);
  const nextCheck = parse(data?.nextCheckAt);

  return {
    phase: state.phase,
    servers,
    attention,
    anyFixture: counts.fixture > 0,
    counts,
    timeZone: tz,
    receivedText: received ? formatClockWithAge(received, now, tz, u) : null,
    nextCheckText: nextCheck ? formatClock(nextCheck, now, tz) : null,
    refreshing: state.refreshing,
    error: state.error ? { message: state.error.message } : null,
  };
}
