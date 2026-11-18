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
import { PRODUCTION_ACKNOWLEDGEMENT_TEXT, type CARE_OPERATIONS, type ProductionAcknowledgement } from "@servrsit/contracts";
import type { PackageChange, PlanView } from "../api/care";
import { formatClock, formatClockWithAge, formatUntil, parseIso } from "../lib/time";

export const WRITES_OFF_TEXT = "Changes are switched off for this server until testing on a disposable server is complete.";

export type PlanKind = (typeof CARE_OPERATIONS)[number];

/** A directory a plan creates, as the API sent it. */
export interface DirectoryVM {
  readonly path: string;
  readonly owner: string;
  readonly group: string;
  readonly mode: string;
}

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
  readonly kind: PlanKind;
  readonly title: string;
  readonly packages: readonly PackageChange[];
  /** Restart plan only: the one service. */
  readonly unit: string | null;
  /** Directory plan only: what will be created. */
  readonly directories: readonly DirectoryVM[];
  /** Directory plan only: requested paths that already exist and stay untouched. */
  readonly existing: readonly string[];
  readonly scopeSummary: string;
  readonly exclusions: readonly string[];
  readonly impact: readonly string[];
  readonly preconditions: readonly PreconditionRow[];
  readonly verifyChecks: readonly string[];
  readonly verifyCannot: readonly string[];
  readonly expiry: { readonly absolute: string; readonly relative: string; readonly expired: boolean };
  readonly createdText: string;
  readonly approveLabel: string;
  /** The sentence under the approve button. */
  readonly approveHelp: string;
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
  PACKAGE_REMOVAL_UNSUPPORTED: "The update would remove packages, which is not supported.",
  DOWNGRADE_UNSUPPORTED: "The update would downgrade packages, which is not supported.",
  HELD_PACKAGE: "The update involves held packages. Holds are never overridden.",
  PACKAGE_LOCKED: "The package manager is in use by another process.",
  UNIT_NOT_SELECTED: "That service is not in your selected set, so ServrSit will not restart it.",
  UNIT_NOT_FOUND: "The server does not have that service.",
  DIRECTORY_NOT_ALLOWED: "One of the paths, owners or modes is not allowed. Directories can only be created under /srv or your home directory, with a mode that is not open to others.",
  CONTROLLER_CLOCK_UNTRUSTED: "ServrSit's own clock is wrong, so approvals are paused until it is fixed.",
  IDENTITY_UNVERIFIED: "This server's identity has not been verified yet, so ServrSit will not change it.",
  IDENTITY_AMBIGUOUS: "This address could belong to more than one machine, so ServrSit will not change it until that is settled.",
};

function blockerText(b: { code: string; message: string }, kind: PlanKind): string {
  if (b.code === "WRITES_DISABLED") return WRITES_OFF_TEXT;
  if (b.code === "PLAN_UNAVAILABLE") return kind === "apply.packages.v1" ? "No package transaction could be prepared for this server." : "The server could not be read, so this plan could not be prepared.";
  if (b.code === "NO_CHANGES") return kind === "prepare.directories.v1" ? "Every requested path already exists, so there is nothing to create." : "There are no package updates to apply.";
  return BLOCKER_FIXED[b.code] ?? "This plan has a blocker.";
}

/** Codes that make "the plan can be applied" false, per kind. */
const APPLY_CODES = ["PLAN_UNAVAILABLE", "NO_CHANGES", "PACKAGE_REMOVAL_UNSUPPORTED", "DOWNGRADE_UNSUPPORTED", "HELD_PACKAGE", "PACKAGE_LOCKED", "UNIT_NOT_SELECTED", "UNIT_NOT_FOUND", "DIRECTORY_NOT_ALLOWED"];

export function approveLabelFor(serverName: string): string {
  return `Approve update on ${serverName}`;
}

const PLAIN_ID = /^[A-Za-z0-9@_.:/~-]{1,255}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Directories and paths come from the API as untrusted data: keep only well-formed ones. */
function directoriesOf(detail: Readonly<Record<string, unknown>>): DirectoryVM[] {
  const list = detail["directories"];
  if (!Array.isArray(list)) return [];
  return list.flatMap((d) => (isObj(d) && typeof d["path"] === "string" && typeof d["owner"] === "string" && typeof d["group"] === "string" && typeof d["mode"] === "string"
    ? [{ path: d["path"], owner: d["owner"], group: d["group"], mode: d["mode"] }] : []));
}

