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
import type { OperationEventView, OperationStateName, OperationView, PlanView } from "../api/care";
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
  "A change that is already running may need to finish first. This asks ServrSit to stop after the current safe step. It is not an undo, and nothing is force-killed.";
export const CANCEL_HELP = "It has not started yet. If it is still waiting, this cancels it and nothing is sent to the server. If it has just started, ServrSit asks it to stop after the current safe step instead.";

type Kind = "packages" | "restart" | "reboot" | "directories";
const kindOf = (operation: string): Kind =>
  operation === "restart.service.v1" ? "restart" : operation === "reboot.host.v1" ? "reboot" : operation === "prepare.directories.v1" ? "directories" : "packages";

const STEP_TITLES: Readonly<Record<Kind, { work: string; verify: string }>> = {
  packages: { work: "Install packages", verify: "Check installed versions" },
  restart: { work: "Restart the service", verify: "Check the service started again" },
  reboot: { work: "Reboot the server", verify: "Check the server booted again" },
  directories: { work: "Create the directories", verify: "Check each directory" },
};

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
  const titles = STEP_TITLES[kindOf(op.operation)];
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
    s3 = { id: "install", title: titles.work, status: never && !unknown ? "not-started" : unknown ? "unknown" : "pending", startedAt: null, endedAt: null, note: null };
  } else if (!verifyStart) {
    const status: StepStatus = state === "running" ? "current" : state === "failed" ? "failed" : unknown ? "unknown" : "done";
    s3 = { id: "install", title: titles.work, status, startedAt: t(accepted), endedAt: null, note: unknown ? "Progress since the last confirmed event is not known." : null };
  } else {
    s3 = { id: "install", title: titles.work, status: "done", startedAt: t(accepted), endedAt: t(verifyStart), note: null };
  }

  // 4. Verify
  let s4: StepVM;
  if (!verifyStart) {
    s4 = { id: "verify", title: titles.verify, status: isFinal ? "not-started" : unknown ? "unknown" : "pending", startedAt: null, endedAt: null, note: null };
  } else if (!verified) {
    const status: StepStatus = state === "verifying" ? "current" : state === "failed" ? "failed" : unknown ? "unknown" : "done";
    s4 = { id: "verify", title: titles.verify, status, startedAt: t(verifyStart), endedAt: null, note: null };
  } else {
    s4 = { id: "verify", title: titles.verify, status: "done", startedAt: t(verifyStart), endedAt: t(verified), note: null };
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
  const kind = kindOf(op.operation);
  const ver = [...events].reverse().find((e) => e.type === "verification_recorded");
  const okKeys = strings(ver?.payload["verified"]);
  const badKeys = strings(ver?.payload["notVerified"]);
  const expected = plan?.verification.expectInstalled ?? {};
  const dirSpecs = Array.isArray(plan?.detail["directories"]) ? (plan?.detail["directories"] as unknown[]) : [];
  const dirText = (path: string): string => {
    const d = dirSpecs.find((x): x is Record<string, unknown> => typeof x === "object" && x !== null && (x as Record<string, unknown>)["path"] === path);
    return d && typeof d["owner"] === "string" && typeof d["group"] === "string" && typeof d["mode"] === "string" ? `${path} (owner ${d["owner"]}:${d["group"]}, mode ${d["mode"]})` : path;
  };
  const line = (k: string): string =>
    kind === "directories" ? dirText(k) : kind === "restart" ? `${k} restarted` : kind === "reboot" ? `${serverName} rebooted` : expected[k] ? `${k} ${expected[k]}` : k;
  const total = okKeys.length + badKeys.length;
  const reboot = kind === "packages" && events.some((e) => e.payload["rebootRequired"] === true);
  const lastEffects = [...events].reverse().map((e) => e.payload["effects"]).find((v): v is string => typeof v === "string");
  const noun = kind === "directories" ? ["directory", "directories"] : ["package", "packages"];
  const word = (n: number): string => (n === 1 ? noun[0]! : noun[1]!);

  const changed: string[] = [];
  const verified: string[] = [];
  const stillNeeded: string[] = [];
  const couldNot: string[] = [];
  const mismatch = (k: string): string =>
    kind === "directories" ? `${line(k)}: it is missing or its owner, group or mode differs from the plan.`
    : kind === "restart" ? `${k}: it is not active, or its start time did not change.`
    : kind === "reboot" ? `${serverName}: the boot id did not change, or the server did not answer again.`
    : `${line(k)}: installed version does not match the plan.`;
  const okSummary = (all: boolean): string =>
    kind === "restart" ? "The service is active and its start time is new."
    : kind === "reboot" ? "The server answered again with a new boot id."
    : all ? `${kind === "directories" ? "Every directory exists as planned" : `Installed versions match the plan for all ${okKeys.length} ${word(okKeys.length)}`}.`
    : `${okKeys.length} of ${total} ${word(total)} match the plan.`;

  switch (state) {
    case "succeeded":
      changed.push(...okKeys.map(line));
      verified.push(okSummary(true));
      stillNeeded.push(reboot ? `Reboot ${serverName}. This needs its own plan and approval.` : "Nothing further for this operation.");
      break;
    case "partially_succeeded":
      changed.push(...okKeys.map(line));
      verified.push(okSummary(false));
      stillNeeded.push(`Review what did not match. A new plan is needed to retry it.`);
      couldNot.push(...badKeys.map(mismatch));
      break;
    case "failed":
      changed.push(lastEffects ?? "No changes were confirmed.");
      verified.push("Nothing was verified.");
      stillNeeded.push("Review the failure, then make a new plan when you are ready.");
      couldNot.push(...badKeys.map(mismatch));
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
    if (kind === "packages") {
      couldNot.push("Whether the services on this server still behave correctly. ServrSit checks installed package versions only.");
      if (!reboot) couldNot.push("Whether a reboot is needed.");
    } else if (kind === "restart") {
      couldNot.push("Whether the service behaves correctly after it started. ServrSit checks that it is active with a new start time.");
    } else if (kind === "reboot") {
      couldNot.push("Whether every service came back and works. ServrSit checks that the boot id is new.");
    } else {
      couldNot.push("Whether anything using these directories works. ServrSit checks that each exists with the approved owner, group and mode.");
    }
  }
  const title = state === "succeeded" && reboot ? "Completed and verified. A reboot is still needed." : null;
  return { title, receipt: { changed, verified, stillNeeded, couldNotVerify: couldNot } };
}

