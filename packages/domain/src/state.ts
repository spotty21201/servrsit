/**
 * Operation state machine (Technical Spec §11). Eight states.
 *
 *   queued        -> running | cancelled_before_start | failed (rejected, no remote work) | outcome_unknown
 *   running       -> verifying | failed | outcome_unknown
 *   verifying     -> succeeded | partially_succeeded | failed | outcome_unknown
 *   outcome_unknown -> running | verifying | succeeded | partially_succeeded | failed | cancelled_before_start
 *                      ONLY through a "reconciled" event carrying remote-ledger evidence
 *   final states  -> nothing (later evidence is appended as an event, never a new state)
 *
 * Every change is an appended event. `stop_requested` is a flag, not a state.
 */

import {
  FINAL_OPERATION_STATES,
  OperationState,
  UNRESOLVED_OPERATION_STATES,
} from "@servrsit/contracts";

export type OpState = OperationState;

export const EVENT_TYPES = [
  "created",
  "dispatch_attempted",
  "remote_accepted",
  "remote_rejected",
  "transport_error",
  "remote_progress",
  "remote_finished",
  "verification_recorded",
  "outcome_unknown",
  "reconciled",
  "cancelled",
  "stop_requested",
  "evidence_appended",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const NORMAL: Readonly<Record<OpState, readonly OpState[]>> = {
  queued: ["running", "cancelled_before_start", "failed", "outcome_unknown"],
  running: ["verifying", "failed", "outcome_unknown"],
  verifying: ["succeeded", "partially_succeeded", "failed", "outcome_unknown"],
  outcome_unknown: [],
  succeeded: [],
  partially_succeeded: [],
  failed: [],
  cancelled_before_start: [],
};

const FROM_UNKNOWN_BY_RECONCILIATION: readonly OpState[] = [
  "running",
  "verifying",
  "succeeded",
  "partially_succeeded",
  "failed",
  "cancelled_before_start",
];

export class TransitionError extends Error {
  constructor(from: OpState, to: OpState, event: EventType) {
    super(`transition ${from} -> ${to} via ${event} is not allowed`);
    this.name = "TransitionError";
  }
}

export function isFinal(state: OpState): boolean {
  return FINAL_OPERATION_STATES.has(state);
}

export function isUnresolved(state: OpState): boolean {
  return UNRESOLVED_OPERATION_STATES.has(state);
}

/** Throws unless `from -> to` is allowed for this event type. */
export function assertTransition(from: OpState, to: OpState, event: EventType): void {
  if (isFinal(from)) throw new TransitionError(from, to, event);
  if (from === "outcome_unknown") {
    if (event === "reconciled" && FROM_UNKNOWN_BY_RECONCILIATION.includes(to)) return;
    throw new TransitionError(from, to, event);
  }
  if (!NORMAL[from].includes(to)) throw new TransitionError(from, to, event);
  if (to === "cancelled_before_start" && event !== "cancelled" && event !== "reconciled") {
    throw new TransitionError(from, to, event);
  }
}

export const ALL_STATES: readonly OpState[] = Object.values(OperationState);
