/**
 * planViewModel — turns the API's plan record (GET /api/plans/:id) into what
 * the Plan review screen shows (UX-07, UX Spec §10). Pure; no React.
 *
 * Rules carried here:
 *   - Action, target and the Production label are always present.
 *   - A plan that is blocked, expired, or changed has NO approve control. The
 *     reason is specific text, and "Refresh plan" is offered.
 *   - writesEnabled=false for a real server arrives as blocker WRITES_DISABLED.
 *     It gets the fixed founder-approved sentence below, never the API text.
 *   - Fixed text is written here. API strings (server name, package names and
 *     versions, blocker messages) are untrusted and rendered as plain text.
 *   - Natural-language assent can never approve; only the authenticated
 *     control can (invariant). Nothing here approves anything.
 */
import type { PackageChange, PlanView, PrepareDirectory } from "../api/stubs/care";
import { formatClock, formatClockWithAge, formatUntil, parseIso } from "../lib/time";

export const WRITES_OFF_TEXT = "Changes are switched off for this server until testing on a disposable server is complete.";

export const ACK_RECOVERY = "recovery-route";
export const ACK_INTERRUPTION = "interruption-risk";

export type DispositionKind = "ready" | "writes-disabled" | "blocked" | "expired" | "changed";

export interface Disposition {
  readonly kind: DispositionKind;
  /** Short title for the notice. */
  readonly title: string;
  /** Specific reason. */
  readonly reason: string;
  readonly canApprove: boolean;
  /** "Refresh plan" is offered when the owner can do something about it. */
  readonly offerRefresh: boolean;
}

export interface PreconditionRow {
  readonly label: string;
  readonly state: "met" | "blocked" | "owner" | "unknown";
  readonly detail: string;
}

export interface Acknowledgement {
  readonly id: string;
  readonly label: string;
}

export interface PlanVM {
  readonly id: string;
  readonly version: number;
  readonly serverName: string;
  readonly serverId: string;
  readonly isProduction: boolean;
  readonly simulated: boolean;
  readonly title: string;
  readonly packages: readonly PackageChange[];
  /** Directories a setup plan would create; empty for a package update. */
  readonly directories: readonly PrepareDirectory[];
  /** Setup plan only: items deliberately left alone, with the reason. */
  readonly leftAlone: readonly { readonly label: string; readonly reason: string }[];
  readonly scopeSummary: string;
  readonly exclusions: readonly string[];
  readonly impact: readonly string[];
  readonly preconditions: readonly PreconditionRow[];
  readonly verifyChecks: readonly string[];
  readonly verifyCannot: readonly string[];
  readonly expiry: { readonly absolute: string; readonly relative: string; readonly expired: boolean };
  readonly createdText: string;
  readonly approveLabel: string;
  readonly acknowledgements: readonly Acknowledgement[];
  /** Everything sent to the API as `acknowledgements` once every checkbox is ticked. */
  readonly acknowledgementTokens: readonly string[];
  readonly blockers: readonly { readonly code: string; readonly message: string }[];
  readonly disposition: Disposition;
  readonly digest: string;
  readonly digestShort: string;
}

/** An approval attempt the API refused, or a refresh that changed the plan. */
export type PlanNotice =
  | { readonly code: "PLAN_CHANGED" | "PLAN_EXPIRED" | "PLAN_BLOCKED" | "WRITES_DISABLED" | "TARGET_BUSY" | "OUTCOME_UNKNOWN" | "ALREADY_APPROVED" | "PLAN_NOT_FOUND" }
  | { readonly code: "ACK_REQUIRED" | "CSRF_INVALID" | "OTHER" };

/** Codes after which approving the shown plan must stay disabled until it is refreshed. */
const DISABLING = new Set<PlanNotice["code"]>([
  "PLAN_CHANGED", "PLAN_EXPIRED", "PLAN_BLOCKED", "WRITES_DISABLED", "TARGET_BUSY", "OUTCOME_UNKNOWN", "ALREADY_APPROVED", "PLAN_NOT_FOUND",
]);

