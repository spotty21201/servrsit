/**
 * operationViewModel — turns GET /api/operations/:id (+ the plan it ran, for
 * the server name and expected versions) into the Operation detail screen
 * (UX-08, UX Spec §11). Pure; no React.
 *
 * Rules carried here:
 *   - The eight states use the UX §11 labels exactly.
 *   - Steps and times come from recorded events only. Nothing is invented and
 *     there are no progress percentages (the API has no measurable progress).
 *   - "Completed and verified" only for state `succeeded`. Verifying shows no
 *     success wording. A verified install with a reboot still needed says both.
 *   - Unknown outcome is its own state, never softened into success or failure.
 *   - The transcript is the recorded event log in fixed text plus a short list
 *     of known, safe payload fields. Raw remote output is not available yet and
 *     the screen says so.
 */
import type { OperationEventView, OperationStateName, OperationView, PlanView } from "../api/stubs/care";
import { formatClockWithAge, formatTimeSeconds, parseIso } from "../lib/time";

export type BadgeKey = "passed" | "attention" | "failed" | "unknown" | "progress";
export type StepStatus = "done" | "current" | "pending" | "failed" | "unknown" | "not-started";

export const STEP_STATUS_TEXT: Readonly<Record<StepStatus, string>> = {
  done: "Done",
  current: "In progress",
  pending: "Waiting",
  failed: "Failed",
  unknown: "Not confirmed",
  "not-started": "Not started",
};

export interface StepVM {
  readonly id: string;
  readonly title: string;
  readonly status: StepStatus;
  /** "09:42:10" or null when it has not happened. */
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly note: string | null;
}

export interface ReceiptVM {
  readonly changed: readonly string[];
  readonly verified: readonly string[];
  readonly stillNeeded: readonly string[];
  readonly couldNotVerify: readonly string[];
}

export interface TranscriptLine {
  readonly seq: number;
  readonly time: string;
  readonly text: string;
}

export interface OperationVM {
  readonly id: string;
  readonly planId: string;
  readonly state: OperationStateName;
  readonly stateLabel: string;
  readonly badge: BadgeKey;
  readonly title: string;
  readonly serverName: string;
  readonly isProduction: boolean;
  readonly simulated: boolean;
  readonly headline: string;
  readonly explanation: string;
  readonly steps: readonly StepVM[];
  readonly receipt: ReceiptVM | null;
  readonly receiptTitle: string;
  readonly transcript: readonly TranscriptLine[];
  readonly unresolved: boolean;
  readonly stop: { readonly visible: boolean; readonly label: string; readonly help: string; readonly requested: boolean };
  readonly recheck: boolean;
  readonly updatedText: string;
}

const LABEL: Readonly<Record<OperationStateName, string>> = {
  queued: "Waiting to start",
  running: "Working on {name}",
  verifying: "Checking the result",
  succeeded: "Completed and verified",
  partially_succeeded: "Some work completed",
  failed: "Could not complete",
  cancelled_before_start: "Cancelled — no work started",
  outcome_unknown: "Result not yet confirmed",
};

const BADGE: Readonly<Record<OperationStateName, BadgeKey>> = {
  queued: "progress",
  running: "progress",
  verifying: "progress",
  succeeded: "passed",
  partially_succeeded: "attention",
  failed: "failed",
  cancelled_before_start: "unknown",
  outcome_unknown: "unknown",
};

const FINAL = new Set<OperationStateName>(["succeeded", "partially_succeeded", "failed", "cancelled_before_start"]);
const UNRESOLVED = new Set<OperationStateName>(["queued", "running", "verifying", "outcome_unknown"]);

export const isUnresolvedState = (s: OperationStateName): boolean => UNRESOLVED.has(s);

export const STOP_HELP =
  "A package transaction that is already running may need to finish first. This asks ServrSit to stop after the current safe step. It is not an undo, and nothing is force-killed.";

const SAFE_KEYS = ["code", "effects", "reason", "how", "remoteState", "exitCode", "during"] as const;

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function clip(s: string, n = 160): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function eventText(e: OperationEventView): string {
  const parts: string[] = [e.type];
  if (e.fromState || e.toState) parts.push(`${e.fromState ?? "-"} -> ${e.toState ?? "-"}`);
  for (const k of SAFE_KEYS) {
    const v = e.payload[k];
    if (typeof v === "string" || typeof v === "number") parts.push(`${k}=${clip(String(v))}`);
  }
  const ok = strings(e.payload["verified"]).length;
  const bad = strings(e.payload["notVerified"]).length;
  if (e.payload["verified"] !== undefined) parts.push(`verified=${ok} notVerified=${bad}`);
  return parts.join("  ");
}

function firstWhere(events: readonly OperationEventView[], f: (e: OperationEventView) => boolean): OperationEventView | null {
  return events.find(f) ?? null;
}

