/**
 * ClockContext: the control-plane clock state for every screen.
 *
 * Polls /api/fleet once a minute (the API serves a cache) and reads only
 * controlPlane.clock from the body, with a local copy of the contract shape
 * (see clockTypes.ts). A failed poll keeps the last known state rather than
 * hiding a problem. An API without controlPlane yields no banner.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clockBanner, parseClock, type ClockBannerView } from "./clockBanner";
import type { ControllerClockView } from "./clockTypes";

interface ClockState {
  readonly clock: ControllerClockView | null;
  readonly view: ClockBannerView | null;
}

const NONE: ClockState = { clock: null, view: null };
const ClockContext = createContext<ClockState>(NONE);

export const POLL_MS = 60_000;

export function ClockProvider({ children, fixed }: { children: ReactNode; /** For tests and the fixture page: skip polling. */ fixed?: ControllerClockView | null }) {
  const [clock, setClock] = useState<ControllerClockView | null>(fixed ?? null);

  useEffect(() => {
    if (fixed !== undefined) return;
    let stopped = false;
    let controller: AbortController | null = null;
    async function poll(): Promise<void> {
      controller = new AbortController();
      try {
        const r = await fetch("/api/fleet", { headers: { Accept: "application/json" }, cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!r.ok) return;
        const text = await r.text();
        if (text.length > 512 * 1024) return;
        const parsed = parseClock(JSON.parse(text));
        if (!stopped && parsed) setClock(parsed);
      } catch {
        /* keep the last known state */
      }
    }
    void poll();
    const t = globalThis.setInterval(() => void poll(), POLL_MS);
    return () => { stopped = true; controller?.abort(); globalThis.clearInterval(t); };
  }, [fixed]);

  const value = useMemo<ClockState>(() => ({ clock, view: clockBanner(clock) }), [clock]);
  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

export const useClock = (): ClockState => useContext(ClockContext);
