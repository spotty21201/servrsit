/**
 * OperationScreen — UX-08 Operation detail at /operations/:id (UX Spec §11).
 *
 * Top to bottom: title + Production label, the state in UX §11 wording with a
 * plain explanation, controls, a vertical step list with real times, the
 * completion receipt (changed / verified / still needed / could not verify),
 * and an expandable dark read-only transcript.
 *
 * Honesty rules:
 *   - No progress percentages. Steps and recorded times only.
 *   - Only the state `succeeded` reads as completed and verified.
 *   - "Stop after this safe step" is a request, not an undo. The API has no
 *     stop endpoint yet, so the control is shown disabled with that reason
 *     (and shows "requested" when the record says a stop was requested).
 *   - Unresolved operations are polled every 3 s; the live region only
 *     announces state changes, not each poll or log line.
 *
 * Fixture ids (fixture-op-…) use createFixtureClient and show [FIXTURE DATA].
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchFleet } from "../api/fleet";
import { useClock } from "../clock/ClockContext";
import { createCareClient, type CareClient, type OperationView, type PlanView } from "../api/stubs/care";
import { DEFAULT_OWNER_TIME_ZONE, resolveTimeZone } from "../lib/time";
import { planPath } from "../lib/router";
import { usePageTitle } from "../lib/pageTitle";
import { StatusBadge } from "../components/StatusBadge/index.js";
import { CareShell, LoadFailure, ProductionLabel, SimulatedLabel } from "./CareShell";
import { createFixtureClient, fixturePlanFor, isFixtureId } from "./fixtures";
import { STEP_STATUS_TEXT, toOperationVM, type StepStatus, type StepVM, type TranscriptLine } from "./operationViewModel";
import styles from "./care.module.css";

const POLL_MS = 3000;
const TICK_MS = 15_000;

function StepIcon({ status }: { status: StepStatus }) {
  const common = { width: 12, height: 12, viewBox: "0 0 8 8", shapeRendering: "crispEdges" as const, "aria-hidden": true, focusable: false };
  switch (status) {
    case "done":
      return <svg {...common}><rect x="1" y="4" width="2" height="1" fill="currentColor" /><rect x="2" y="5" width="2" height="1" fill="currentColor" /><rect x="3" y="3" width="1" height="2" fill="currentColor" /><rect x="4" y="2" width="1" height="2" fill="currentColor" /><rect x="5" y="1" width="2" height="1" fill="currentColor" /></svg>;
    case "failed":
      return <svg {...common}><rect x="1" y="1" width="2" height="2" fill="currentColor" /><rect x="5" y="1" width="2" height="2" fill="currentColor" /><rect x="3" y="3" width="2" height="2" fill="currentColor" /><rect x="1" y="5" width="2" height="2" fill="currentColor" /><rect x="5" y="5" width="2" height="2" fill="currentColor" /></svg>;
    case "unknown":
      return <svg {...common}><rect x="2" y="0" width="4" height="1" fill="currentColor" /><rect x="5" y="1" width="1" height="2" fill="currentColor" /><rect x="3" y="3" width="2" height="1" fill="currentColor" /><rect x="3" y="4" width="1" height="1" fill="currentColor" /><rect x="3" y="6" width="1" height="1" fill="currentColor" /></svg>;
    case "current":
      return <svg {...common}><rect x="2" y="2" width="4" height="4" fill="currentColor" /></svg>;
    default:
      return <svg {...common}><rect x="3" y="3" width="2" height="2" fill="currentColor" /></svg>;
  }
}

const STEP_CLASS: Record<StepStatus, string | undefined> = {
  done: styles.sDone, current: styles.sCurrent, failed: styles.sFailed, unknown: styles.sUnknown, pending: styles.sPending, "not-started": styles.sPending,
};

function Steps({ steps }: { steps: readonly StepVM[] }) {
  return (
    <ol className={styles.steps}>
      {steps.map((s) => (
        <li key={s.id} className={styles.step} aria-current={s.status === "current" ? "step" : undefined}>
          <span className={`${styles.stepIcon} ${STEP_CLASS[s.status] ?? ""}`}><StepIcon status={s.status} /></span>
          <div className={styles.stepBody}>
            <span className={styles.stepTitle}>{s.title}</span>
            <span className={styles.stepMeta}>
              <strong className={STEP_CLASS[s.status]}>{STEP_STATUS_TEXT[s.status]}</strong>
              {s.startedAt && <span>from <span className={styles.mono}>{s.startedAt}</span></span>}
              {s.endedAt && <span>{s.startedAt ? "to" : "at"} <span className={styles.mono}>{s.endedAt}</span></span>}
            </span>
            {s.note && <span className={styles.small}>{s.note}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Dark, read-only event log. Follows new lines only while the reader is at the end. */