export function noticeDisables(notice: PlanNotice | null): boolean {
  return notice !== null && DISABLING.has(notice.code);
}

export function noticeText(notice: PlanNotice, serverName: string): { title: string; reason: string } {
  switch (notice.code) {
    case "PLAN_CHANGED":
      return { title: "This plan changed", reason: "The plan changed after you opened it. Your approval and acknowledgements did not carry over. Refresh plan to review the new version." };
    case "PLAN_EXPIRED":
      return { title: "This plan expired", reason: "Plans are valid for 15 minutes and this one ran out before approval. Nothing was started. Refresh plan to get a new one." };
    case "PLAN_BLOCKED":
      return { title: "Approval is blocked", reason: "The plan has a blocker, so it cannot be approved. The blockers are listed on this page." };
    case "WRITES_DISABLED":
      return { title: "Changes are switched off", reason: WRITES_OFF_TEXT };
    case "TARGET_BUSY":
      return { title: "Another operation is unfinished", reason: `Another operation on ${serverName} has not finished. Nothing was started.` };
    case "OUTCOME_UNKNOWN":
      return { title: "An earlier result is not confirmed", reason: `The result of an earlier operation on ${serverName} is not confirmed, so new changes are unavailable until it is. Nothing was started.` };
    case "ALREADY_APPROVED":
      return { title: "Already approved", reason: "This plan version was already approved, so approving it again was refused. Refresh plan to see the current state." };
    case "PLAN_NOT_FOUND":
      return { title: "Plan not found", reason: "This plan no longer exists. Nothing was started." };
    case "ACK_REQUIRED":
      return { title: "Acknowledgements required", reason: "Both production acknowledgements must be ticked before approving. Nothing was started." };
    case "CSRF_INVALID":
      return { title: "Session check failed", reason: "The page's security token was refused. Nothing was started. Try again." };
    case "OTHER":
      return { title: "Approval was not accepted", reason: "The ServrSit API did not accept the approval. Nothing was started." };
  }
}

const BLOCKER_FIXED: Readonly<Record<string, string>> = {
  TARGET_BUSY: "Another operation on this server has not finished.",
  OUTCOME_UNKNOWN: "The result of a previous operation on this server is not confirmed. It must be reconciled first.",
  PLAN_UNAVAILABLE: "No package transaction could be prepared for this server.",
  NO_CHANGES: "There are no package updates to apply.",
  PACKAGE_REMOVAL_UNSUPPORTED: "The update would remove packages, which is not supported.",
  DOWNGRADE_UNSUPPORTED: "The update would downgrade packages, which is not supported.",
  HELD_PACKAGE: "The update involves held packages. Holds are never overridden.",
  PACKAGE_LOCKED: "The package manager is in use by another process.",
};

function blockerText(b: { code: string; message: string }): string {
  if (b.code === "WRITES_DISABLED") return WRITES_OFF_TEXT;
  return BLOCKER_FIXED[b.code] ?? "This plan has a blocker.";
}

export function approveLabelFor(serverName: string): string {
  return `Approve update on ${serverName}`;
}

export function approveSetupLabelFor(serverName: string): string {
  return `Approve setup of ${serverName}`;
}

const PREPARE_EXCLUSIONS = [
  "Not copied from the reference: credentials, SSH host keys, application data, databases, personal files and network settings.",
  "No existing directory is changed, and nothing is changed recursively.",
  "No service restarts. No reboot.",
] as const;

export const CLOCK_PAUSED_REASON = "ServrSit's own clock is wrong, so expiry times can't be trusted. Approvals are paused until it is fixed.";

/**
 * `clockPaused`: ServrSit's clock is untrusted. Approval is disabled here as
 * well as in the API; relative ages and expiry are marked "≈".
 */