function existingOf(detail: Readonly<Record<string, unknown>>): string[] {
  const list = detail["existing"];
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const CLOCK_PAUSED_REASON = "ServrSit's own clock is wrong, so expiry times can't be trusted. Approvals are paused until it is fixed.";

interface KindText {
  title: string;
  scopeSummary: string;
  exclusions: string[];
  impact: string[];
  verifyChecks: string[];
  verifyCannot: string[];
  approveLabel: string;
  approveHelp: string;
  stateRow: string;
}

function kindText(plan: PlanView, name: string, unit: string | null, dirs: readonly DirectoryVM[], existing: readonly string[]): KindText {
  const n = plan.scope.packages.length;
  switch (plan.operation) {
    case "restart.service.v1":
      return {
        title: `Restart ${unit ?? "a service"} on ${name}`,
        scopeSummary: `Restart one service${unit ? `, ${unit}` : ""}. Plan version ${plan.version}.`,
        exclusions: ["No other service is restarted.", "No reboot.", "No package changes."],
        impact: [
          "Restarting a service interrupts it for a short time. Anything that depends on it may fail while it restarts, and ServrSit cannot tell in advance what does.",
          "This plan does not reboot the server. A reboot is a separate plan and approval.",
        ],
        verifyChecks: ["After it finishes, ServrSit checks that the service is active and that its start time is new. An unchanged start time does not count as a restart."],
        verifyCannot: ["Whether the service behaves correctly after it starts.", "Whether the things that depend on it recovered."],
        approveLabel: `Approve restart of ${unit ?? "the service"}`,
        approveHelp: "Approving restarts this service on the server. The review above is the checkpoint.",
        stateRow: "Service state is recent",
      };
    case "reboot.host.v1":
      return {
        title: `Reboot ${name}`,
        scopeSummary: `Reboot the whole machine, not one service. Plan version ${plan.version}.`,
        exclusions: ["No package changes.", "No individual service is restarted on its own: every service stops and starts again with the machine."],
        impact: [
          `Every service on ${name} stops while it restarts, and the server cannot be reached until it comes back. ServrSit cannot predict how long that takes.`,
          "A reboot is its own approval. It is separate from a package update and from a service restart.",
        ],
        verifyChecks: ["After the server answers again, ServrSit checks that its boot id is new. A server that is still unreachable is not treated as rebooted or as failed."],
        verifyCannot: ["Whether every service came back and works.", "How long your users could not reach it."],
        approveLabel: `Approve reboot of ${name}`,
        approveHelp: "Approving reboots this server. The review above is the checkpoint.",
        stateRow: "Boot state is recent",
      };
    case "prepare.directories.v1":
      return {
        title: `Create directories on ${name}`,
        scopeSummary: dirs.length === 0
          ? "Nothing to create: every requested path already exists."
          : `${plural(dirs.length, "directory", "directories")} to create${existing.length === 0 ? "" : existing.length === 1 ? ", 1 path already exists and stays as it is" : `, ${existing.length} paths already exist and stay as they are`}. Plan version ${plan.version}.`,
        exclusions: [
          "Existing paths are left exactly as they are: nothing is overwritten, re-owned or changed recursively.",
          "No files are copied. No service restarts. No reboot.",
          "No package changes.",
        ],
        impact: [
          "Creating a directory is routine and does not touch anything that already exists.",
          "This plan restarts no services and does not reboot.",
        ],
        verifyChecks: dirs.length === 0
          ? ["Nothing will be checked because nothing is planned."]
          : ["After it finishes, ServrSit checks each path on its own: it exists as a directory with exactly the approved owner, group and mode."],
        verifyCannot: ["Whether anything stored in or using these directories is correct."],
        approveLabel: `Approve creating directories on ${name}`,
        approveHelp: "Approving creates these directories on the server. The review above is the checkpoint.",
        stateRow: "Directory state is recent",
      };
    default:
      return {
        title: `Update packages on ${name}`,
        scopeSummary: n === 0 ? "No package changes were prepared." : `${plural(n, "package update", "package updates")}, plan version ${plan.version}.`,
        exclusions: ["No service restarts.", "No reboot.", "No package removals."],
        impact: [
          "Updating a package can briefly interrupt a service that uses it. ServrSit cannot tell in advance which ones.",
          "This plan restarts no services and does not reboot. A reboot may still be needed afterward; that would be a separate plan and approval.",
        ],
        verifyChecks: n === 0
          ? ["Nothing will be checked because nothing is planned."]
          : [`After it finishes, ServrSit re-reads the installed version of each of the ${plural(n, "package", "packages")} and compares it with this plan.`],
        verifyCannot: ["Whether the services on this server still behave correctly.", "Whether a reboot is needed."],
        approveLabel: approveLabelFor(name),
        approveHelp: "Approving starts the update on this server. The review above is the checkpoint.",
        stateRow: "Package state is recent",
      };
  }
}

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
  const blockers = plan.blockers.map((b) => ({ code: b.code, message: blockerText(b, plan.operation) }));
  const hasPreview = plan.preconditions.previewDigest !== "none";
  const rawUnit = plan.detail["unit"];
  const unit = plan.operation === "restart.service.v1" && typeof rawUnit === "string" && PLAIN_ID.test(rawUnit) ? rawUnit : null;
  const dirs = plan.operation === "prepare.directories.v1" ? directoriesOf(plan.detail) : [];
  const existing = plan.operation === "prepare.directories.v1" ? existingOf(plan.detail) : [];
  const t = kindText(plan, name, unit, dirs, existing);

  const preconditions: PreconditionRow[] = [
    created && hasPreview
      ? { label: t.stateRow, state: "met", detail: `Read ${formatClockWithAge(created, now, tz, clockPaused)}.` }
      : { label: t.stateRow, state: "unknown", detail: "No preview of the server was taken for this plan." },
    codes.has("WRITES_DISABLED")
      ? { label: "Changes switched on for this server", state: "blocked", detail: WRITES_OFF_TEXT }
      : { label: "Changes switched on for this server", state: "met", detail: "Writes are enabled for this server." },
    codes.has("TARGET_BUSY") || codes.has("OUTCOME_UNKNOWN")
      ? { label: "No unfinished operation on this server", state: "blocked", detail: codes.has("OUTCOME_UNKNOWN") ? BLOCKER_FIXED["OUTCOME_UNKNOWN"] ?? "" : BLOCKER_FIXED["TARGET_BUSY"] ?? "" }
      : { label: "No unfinished operation on this server", state: "met", detail: "ServrSit has no unfinished operation recorded for it." },
  ];
  for (const c of APPLY_CODES) {
    if (codes.has(c)) preconditions.push({ label: plan.operation === "apply.packages.v1" ? "Package transaction can be applied" : "The plan can be applied", state: "blocked", detail: blockerText({ code: c, message: "" }, plan.operation) });
  }
  for (const c of ["CONTROLLER_CLOCK_UNTRUSTED", "IDENTITY_UNVERIFIED", "IDENTITY_AMBIGUOUS"]) {
    if (codes.has(c)) preconditions.push({ label: "ServrSit can act on this server", state: "blocked", detail: BLOCKER_FIXED[c] ?? "" });
  }
  if (plan.production && plan.blockers.length === 0) {
    preconditions.push({ label: "Recovery route for a production server", state: "owner", detail: "Confirmed by you below, before approving. ServrSit does not verify it." });
  }

  // Production acknowledgements use the contract's exact tokens and texts. A token this page cannot show blocks approval.
  const acknowledgements: Acknowledgement[] = [];
  let unknownAck = false;
  for (const token of plan.requiredAcknowledgements) {
    const label = (PRODUCTION_ACKNOWLEDGEMENT_TEXT as Readonly<Record<string, string>>)[token];
    if (label === undefined) unknownAck = true;
    else acknowledgements.push({ id: token as ProductionAcknowledgement, label });
  }

  // Disposition priority: writes off, other blockers, unknown confirmation, clock, expired, changed notice.
  let disposition: Disposition;
  if (codes.has("WRITES_DISABLED")) {
    disposition = { kind: "writes-disabled", title: "Changes are switched off", reason: WRITES_OFF_TEXT, canApprove: false, offerRefresh: true };
  } else if (plan.blockers.length > 0 || !plan.approvable) {
    const first = blockers[0]?.message ?? "This plan has a blocker.";
    disposition = { kind: "blocked", title: "This plan can't be approved", reason: first, canApprove: false, offerRefresh: true };
  } else if (unknownAck) {
    disposition = { kind: "blocked", title: "This plan can't be approved here", reason: "It asks for a confirmation this page does not know how to show, so ServrSit will not let you approve it from here.", canApprove: false, offerRefresh: true };
  } else if (clockPaused) {
    disposition = { kind: "blocked", title: "Approvals are paused", reason: CLOCK_PAUSED_REASON, canApprove: false, offerRefresh: false };
  } else if (expired) {
    const x = noticeText({ code: "PLAN_EXPIRED" }, name);
    disposition = { kind: "expired", ...x, canApprove: false, offerRefresh: true };
  } else if (notice && noticeDisables(notice)) {
    const x = noticeText(notice, name);
    disposition = { kind: "changed", ...x, canApprove: false, offerRefresh: true };
  } else {
    disposition = { kind: "ready", title: "Ready to review", reason: "Review the scope and impact, then approve.", canApprove: true, offerRefresh: false };
  }

  return {
    id: plan.id,
    version: plan.version,
    serverName: name,
    serverId: plan.target.serverId,
    isProduction: plan.production,
    simulated: plan.target.simulated,
    kind: plan.operation,
    title: t.title,
    packages: plan.scope.packages,
    unit,
    directories: dirs,
    existing,
    scopeSummary: t.scopeSummary,
    exclusions: t.exclusions,
    impact: t.impact,
    preconditions,
    verifyChecks: t.verifyChecks,
    verifyCannot: t.verifyCannot,
    expiry: {
      absolute: expires ? formatClock(expires, now, tz) : "unknown",
      relative: expires ? formatUntil(expires, now, clockPaused) : "unknown",
      expired,
    },
    createdText: created ? formatClockWithAge(created, now, tz, clockPaused) : "unknown",
    approveLabel: t.approveLabel,
    approveHelp: t.approveHelp,
    acknowledgements,
    acknowledgementTokens: [...plan.requiredAcknowledgements],
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
