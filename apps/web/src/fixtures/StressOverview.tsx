/**
 * [FIXTURE DATA] /fixtures/overview?n=20&long=1 — the Overview on stress data:
 * n servers (0 to 20) and long names, roles and versions when long=1. Built
 * from synthetic /api/fleet-shaped data; the real Overview is untouched.
 */
import { useMemo } from "react";
import { initialFleetState } from "../api/fleetState";
import { OverviewScreen } from "../components/overview/index.js";
import { toOverviewVM } from "../components/overview/fleetViewModel.js";
import { usePageTitle } from "../lib/pageTitle";
import { stressFleet } from "./stressFleet";

export function StressOverview() {
  const q = new URLSearchParams(globalThis.location.search);
  const n = Math.min(20, Math.max(0, Number.parseInt(q.get("n") ?? "6", 10) || 0));
  const long = q.get("long") === "1";
  usePageTitle(`Overview stress fixture (${n} servers${long ? ", long names" : ""})`);
  const now = useMemo(() => new Date(), []);
  const vm = useMemo(() => toOverviewVM({ ...initialFleetState, phase: "ready", data: stressFleet(n, long, now), receivedAt: now.toISOString() }, now), [n, long, now]);
  return <OverviewScreen vm={vm} onRetry={() => undefined} />;
}