export function buildSteps(op: OperationView["operation"], events: readonly OperationEventView[], tz: string, serverName: string): StepVM[] {
  const t = (e: { at: string } | null): string | null => {
    const d = e ? parseIso(e.at) : null;
    return d ? formatTimeSeconds(d, tz) : null;
  };
  const created = firstWhere(events, (e) => e.type === "created");
  const dispatch = firstWhere(events, (e) => e.type === "dispatch_attempted");
  const accepted = firstWhere(events, (e) => e.type === "remote_accepted");
  const rejected = firstWhere(events, (e) => e.type === "remote_rejected");
  const cancelled = firstWhere(events, (e) => e.type === "cancelled");
  const verifyStart = firstWhere(events, (e) => e.toState === "verifying");
  const verified = firstWhere(events, (e) => e.type === "verification_recorded");
  const finalEvent = [...events].reverse().find((e) => e.toState !== null && FINAL.has(e.toState)) ?? null;
  const unknownEv = [...events].reverse().find((e) => e.type === "outcome_unknown") ?? null;
  const state = op.state;
  const isFinal = FINAL.has(state);
  const unknown = state === "outcome_unknown";
  const wasAccepted = accepted !== null || events.some((e) => e.toState === "running");

  // 1. Approved
  const s1: StepVM = { id: "approved", title: "Approved by you", status: "done", startedAt: t(created) ?? t({ at: op.createdAt }), endedAt: null, note: null };

  // 2. Sent
  let s2: StepVM;
  if (state === "cancelled_before_start") {
    s2 = { id: "sent", title: `Send to ${serverName}`, status: "not-started", startedAt: null, endedAt: t(cancelled), note: "Cancelled before anything was sent." };
  } else if (rejected) {
    s2 = { id: "sent", title: `Send to ${serverName}`, status: "failed", startedAt: t(dispatch), endedAt: t(rejected), note: `${serverName} did not accept the operation.` };
  } else if (wasAccepted) {
    s2 = { id: "sent", title: `Send to ${serverName}`, status: "done", startedAt: t(dispatch), endedAt: t(accepted), note: `${serverName} confirmed it accepted the operation.` };
  } else if (unknown) {
    s2 = { id: "sent", title: `Send to ${serverName}`, status: "unknown", startedAt: t(dispatch), endedAt: null, note: "It is not confirmed whether the server received it." };
  } else if (state === "failed") {
    s2 = { id: "sent", title: `Send to ${serverName}`, status: "failed", startedAt: t(dispatch), endedAt: null, note: null };
  } else {
    s2 = { id: "sent", title: `Send to ${serverName}`, status: "current", startedAt: t(dispatch), endedAt: null, note: "Waiting for the server to confirm." };
  }

  // 3. Install
  let s3: StepVM;
  if (!wasAccepted) {
    const never = isFinal || unknown;
    s3 = { id: "install", title: "Install packages", status: never && !unknown ? "not-started" : unknown ? "unknown" : "pending", startedAt: null, endedAt: null, note: null };
  } else if (!verifyStart) {
    const status: StepStatus = state === "running" ? "current" : state === "failed" ? "failed" : unknown ? "unknown" : "done";
    s3 = { id: "install", title: "Install packages", status, startedAt: t(accepted), endedAt: null, note: unknown ? "Progress since the last confirmed event is not known." : null };
  } else {
    s3 = { id: "install", title: "Install packages", status: "done", startedAt: t(accepted), endedAt: t(verifyStart), note: null };
  }

  // 4. Verify
  let s4: StepVM;
  if (!verifyStart) {
    s4 = { id: "verify", title: "Check installed versions", status: isFinal ? "not-started" : unknown ? "unknown" : "pending", startedAt: null, endedAt: null, note: null };
  } else if (!verified) {
    const status: StepStatus = state === "verifying" ? "current" : state === "failed" ? "failed" : unknown ? "unknown" : "done";
    s4 = { id: "verify", title: "Check installed versions", status, startedAt: t(verifyStart), endedAt: null, note: null };
  } else {
    s4 = { id: "verify", title: "Check installed versions", status: "done", startedAt: t(verifyStart), endedAt: t(verified), note: null };
  }

  // 5. Result
  const s5: StepVM = {
    id: "result",
    title: "Result recorded",
    status: isFinal ? (state === "failed" ? "failed" : "done") : unknown ? "unknown" : "pending",
    startedAt: null,
    endedAt: isFinal ? t(finalEvent) : null,
    note: unknown ? `Tracking was lost at ${t(unknownEv) ?? "an unrecorded time"}.` : null,
  };
  return [s1, s2, s3, s4, s5];
}

