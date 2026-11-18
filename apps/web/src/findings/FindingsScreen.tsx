/**
 * FindingsScreen — T-070 at /findings (PRD FR-20, UX Spec §13.1, §13.2).
 *
 * Runs on Coder's real findings client (api/findings.ts, T-076). The
 * [FIXTURE DATA] banner appears when the API says its records are fixtures
 * (`mode: "fixture"`), and always on /fixtures/findings, which uses the
 * in-memory fixture client and a control to preview the scheduler states.
 *
 * Each row: server (+ Production), severity, summary, state tag with text,
 * first/last observed with ages, and a sentence on what the state does and
 * does not mean. Acknowledge and Snooze are separate actions. Pause and
 * resume are on the scheduler line, and a paused scheduler is never an
 * all-clear. External alerts say what the API says about them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createFindingsClient, type FindingRecord, type FindingsClient, type FindingsClientError, type FindingsResponse, type SchedulerStatus, type SnoozeFor } from "../api/findings";
import { createFixtureFindingsClient, type FixtureScheduler } from "../fixtures/findingsFixture";
import { CareShell, LoadFailure, ProductionLabel } from "../care/CareShell";
import { useClock } from "../clock/ClockContext";
import { DEFAULT_OWNER_TIME_ZONE, formatClock, formatClockWithAge, parseIso } from "../lib/time";
import { usePageTitle } from "../lib/pageTitle";
import { SchedulerNotice } from "./SchedulerNotice";
import { actionErrorText, schedulerNotice, sortFindings, summarise, toFindingVM, type FindingVM } from "./findingsViewModel";
import c from "../care/care.module.css";
import s from "./findings.module.css";

const SNOOZES: ReadonlyArray<{ id: SnoozeFor; label: string }> = [
  { id: "1h", label: "1 hour" },
  { id: "1d", label: "1 day" },
  { id: "1w", label: "1 week" },
];

const TAG_CLASS: Record<FindingVM["stateTag"], string | undefined> = { failed: c.tagBlocked, attention: c.tagOwner, unknown: c.tagUnknown, passed: c.tagMet, progress: c.tagProgress };

function SchedulerLine({ status, busy, now, onPause, onResume }: { status: SchedulerStatus; busy: boolean; now: Date; onPause: () => void; onResume: () => void }) {
  const next = status.status === "running" ? parseIso(status.nextRunAt) : null;
  return (
    <div className={s.schedule}>
      {status.status === "running" && (
        <>
          <p className={c.small}>Checks are running{next ? `. Next check ${formatClock(next, now, DEFAULT_OWNER_TIME_ZONE)}` : ""}. While paused, nothing is checked, and a quiet list is not an all-clear.</p>
          <button type="button" className={c.secondary} disabled={busy} onClick={onPause}>Pause checks</button>
        </>
      )}
      {status.status === "paused" && <button type="button" className={c.primary} disabled={busy} onClick={onResume}>Resume checks</button>}
    </div>
  );
}

function Row({ f, busy, onAck, onSnooze }: { f: FindingVM; busy: boolean; onAck: () => void; onSnooze: (d: SnoozeFor) => void }) {
  return (
    <li className={`${s.row} ${f.active ? "" : s.earlier}`}>
      <div className={s.rowHead}>
        <span className={`${c.stateTag} ${TAG_CLASS[f.stateTag] ?? ""}`}>{f.stateLabel}</span>
        <span className={s.sev}>{f.severityLabel}</span>
        <span className={s.server}>{f.serverName}</span>
        {f.production && <ProductionLabel />}
      </div>
      <p className={s.summary}>{f.summary}</p>
      <p className={s.times}><span>{f.firstObserved}</span><span>{f.lastObserved}</span></p>
      <p className={s.note}>{f.stateNote}</p>
      {(f.canAcknowledge || f.canSnooze) && (
        <div className={s.actions}>
          {f.canAcknowledge && <button type="button" className={c.secondary} disabled={busy} onClick={onAck}>Acknowledge</button>}
          {f.canSnooze && (
            <div role="group" aria-label={`Snooze: ${f.summary}`} className={s.snooze}>
              <span className={s.snoozeLabel}>Snooze for</span>
              {SNOOZES.map((o) => <button key={o.id} type="button" className={c.secondary} disabled={busy} onClick={() => onSnooze(o.id)}>{o.label}</button>)}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function FindingsScreen({ client: injected, fixture = false }: { client?: FindingsClient; fixture?: boolean }) {
  const [scenario, setScenario] = useState<FixtureScheduler>("running");
  const [snap, setSnap] = useState<FindingsResponse | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  usePageTitle("Findings");
  const clockView = useClock().view;
  const holder = useMemo(() => ({ scenario: "running" as FixtureScheduler }), []);
  holder.scenario = scenario;
  const client = useMemo(
    () => injected ?? (fixture ? createFixtureFindingsClient(() => new Date(), () => holder.scenario, setScenario) : createFindingsClient()),
    [injected, fixture, holder],
  );

  const load = useCallback(async () => {
    const r = await client.list();
    if (r.ok) { setSnap(r.data); setError(false); setNow(new Date()); } else setError(true);
  }, [client]);
  useEffect(() => { void load(); }, [load, scenario]);

  async function act(p: Promise<{ ok: true } | { ok: false; error: FindingsClientError }>): Promise<void> {
    setBusy(true); setProblem(null);
    const r = await p;
    if (!r.ok) setProblem(actionErrorText(r.error));
    await load();
    setBusy(false);
  }

  const uncertain = clockView?.agesUncertain ?? false;
  const list = snap ? sortFindings(snap.findings.map((f: FindingRecord) => toFindingVM(f, now, DEFAULT_OWNER_TIME_ZONE, uncertain))) : [];
  const sum = summarise(list);
  const notice = snap ? schedulerNotice(snap.scheduler, now, DEFAULT_OWNER_TIME_ZONE, uncertain) : null;
  const active = list.filter((f) => f.active);
  const earlier = list.filter((f) => !f.active);

  return (
    <CareShell fixture={fixture || snap?.mode === "fixture"} section="Findings">
      <header className={c.header}>
        <h1 className={c.title}>Findings</h1>
        <p className={c.small}>Issues ServrSit found on your servers. Stage A keeps them here in the app. {snap && !snap.externalAlerts.available ? snap.externalAlerts.reason : "External alerts such as email are not available yet."}</p>
      </header>

      {notice && <SchedulerNotice notice={notice} />}
      {snap && <SchedulerLine status={snap.scheduler} busy={busy} now={now} onPause={() => void act(client.pause())} onResume={() => void act(client.resume())} />}
      {error && snap && <div className={`${c.notice} ${c.noticeAttention}`} role="status"><p>ServrSit could not refresh this list. It shows what was loaded {formatClockWithAge(now, new Date(), DEFAULT_OWNER_TIME_ZONE, uncertain)}, which may be out of date.</p><button type="button" className={c.secondary} onClick={() => void load()}>Try again</button></div>}
      {error && !snap && <LoadFailure title="Couldn't load findings" text="Nothing is shown until real data arrives. This does not mean there are no findings." onRetry={() => void load()} heading={false} />}
      {!snap && !error && <p className={c.p} role="status">Loading findings…</p>}
      {problem && <div className={`${c.notice} ${c.noticeFailed}`} role="alert"><p>{problem}</p></div>}

      {snap && (
        <>
          <p className={c.p} role="status">{sum.text}{notice ? " Checking is not running normally, so this is not an all-clear." : ""}</p>
          <section className={c.panel} aria-labelledby="f-open">
            <h2 id="f-open" className={c.h2}>Open</h2>
            {active.length === 0 ? <p className={c.p}>Nothing open. Only the checks that ran are covered.</p> : (
              <ul className={s.list}>{active.map((f) => <Row key={f.id} f={f} busy={busy} onAck={() => void act(client.acknowledge(f.id))} onSnooze={(d) => void act(client.snooze(f.id, d))} />)}</ul>
            )}
          </section>
          <section className={c.panel} aria-labelledby="f-earlier">
            <h2 id="f-earlier" className={c.h2}>Earlier</h2>
            {earlier.length === 0 ? <p className={c.p}>Nothing earlier.</p> : (
              <ul className={s.list}>{earlier.map((f) => <Row key={f.id} f={f} busy={busy} onAck={() => undefined} onSnooze={() => undefined} />)}</ul>
            )}
          </section>
        </>
      )}

      {fixture && <fieldset className={s.preview}>
        <legend>Fixture preview: scheduler state</legend>
        <p className={c.small}>[FIXTURE DATA] This control exists only to review the states below. It does not change any real scheduler.</p>
        <div className={s.choices}>
          {(["running", "paused", "delayed", "unavailable"] as const).map((v) => (
            <label key={v} className={s.choice}><input type="radio" name="sched" checked={scenario === v} onChange={() => setScenario(v)} /><span>{v === "running" ? "Running normally" : v === "paused" ? "Checks paused" : v === "delayed" ? "Check delayed" : "Scheduler unavailable"}</span></label>
          ))}
        </div>
      </fieldset>}
    </CareShell>
  );
}