export function toPlanVM(plan: PlanView, now: Date, tz: string, notice: PlanNotice | null = null, clockPaused = false): PlanVM {
  const name = plan.target.name;
  const expires = parseIso(plan.expiresAt);
  const created = parseIso(plan.createdAt);
  const expired = expires !== null && expires.getTime() <= now.getTime();
  const codes = new Set(plan.blockers.map((b) => b.code));
  const blockers = plan.blockers.map((b) => ({ code: b.code, message: blockerText(b) }));
  const n = plan.scope.packages.length;
  const hasPreview = plan.preconditions.previewDigest !== "none";
  const prep = plan.prepare ?? null;

  const preconditions: PreconditionRow[] = [
    created && hasPreview
      ? { label: "Package state is recent", state: "met", detail: `Read ${formatClockWithAge(created, now, tz, clockPaused)}.` }
      : { label: "Package state is recent", state: "unknown", detail: "No package preview was taken for this plan." },
    codes.has("WRITES_DISABLED")
      ? { label: "Changes switched on for this server", state: "blocked", detail: WRITES_OFF_TEXT }
      : { label: "Changes switched on for this server", state: "met", detail: "Writes are enabled for this server." },
    codes.has("TARGET_BUSY") || codes.has("OUTCOME_UNKNOWN")
      ? { label: "No unfinished operation on this server", state: "blocked", detail: codes.has("OUTCOME_UNKNOWN") ? BLOCKER_FIXED["OUTCOME_UNKNOWN"] ?? "" : BLOCKER_FIXED["TARGET_BUSY"] ?? "" }
      : { label: "No unfinished operation on this server", state: "met", detail: "ServrSit has no unfinished operation recorded for it." },
  ];
  const txCodes = ["PLAN_UNAVAILABLE", "NO_CHANGES", "PACKAGE_REMOVAL_UNSUPPORTED", "DOWNGRADE_UNSUPPORTED", "HELD_PACKAGE", "PACKAGE_LOCKED"];
  for (const c of txCodes) {
    if (codes.has(c)) preconditions.push({ label: "Package transaction can be applied", state: "blocked", detail: BLOCKER_FIXED[c] ?? "" });
  }
  if (plan.production && plan.blockers.length === 0) {
    preconditions.push({ label: "Recovery route for a production server", state: "owner", detail: "Confirmed by you below, before approving. ServrSit does not verify it." });
  }

  const production = plan.production;
  const acknowledgements: Acknowledgement[] = production
    ? [
        { id: ACK_RECOVERY, label: `I have a way to recover ${name} if this goes wrong, such as console access or a provider snapshot.` },
        { id: ACK_INTERRUPTION, label: `I understand that package updates can interrupt services running on ${name}.` },
      ]
    : [];

  // Disposition priority: writes off, other blockers, expired, changed notice.
  let disposition: Disposition;
  if (codes.has("WRITES_DISABLED")) {
    disposition = { kind: "writes-disabled", title: "Changes are switched off", reason: WRITES_OFF_TEXT, canApprove: false, offerRefresh: true };
  } else if (plan.blockers.length > 0 || !plan.approvable) {
    const first = blockers[0]?.message ?? "This plan has a blocker.";
    disposition = { kind: "blocked", title: "This plan can't be approved", reason: first, canApprove: false, offerRefresh: true };
  } else if (clockPaused) {
    disposition = { kind: "blocked", title: "Approvals are paused", reason: CLOCK_PAUSED_REASON, canApprove: false, offerRefresh: false };
  } else if (expired) {
    const t = noticeText({ code: "PLAN_EXPIRED" }, name);
    disposition = { kind: "expired", ...t, canApprove: false, offerRefresh: true };
  } else if (notice && noticeDisables(notice)) {
    const t = noticeText(notice, name);
    disposition = { kind: "changed", ...t, canApprove: false, offerRefresh: true };
  } else {
    disposition = { kind: "ready", title: "Ready to review", reason: "Review the scope and impact, then approve.", canApprove: true, offerRefresh: false };
  }

  return {
    id: plan.id,
    version: plan.version,
    serverName: name,
    serverId: plan.target.serverId,
    isProduction: production,
    simulated: plan.target.simulated,
    title: prep ? `Prepare ${name} from ${prep.baselineName}` : `Update packages on ${name}`,
    packages: plan.scope.packages,
    directories: prep?.directories ?? [],
    leftAlone: prep?.leftAlone ?? [],
    scopeSummary: prep
      ? n + prep.directories.length === 0
        ? "Nothing to create or install: this server already matches the baseline."
        : `${prep.directories.length} director${prep.directories.length === 1 ? "y" : "ies"} to create and ${n} package${n === 1 ? "" : "s"} to install, from ${prep.baselineName} version ${prep.baselineVersion} (reference: ${prep.referenceName}), plan version ${plan.version}.`
      : n === 0 ? "No package changes were prepared." : `${n} package update${n === 1 ? "" : "s"}, plan version ${plan.version}.`,
    exclusions: prep ? [...PREPARE_EXCLUSIONS] : ["No service restarts.", "No reboot.", "No package removals."],
    impact: prep
      ? [
          "Creating directories is routine. Installing a package can briefly interrupt a service that uses it, and ServrSit cannot tell in advance which ones.",
          "Existing directories and their contents are left exactly as they are. Where the server conflicts with the baseline, that item is listed as left alone.",
          "This plan restarts no services and does not reboot.",
        ]
      : [
          "Updating a package can briefly interrupt a service that uses it. ServrSit cannot tell in advance which ones.",
          "This plan restarts no services and does not reboot. A reboot may still be needed afterward; that would be a separate plan and approval.",
        ],
    preconditions,
    verifyChecks: prep
      ? n + prep.directories.length === 0
        ? ["Nothing will be checked because nothing is planned."]
        : ["After it finishes, ServrSit checks every requested convention on its own: each directory exists with the expected owner and mode, and each package is installed at the planned version."]
      : n === 0
        ? ["Nothing will be checked because nothing is planned."]
        : [`After it finishes, ServrSit re-reads the installed version of each of the ${n} package${n === 1 ? "" : "s"} and compares it with this plan.`],
    verifyCannot: prep
      ? ["Whether the services on this server behave correctly.", "Whether this server is otherwise the same as the reference. Only the listed conventions are checked."]
      : ["Whether the services on this server still behave correctly.", "Whether a reboot is needed."],
    expiry: {
      absolute: expires ? formatClock(expires, now, tz) : "unknown",
      relative: expires ? formatUntil(expires, now, clockPaused) : "unknown",
      expired,
    },
    createdText: created ? formatClockWithAge(created, now, tz, clockPaused) : "unknown",
    approveLabel: prep ? approveSetupLabelFor(name) : approveLabelFor(name),
    acknowledgements,
    acknowledgementTokens: production ? [...plan.requiredAcknowledgements, ACK_RECOVERY, ACK_INTERRUPTION] : [...plan.requiredAcknowledgements],
    blockers,
    disposition,
    digest: plan.digest,
    digestShort: plan.digest.slice(0, 15),
  };
}

export interface ScopeDiff {
  readonly added: readonly PackageChange[];
  readonly removed: readonly PackageChange[];
  /** Same package, different from/to version. */
  readonly changed: readonly { readonly before: PackageChange; readonly after: PackageChange }[];
}

const key = (p: PackageChange): string => `${p.name}:${p.arch}`;

export function diffScope(prev: readonly PackageChange[], next: readonly PackageChange[]): ScopeDiff {
  const pm = new Map(prev.map((p) => [key(p), p]));
  const nm = new Map(next.map((p) => [key(p), p]));
  const added = next.filter((p) => !pm.has(key(p)));
  const removed = prev.filter((p) => !nm.has(key(p)));
  const changed = next.flatMap((after) => {
    const before = pm.get(key(after));
    return before && (before.from !== after.from || before.to !== after.to) ? [{ before, after }] : [];
  });
  return { added, removed, changed };
}

export const diffIsEmpty = (d: ScopeDiff): boolean => d.added.length + d.removed.length + d.changed.length === 0;