function buildReceipt(op: OperationView["operation"], events: readonly OperationEventView[], plan: PlanView | null, serverName: string): { title: string | null; receipt: ReceiptVM | null } {
  const state = op.state;
  if (!FINAL.has(state) && state !== "outcome_unknown") return { title: null, receipt: null };
  const ver = [...events].reverse().find((e) => e.type === "verification_recorded");
  const okKeys = strings(ver?.payload["verified"]);
  const badKeys = strings(ver?.payload["notVerified"]);
  const expected = plan?.verification.expectInstalled ?? {};
  const line = (k: string): string => (expected[k] ? `${k} ${expected[k]}` : k);
  const total = okKeys.length + badKeys.length;
  const reboot = events.some((e) => e.payload["rebootRequired"] === true);
  const lastEffects = [...events].reverse().map((e) => e.payload["effects"]).find((v): v is string => typeof v === "string");

  const changed: string[] = [];
  const verified: string[] = [];
  const stillNeeded: string[] = [];
  const couldNot: string[] = [];

  switch (state) {
    case "succeeded":
      changed.push(...okKeys.map(line));
      verified.push(`Installed versions match the plan for all ${okKeys.length} package${okKeys.length === 1 ? "" : "s"}.`);
      stillNeeded.push(reboot ? `Reboot ${serverName}. This needs its own plan and approval.` : "Nothing further for this operation.");
      break;
    case "partially_succeeded":
      changed.push(...okKeys.map(line));
      verified.push(`${okKeys.length} of ${total} package${total === 1 ? "" : "s"} match the plan.`);
      stillNeeded.push("Review the packages that did not match. A new plan is needed to retry them.");
      couldNot.push(...badKeys.map((k) => `${line(k)}: installed version does not match the plan.`));
      break;
    case "failed":
      changed.push(lastEffects ?? "No changes were confirmed.");
      verified.push("Nothing was verified.");
      stillNeeded.push("Review the failure, then make a new plan when you are ready.");
      couldNot.push(...badKeys.map((k) => `${line(k)}: installed version does not match the plan.`));
      break;
    case "cancelled_before_start":
      changed.push(lastEffects ?? "Nothing. No work was started.");
      verified.push("Nothing to verify.");
      stillNeeded.push("Nothing. Make a new plan if you still want this.");
      break;
    case "outcome_unknown":
      changed.push("Not confirmed. Some changes may have been made.");
      verified.push("Nothing has been verified yet.");
      stillNeeded.push(`Check the outcome again. New changes on ${serverName} stay unavailable until it is confirmed.`);
      break;
    default:
      break;
  }
  if (state !== "outcome_unknown" && state !== "cancelled_before_start") {
    couldNot.push("Whether the services on this server still behave correctly. ServrSit checks installed package versions only.");
    if (!reboot) couldNot.push("Whether a reboot is needed.");
  }
  const title = state === "succeeded" && reboot ? "Completed and verified. A reboot is still needed." : null;
  return { title, receipt: { changed, verified, stillNeeded, couldNotVerify: couldNot } };
}

export function toOperationVM(view: OperationView, plan: PlanView | null, now: Date, tz: string): OperationVM {
  const { operation: op, events } = view;
  const serverName = plan?.target.name ?? "this server";
  const state = op.state;
  const reboot = events.some((e) => e.payload["rebootRequired"] === true);
  const { title: receiptTitle, receipt } = buildReceipt(op, events, plan, serverName);
  const stateLabel = LABEL[state].replace("{name}", serverName);
  const updated = parseIso(op.updatedAt);

  const explanations: Record<OperationStateName, string> = {
    queued: "Approved. ServrSit is sending it to the server. Nothing has changed on the server yet.",
    running: "The server confirmed it started. Packages are being installed. This is not finished.",
    verifying: "The install step finished. ServrSit is now checking the installed versions. It is not complete until that check passes.",
    succeeded: reboot
      ? "Installed versions match the plan. A reboot is still needed."
      : "Every package matches the plan. Nothing left to babysit.",
    partially_succeeded: "Some packages were updated and confirmed. Others were not. They are listed separately below.",
    failed: "The operation did not complete. What is known about the server is listed below.",
    cancelled_before_start: "The operation was cancelled before anything was sent. The server was not changed.",
    outcome_unknown: `ServrSit lost track of this operation and cannot say whether it finished. Conflicting changes on ${serverName} are unavailable until the outcome is confirmed.`,
  };

  return {
    id: op.id,
    planId: op.planId,
    state,
    stateLabel,
    badge: BADGE[state],
    title: `Update packages on ${serverName}`,
    serverName,
    isProduction: plan?.production ?? false,
    simulated: op.simulated,
    headline: state === "succeeded" && reboot ? "Completed and verified. Reboot still needed." : stateLabel,
    explanation: explanations[state],
    steps: buildSteps(op, events, tz, serverName),
    receipt,
    receiptTitle: receiptTitle ?? (state === "outcome_unknown" ? "What we know so far" : "Receipt"),
    transcript: events.map((e) => {
      const d = parseIso(e.at);
      return { seq: e.seq, time: d ? formatTimeSeconds(d, tz) : "--:--:--", text: eventText(e) };
    }),
    unresolved: UNRESOLVED.has(state),
    stop: {
      visible: state === "running" || op.stopRequested,
      label: "Stop after this safe step",
      help: STOP_HELP,
      requested: op.stopRequested,
    },
    recheck: state === "outcome_unknown",
    updatedText: updated ? formatClockWithAge(updated, now, tz) : "unknown",
  };
}
