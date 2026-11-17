/**
 * State machine for the fleet view. Pure, so it can be tested without React.
 *
 * Rule: a failed refresh never discards the last good data. The state keeps
 * both, so the UI can show the failure alongside what was last known, and can
 * label that data by its own observation times.
 */

import type { FleetResponse } from "@servrsit/contracts";
import type { FleetError, FleetResult } from "./fleet";

export interface FleetState {
  /** "loading": nothing yet. "ready": have data (possibly with a newer error). "error": no data and failing. */
  readonly phase: "loading" | "ready" | "error";
  /** The last successfully received and validated response. */
  readonly data: FleetResponse | null;
  /** When `data` was received by this browser (ISO-8601). */
  readonly receivedAt: string | null;
  /** The most recent failure, cleared by the next success. */
  readonly error: FleetError | null;
  /** True while a request is in flight. */
  readonly refreshing: boolean;
}

export const initialFleetState: FleetState = {
  phase: "loading",
  data: null,
  receivedAt: null,
  error: null,
  refreshing: false,
};

export type FleetAction =
  | { readonly type: "request" }
  | { readonly type: "result"; readonly result: FleetResult };

export function fleetReducer(state: FleetState, action: FleetAction): FleetState {
  if (action.type === "request") return { ...state, refreshing: true };

  const { result } = action;
  if (result.ok) {
    return { phase: "ready", data: result.data, receivedAt: result.receivedAt, error: null, refreshing: false };
  }
  // A cancelled request is not a failure of the service.
  if (result.error.kind === "aborted") return { ...state, refreshing: false };
  return {
    ...state,
    phase: state.data === null ? "error" : "ready",
    error: result.error,
    refreshing: false,
  };
}
