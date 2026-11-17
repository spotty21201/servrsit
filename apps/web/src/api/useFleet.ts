/**
 * React hook for the fleet view. Designer wires this into the cards.
 *
 *   const fleet = useFleet();
 *   fleet.data    last good response (or null)
 *   fleet.error   most recent failure, shown next to fleet.data when both exist
 *   fleet.refresh()
 *
 * The API serves a cache and never contacts servers on request, so polling is
 * cheap. Default: every 30 seconds. Pass pollMs: 0 to disable polling.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { fetchFleet } from "./fleet";
import { fleetReducer, initialFleetState, type FleetState } from "./fleetState";

export const DEFAULT_POLL_MS = 30_000;

export interface UseFleetOptions {
  readonly pollMs?: number;
}

export type UseFleetResult = FleetState & { readonly refresh: () => void };

export function useFleet(options: UseFleetOptions = {}): UseFleetResult {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const [state, dispatch] = useReducer(fleetReducer, initialFleetState);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback((): void => {
    if (inFlight.current !== null) return;
    const controller = new AbortController();
    inFlight.current = controller;
    dispatch({ type: "request" });
    void fetchFleet({ signal: controller.signal }).then((result) => {
      if (inFlight.current === controller) inFlight.current = null;
      if (!result.ok && result.error.kind === "aborted") return;
      dispatch({ type: "result", result });
    });
  }, []);

  useEffect(() => {
    refresh();
    const timer = pollMs > 0 ? globalThis.setInterval(refresh, pollMs) : null;
    return () => {
      if (timer !== null) globalThis.clearInterval(timer);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [refresh, pollMs]);

  return { ...state, refresh };
}
