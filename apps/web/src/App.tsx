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
import { usePageTitle } from "./lib/pageTitle";
import { RouteAnnouncer } from "./lib/RouteAnnouncer";
import { AuthGate } from "./auth/AuthGate";
import { ClockProvider, useClock } from "./clock/ClockContext";
import { FixtureClockPage } from "./clock/FixtureClockPage";
import { matchRoute } from "./lib/router";
import { ActivityScreen } from "./activity/ActivityScreen";
import { FindingsScreen } from "./findings/FindingsScreen";
import { ConnectScreen } from "./connect/ConnectScreen";
import { ServerDetailScreen } from "./servers/ServerDetailScreen";
import { PlanScreen } from "./care/PlanScreen";
import { OperationScreen } from "./care/OperationScreen";

const CLOCK_TICK_MS = 30_000;

export default function App() {
  return (
    <>
    <RouteAnnouncer />
    <AuthGate>
      <ClockProvider>
        <Routes />
      </ClockProvider>
    </AuthGate>
    </>
  );
}

function Routes() {
  const route = matchRoute(globalThis.location.pathname);
  if (route.name === "fixtureClock") return <FixtureClockPage />;
  if (route.name === "activity") return <ActivityScreen />;
  if (route.name === "findings") return <FindingsScreen />;
  if (route.name === "connect") return <ConnectScreen />;
  if (route.name === "server") return <ServerDetailScreen serverId={route.id} section={route.section} />;
  if (route.name === "plan") return <PlanScreen planId={route.id} />;
  if (route.name === "operation") return <OperationScreen operationId={route.id} />;
  return <OverviewRoute />;
}

function OverviewRoute() {
  const fleet = useFleet();
  const { view: clockView } = useClock();
  usePageTitle(fleet.phase === "loading" ? "Loading your servers" : "Overview", fleet.phase !== "loading");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = globalThis.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => globalThis.clearInterval(t);
  }, []);

  // Recompute "now" whenever new data arrives too.
  useEffect(() => {
    setNow(new Date());
  }, [fleet.receivedAt, fleet.error]);

  return <OverviewScreen vm={toOverviewVM(fleet, now, clockView?.agesUncertain ?? false)} onRetry={fleet.refresh} />;
}
