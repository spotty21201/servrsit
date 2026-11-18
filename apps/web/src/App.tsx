/**
 * App — root component (T-046)
 *
 * Renders the Overview from live /api/fleet data via Coder's useFleet() hook.
 * All API → view-model mapping happens in fleetViewModel.ts.
 * The [FIXTURE DATA] banner is decided there too (only if any card is
 * fixture-sourced), never hardcoded here.
 *
 * Relative times ("3 min ago") are computed at render. useFleet re-renders on
 * every poll (30 s), and a 30 s clock tick keeps them honest between polls
 * and while the API is down.
 */
import { useEffect, useState } from "react";
import { useFleet } from "./api/useFleet";
import { OverviewScreen } from "./components/overview/index.js";
import { toOverviewVM } from "./components/overview/fleetViewModel.js";
import { AuthGate } from "./auth/AuthGate";
import { matchRoute } from "./lib/router";
import { PlanScreen } from "./care/PlanScreen";
import { OperationScreen } from "./care/OperationScreen";

const CLOCK_TICK_MS = 30_000;

export default function App() {
  return (
    <AuthGate>
      <Routes />
    </AuthGate>
  );
}

function Routes() {
  const route = matchRoute(globalThis.location.pathname);
  if (route.name === "plan") return <PlanScreen planId={route.id} />;
  if (route.name === "operation") return <OperationScreen operationId={route.id} />;
  return <OverviewRoute />;
}

function OverviewRoute() {
  const fleet = useFleet();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = globalThis.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => globalThis.clearInterval(t);
  }, []);

  // Recompute "now" whenever new data arrives too.
  useEffect(() => {
    setNow(new Date());
  }, [fleet.receivedAt, fleet.error]);

  return <OverviewScreen vm={toOverviewVM(fleet, now)} onRetry={fleet.refresh} />;
}
