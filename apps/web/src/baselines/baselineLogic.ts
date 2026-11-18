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
 *   - a setup plan creates only Missing items. Conflicts are never touched and
 *     are listed as left alone; Not checked items are left out and said so;
 *   - nothing sensitive or machine-specific is eligible for a baseline.
 */
import type { Baseline, BaselineServer, Candidate, CompareStatus, ComparisonRow } from "../api/stubs/baselines";
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
  readonly directories: readonly ComparisonRow[];
  readonly packages: readonly ComparisonRow[];
  readonly leftAlone: readonly { label: string; reason: string }[];
  /** Nothing to create or install: the plan would change nothing. */
  readonly nothingToDo: boolean;
}

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
  const directories = missing.filter((r) => r.kind === "directory");
  const packages = missing.filter((r) => r.kind === "package");
  return { directories, packages, leftAlone, nothingToDo: directories.length + packages.length === 0 };
}

export function describeSetup(s: SetupScope): string {
  if (s.nothingToDo) return "Nothing to create or install. This server already matches every checked convention, so a plan would change nothing.";
  const d = s.directories.length, p = s.packages.length;
  const parts: string[] = [];
  if (d) parts.push(`create ${d} director${d === 1 ? "y" : "ies"}`);
  if (p) parts.push(`install ${p} package${p === 1 ? "" : "s"}`);
  return `A setup plan would ${parts.join(" and ")}${s.leftAlone.length ? `, and leave ${s.leftAlone.length} item${s.leftAlone.length === 1 ? "" : "s"} alone` : ""}.`;
}

export function referenceAge(server: BaselineServer, now: Date, tz: string, uncertain = false): { text: string; old: boolean } {
  const d = parseIso(server.observedAt);
  if (!d) return { text: "unknown age", old: true };
  return { text: `Observed ${formatClockWithAge(d, now, tz, uncertain)}`, old: now.getTime() - d.getTime() > 24 * 3_600_000 };
}

export function splitCandidates(list: readonly Candidate[]): { eligible: Candidate[]; ineligible: Candidate[] } {
  return { eligible: list.filter((c) => c.eligible), ineligible: list.filter((c) => !c.eligible) };
}

export function validateBaselineName(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "Give the baseline a name.";
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(t) ? null : "Use letters, digits, spaces, dots, dashes and underscores, up to 64 characters.";
}

export const baselineLine = (b: Baseline, now: Date, tz: string): string =>
  `${b.name}, version ${b.version}, from ${b.referenceName} (${referenceAge({ observedAt: b.sourceObservedAt } as BaselineServer, now, tz).text.toLowerCase()})`;
