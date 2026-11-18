/**
 * baselineLogic — labels, grouping, summary and setup-scope rules for the
 * Baseline compare and prepare-a-server flow (T-073, PRD FR-09/FR-15, UX Spec
 * §12). Pure; no React.
 *
 * Rules carried here:
 *   - the five labels are exactly Matches, Missing, Different by design,
 *     Conflict, Not checked;
 *   - ordinary differences (Missing) and deviations that need a decision
 *     (Conflict) are shown apart from intentional ones and from matches;
 *   - Mark intentional is offered only for Missing and Conflict;
 *   - a setup plan creates only missing directories (prepare.directories.v1).
 *     Missing packages are listed as not included, because no supported
 *     operation installs packages yet. Conflicts are never touched and are
 *     listed as left alone; Not checked items are left out and said so;
 *   - nothing sensitive or machine-specific is eligible for a baseline.
 */
import { BASELINE_NAME, type CompareStatus } from "@servrsit/contracts";
import type { Baseline, BaselineServer, BaselinesClientError, Candidate, ComparisonRow } from "../api/baselines";
import { formatClockWithAge, parseIso } from "../lib/time";

export const STATUS_LABEL: Readonly<Record<CompareStatus, string>> = {
  matches: "Matches",
  missing: "Missing",
  "different-by-design": "Different by design",
  conflict: "Conflict",
  "not-checked": "Not checked",
};

export type Tone = "passed" | "attention" | "failed" | "unknown" | "progress";
export const STATUS_TONE: Readonly<Record<CompareStatus, Tone>> = {
  matches: "passed", missing: "attention", "different-by-design": "unknown", conflict: "failed", "not-checked": "unknown",
};

export const EXCLUSION_STATEMENT =
  "Credentials, SSH host keys, application data, databases, personal files, existing contents and network settings are not copied. A setup plan never touches them.";

export const SAVE_NOTE = "Saving a baseline records which conventions you chose. It does not authorize any change on any server.";

export const canMarkIntentional = (s: CompareStatus): boolean => s === "missing" || s === "conflict";

export interface Groups {
  readonly needsDecision: readonly ComparisonRow[];
  readonly intentional: readonly ComparisonRow[];
  readonly matches: readonly ComparisonRow[];
  readonly notChecked: readonly ComparisonRow[];
}

export function groupRows(rows: readonly ComparisonRow[]): Groups {
  return {
    needsDecision: rows.filter((r) => r.status === "missing" || r.status === "conflict"),
    intentional: rows.filter((r) => r.status === "different-by-design"),
    matches: rows.filter((r) => r.status === "matches"),
    notChecked: rows.filter((r) => r.status === "not-checked"),
  };
}

export function summaryText(rows: readonly ComparisonRow[]): string {
  const c = (s: CompareStatus): number => rows.filter((r) => r.status === s).length;
  const parts = [`${c("matches")} match`];
  if (c("missing")) parts.push(`${c("missing")} missing`);
  if (c("conflict")) parts.push(`${c("conflict")} in conflict`);
  if (c("different-by-design")) parts.push(`${c("different-by-design")} different by design`);
  if (c("not-checked")) parts.push(`${c("not-checked")} not checked`);
  return `${rows.length} convention${rows.length === 1 ? "" : "s"}: ${parts.join(", ")}.`;
}

export interface SetupScope {
  /** Missing directories the plan would create. */
  readonly directories: readonly ComparisonRow[];
  /** Missing items no supported operation can act on (packages). Listed, not planned. */
  readonly notIncluded: readonly ComparisonRow[];
  readonly leftAlone: readonly { label: string; reason: string }[];
  /** Nothing to create: the plan would change nothing. */
  readonly nothingToDo: boolean;
}

export const NOT_INCLUDED_REASON = "No supported operation installs packages yet, so it is listed here and not planned.";

export function setupScope(rows: readonly ComparisonRow[]): SetupScope {
  const missing = rows.filter((r) => r.status === "missing");
  const leftAlone = rows
    .filter((r) => r.status === "conflict" || r.status === "not-checked" || r.status === "different-by-design")
    .map((r) => ({
      label: r.label,
      reason: r.status === "conflict" ? "It exists and conflicts with the baseline, so it is not changed."
        : r.status === "not-checked" ? "It was not checked, so nothing is planned for it."
        : "You marked it intentional for this server.",
    }));
  const directories = missing.filter((r) => r.actionable);
  const notIncluded = missing.filter((r) => !r.actionable);
  return { directories, notIncluded, leftAlone, nothingToDo: directories.length === 0 };
}

export function describeSetup(s: SetupScope): string {
  const n = s.notIncluded.length;
  const extra = `${n ? ` ${n} missing item${n === 1 ? " is" : "s are"} not included.` : ""}`;
  if (s.nothingToDo) return `Nothing to create. No missing directory was found, so a plan would change nothing.${extra}`;
  const d = s.directories.length;
  return `A setup plan would create ${d} director${d === 1 ? "y" : "ies"}${s.leftAlone.length ? ` and leave ${s.leftAlone.length} item${s.leftAlone.length === 1 ? "" : "s"} alone` : ""}.${extra}`;
}

export function referenceAge(server: Pick<BaselineServer, "observedAt">, now: Date, tz: string, uncertain = false): { text: string; old: boolean; never: boolean } {
  const d = parseIso(server.observedAt);
  if (!d) return { text: "Never observed by ServrSit", old: true, never: true };
  return { text: `Observed ${formatClockWithAge(d, now, tz, uncertain)}`, old: now.getTime() - d.getTime() > 24 * 3_600_000, never: false };
}

export function splitCandidates(list: readonly Candidate[]): { eligible: Candidate[]; ineligible: Candidate[] } {
  return { eligible: list.filter((c) => c.eligible), ineligible: list.filter((c) => !c.eligible) };
}

export function validateBaselineName(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "Give the baseline a name.";
  return BASELINE_NAME.test(t) ? null : "Use letters, digits, spaces, dots, dashes, underscores and brackets, up to 64 characters.";
}

export const baselineLine = (b: Baseline, now: Date, tz: string): string =>
  `${b.name}, version ${b.version}, from ${b.referenceName} (${referenceAge({ observedAt: b.sourceObservedAt }, now, tz).text.toLowerCase()})`;

/** What to tell the owner when a baseline call fails. A lost answer never claims nothing changed. */
export function baselineErrorText(code: BaselinesClientError, reason?: string): string {
  switch (code) {
    case "STALE_CANDIDATES": return "The reference server changed since you looked, so the list of conventions is out of date. Go back and read it again.";
    case "NOT_ALLOWED": return `ServrSit will not do that.${reason ? ` ${reason}` : ""} Nothing was changed.`;
    case "NOT_FOUND": return "ServrSit could not find that server or baseline. Reload the page. Nothing was changed.";
    case "INVALID_INPUT": return `ServrSit did not accept that.${reason ? ` ${reason}` : ""} Nothing was changed.`;
    case "UNAVAILABLE": return `ServrSit could not read the server right now.${reason ? ` ${reason}` : ""} Nothing was changed. Try again in a moment.`;
    case "UNAUTHENTICATED": return "You are signed out. Sign in again, then repeat that.";
    case "CSRF_INVALID": return "Your session needs a refresh. Reload the page, then repeat that. Nothing was changed.";
    default: return "ServrSit did not get a clear answer, so the step may or may not have happened. Reload the page to see what is recorded.";
  }
}

export const SOURCE_LABEL = { ssh: "read over SSH", local: "read on the ServrSit machine", simulated: "simulated, not a real server" } as const;