export function toOperationVM(view: OperationView, plan: PlanView | null, now: Date, tz: string, agesUncertain = false): OperationVM {
  const { operation: op, events } = view;
  const serverName = plan?.target.name ?? "this server";
  const state = op.state;
  const reboot = kindOf(op.operation) === "packages" && events.some((e) => e.payload["rebootRequired"] === true);
  const { title: receiptTitle, receipt } = buildReceipt(op, events, plan, serverName);
  const kind = kindOf(op.operation);
  const unit = typeof plan?.detail["unit"] === "string" ? (plan.detail["unit"] as string) : null;
  const stateLabel = LABEL[state].replace("{name}", serverName);
  const updated = parseIso(op.updatedAt);

  const what = { packages: "Packages are being installed.", restart: "The service is being restarted.", reboot: "The server is rebooting and will not answer for a while.", directories: "The directories are being created." }[kind];
  const checking = { packages: "The install step finished. ServrSit is now checking the installed versions.", restart: "The restart finished. ServrSit is now checking that the service is active with a new start time.", reboot: "ServrSit is waiting for the server to answer again and checking that its boot id is new. A server that has not answered yet is not treated as failed.", directories: "The create step finished. ServrSit is now checking each directory." }[kind];
  const done = { packages: "Every package matches the plan. Nothing left to babysit.", restart: "The service is active and its start time is new.", reboot: "The server answered again with a new boot id.", directories: "Every directory exists with the approved owner, group and mode." }[kind];
  const some = { packages: "Some packages were updated and confirmed. Others were not. They are listed separately below.", restart: "Part of the work was confirmed. What was not is listed below.", reboot: "Part of the work was confirmed. What was not is listed below.", directories: "Some directories were created and confirmed. Others were not. They are listed separately below." }[kind];
  const explanations: Record<OperationStateName, string> = {
    queued: "Approved. ServrSit is sending it to the server. Nothing has changed on the server yet.",
    running: `The server confirmed it started. ${what} This is not finished.`,
    verifying: `${checking} It is not complete until that check passes.`,
    succeeded: reboot ? "Installed versions match the plan. A reboot is still needed." : done,
    partially_succeeded: some,
    failed: "The operation did not complete. What is known about the server is listed below.",
    cancelled_before_start: "The operation was cancelled before anything was sent. The server was not changed.",
    outcome_unknown: `ServrSit lost track of this operation and cannot say whether it finished. Conflicting changes on ${serverName} are unavailable until the outcome is confirmed.`,
  };
  const title = kind === "restart" ? `Restart ${unit ?? "a service"} on ${serverName}`
    : kind === "reboot" ? `Reboot ${serverName}`
    : kind === "directories" ? `Create directories on ${serverName}`
    : `Update packages on ${serverName}`;

  return {
    id: op.id,
    planId: op.planId,
    state,
    stateLabel,
    badge: BADGE[state],
    title,
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
      visible: state === "queued" || state === "running" || op.stopRequested,
      label: state === "queued" ? "Cancel before it starts" : "Stop after this safe step",
      help: state === "queued" ? CANCEL_HELP : STOP_HELP,
      requested: op.stopRequested,
    },
    recheck: state === "outcome_unknown",
    updatedText: updated ? formatClockWithAge(updated, now, tz, agesUncertain) : "unknown",
  };
}