function Transcript({ lines, zoneNote }: { lines: readonly TranscriptLine[]; zoneNote: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const [away, setAway] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  function onScroll(): void {
    const el = ref.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    following.current = atEnd;
    setAway(!atEnd);
  }

  return (
    <div className={styles.transcriptWrap}>
      <p className={styles.small}>Event log, read-only, times in {zoneNote}. Remote command output is not captured yet, so this shows ServrSit&rsquo;s own recorded events.</p>
      {/* The log role sits on a div; the list inside keeps its own list semantics (D-U7). */}
      <div ref={ref} className={styles.transcript} role="log" aria-live="off" aria-label="Operation event log, read-only" tabIndex={0} onScroll={onScroll}>
        <ul className={styles.transcriptList}>
          {lines.map((l) => (
            <li key={l.seq}><span className={styles.tTime}>{l.time}</span><span>{l.text}</span></li>
          ))}
          {lines.length === 0 && <li><span className={styles.tTime}>--:--:--</span><span>No events recorded yet.</span></li>}
        </ul>
      </div>
      {away && (
        <button type="button" className={`${styles.secondary} ${styles.jump}`} onClick={() => {
          const el = ref.current;
          if (el) { el.scrollTop = el.scrollHeight; following.current = true; setAway(false); }
        }}>Jump to latest</button>
      )}
    </div>
  );
}

export function OperationScreen({ operationId, client: injected }: { operationId: string; client?: CareClient }) {
  const fixture = isFixtureId(operationId);
  const client = useMemo(() => injected ?? (fixture ? createFixtureClient() : createCareClient()), [injected, fixture]);
  const [tz, setTz] = useState(DEFAULT_OWNER_TIME_ZONE);
  const [view, setView] = useState<OperationView | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [error, setError] = useState<"missing" | "failed" | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const planTried = useRef<string | null>(null);
  const stopHelpId = useId();
  const clockView = useClock().view;

  useEffect(() => {
    if (fixture) return;
    const c = new AbortController();
    void fetchFleet({ signal: c.signal }).then((r) => { if (r.ok) setTz(resolveTimeZone(r.data.ownerTimeZone)); });
    return () => c.abort();
  }, [fixture]);

  const load = useCallback(async () => {
    const r = await client.getOperation(operationId);
    if (r.ok) {
      setView(r.data);
      setError(null);
      setRefreshError(false);
      setNow(new Date());
    } else if (r.kind === "http" && r.status === 404) {
      setError("missing");
    } else {
      setRefreshError(true);
      setError((cur) => cur ?? "failed");
    }
  }, [client, operationId]);

  useEffect(() => { void load(); }, [load]);

  const state = view?.operation.state;
  const unresolved = state === "queued" || state === "running" || state === "verifying" || state === "outcome_unknown";
  useEffect(() => {
    if (!unresolved || fixture) return;
    const t = globalThis.setInterval(() => void load(), POLL_MS);
    return () => globalThis.clearInterval(t);
  }, [unresolved, fixture, load]);
  useEffect(() => {
    const t = globalThis.setInterval(() => setNow(new Date()), TICK_MS);
    return () => globalThis.clearInterval(t);
  }, []);

  // The plan gives the server name, production flag and expected versions.
  const planId = view ? (fixture ? fixturePlanFor(operationId) : view.operation.planId) : null;
  useEffect(() => {
    if (!planId || planTried.current === planId) return;
    planTried.current = planId;
    void client.getPlan(planId).then((r) => { if (r.ok) setPlan(r.data); });
  }, [client, planId]);

  const vm = view ? toOperationVM(view, plan, now, tz, clockView?.agesUncertain ?? false) : null;
  usePageTitle(vm ? `${vm.title}: ${vm.stateLabel}` : error ? "Operation not available" : "Loading the operation", vm !== null || error !== null);

  return (
    <CareShell fixture={fixture} section="Operation">
      {error === "missing" && <LoadFailure title="Operation not found" text="There is no operation with this id." />}
      {error === "failed" && !view && <LoadFailure title="Couldn't load the operation" text="The ServrSit API did not return a usable record. This does not tell you whether the operation ran." onRetry={() => void load()} />}
      {!view && !error && <><h1 className={styles.title}>Operation</h1><p className={styles.p} role="status">Loading the operation…</p></>}

      {vm && (
        <>
          <header className={styles.header}>
            <h1 className={styles.title}>{vm.title}</h1>
            <div className={styles.chips}>
              {vm.isProduction && <ProductionLabel />}
              {vm.simulated && <SimulatedLabel />}
              <StatusBadge state={vm.badge} label={vm.stateLabel} />
            </div>
            <p className={styles.meta}>
              <span>Target: <strong>{vm.serverName}</strong></span>
              <span>Updated {vm.updatedText}</span>
              <span><a href={planPath(vm.planId)}>View the approved plan</a></span>
            </p>
          </header>

          {refreshError && (
            <div className={`${styles.notice} ${styles.noticeUnknown}`} role="alert">
              <p className={styles.noticeTitle}>Couldn&rsquo;t refresh</p>
              <p>The last update failed, so this page may be behind. It shows the last record received.</p>
            </div>
          )}

          <section className={`${styles.panel} ${styles.panelAccent}`} aria-labelledby="op-state">
            <h2 id="op-state" className={styles.h2}>{vm.headline}</h2>
            <div role="status" aria-live="polite" className={styles.p}>{vm.explanation}</div>

            {vm.stop.visible && (
              <div className={styles.stack}>
                <button type="button" className={styles.secondary} disabled aria-describedby={stopHelpId}>{vm.stop.label}</button>
                <p id={stopHelpId} className={styles.small}>
                  {vm.stop.requested
                    ? "Stop requested. ServrSit will stop after the current safe step. It has not stopped yet."
                    : `${vm.stop.help} Stop requests are not connected to the API yet.`}
                </p>
              </div>
            )}
            {vm.recheck && (
              <div className={styles.stack}>
                <button type="button" className={styles.secondary} onClick={() => void load()}>Recheck outcome</button>
                <p className={styles.small}>This looks up the record again. It does not run anything on the server.</p>
              </div>
            )}
            {vm.state === "queued" && <p className={styles.small}>Cancelling before start is not connected to the API yet.</p>}
          </section>

          <div className={`${styles.layout} ${styles.layoutOp}`}>
            <section className={styles.panel} aria-labelledby="op-steps">
              <h2 id="op-steps" className={styles.h2}>Steps</h2>
              <Steps steps={vm.steps} />
              <p className={styles.small}>Times are {tz}. No percentage is shown because the server reports none.</p>
            </section>

            <div className={styles.stack}>
              {vm.receipt ? (
                <section className={styles.panel} aria-labelledby="op-receipt">
                  <h2 id="op-receipt" className={styles.h2}>{vm.receiptTitle}</h2>
                  <div className={styles.receiptGrid}>
                    <div className={styles.receiptBlock}><h3>What changed</h3><ul className={`${styles.list} ${styles.bullets}`}>{vm.receipt.changed.map((t) => <li key={t}>{t}</li>)}</ul></div>
                    <div className={styles.receiptBlock}><h3>What was verified</h3><ul className={`${styles.list} ${styles.bullets}`}>{vm.receipt.verified.map((t) => <li key={t}>{t}</li>)}</ul></div>
                    <div className={styles.receiptBlock}><h3>Still needed</h3><ul className={`${styles.list} ${styles.bullets}`}>{vm.receipt.stillNeeded.map((t) => <li key={t}>{t}</li>)}</ul></div>
                    <div className={styles.receiptBlock}><h3>Could not verify</h3>
                      {vm.receipt.couldNotVerify.length > 0
                        ? <ul className={`${styles.list} ${styles.bullets}`}>{vm.receipt.couldNotVerify.map((t) => <li key={t}>{t}</li>)}</ul>
                        : <p className={styles.small}>Nothing beyond what is stated above.</p>}
                    </div>
                  </div>
                </section>
              ) : (
                <section className={styles.panel} aria-labelledby="op-receipt">
                  <h2 id="op-receipt" className={styles.h2}>Receipt</h2>
                  <p className={styles.p}>The receipt appears when the operation reaches a final state. Until then nothing is reported as done.</p>
                </section>
              )}

              <section className={styles.panel} aria-labelledby="op-log">
                <details className={styles.details} style={{ borderTop: 0, paddingTop: 0 }}>
                  <summary id="op-log">Transcript ({vm.transcript.length} event{vm.transcript.length === 1 ? "" : "s"})</summary>
                  <Transcript lines={vm.transcript} zoneNote={tz} />
                </details>
              </section>
            </div>
          </div>
        </>
      )}
    </CareShell>
  );
}
