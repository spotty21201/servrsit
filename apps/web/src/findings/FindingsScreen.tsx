/**
 * FindingsScreen — T-070 at /findings (PRD FR-20, UX Spec §13.1, §13.2).
 *
 * Runs on the [FIXTURE] findings client (api/stubs/findings.ts): no findings
 * state API exists yet, so the [FIXTURE DATA] banner is always shown. A
 * fixture-only control previews the scheduler states.
 *
 * Each row: server (+ Production), severity, summary, state tag with text,
 * first/last observed with ages, and a sentence on what the state does and
 * does not mean. Acknowledge and Snooze are separate actions. Stage A keeps
 * findings in the app and says external alerts are unavailable.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createFixtureFindingsClient, type FindingRecord, type FindingsClient, type FindingsSnapshot, type FixtureScheduler, type SnoozeFor } from "../api/stubs/findings";
import { CareShell, ProductionLabel } from "../care/CareShell";
import { useClock } from "../clock/ClockContext";
import { DEFAULT_OWNER_TIME_ZONE } from "../lib/time";
import { usePageTitle } from "../lib/pageTitle";
import { SchedulerNotice } from "./SchedulerNotice";
import { schedulerNotice, sortFindings, summarise, toFindingVM, type FindingVM } from "./findingsViewModel";
import c from "../care/care.module.css";
import s from "./findings.module.css";

const SNOOZES: ReadonlyArray<{ id: SnoozeFor; label: string }> = [
  { id: "1h", label: "1 hour" },
  { id: "1d", label: "1 day" },
  { id: "1w", label: "1 week" },
];

const TAG_CLASS: Record<FindingVM["stateTag"], string | undefined> = { failed: c.tagBlocked, attention: c.tagOwner, unknown: c.tagUnknown, passed: c.tagMet, progress: c.tagProgress };

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

export function FindingsScreen({ client: injected }: { client?: FindingsClient }) {
  const [scenario, setScenario] = useState<FixtureScheduler>("running");
  const [snap, setSnap] = useState<FindingsSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  usePageTitle("Findings");
  const clockView = useClock().view;
  const holder = useMemo(() => ({ scenario: "running" as FixtureScheduler }), []);
  holder.scenario = scenario;
  const client = useMemo(() => injected ?? createFixtureFindingsClient(() => new Date(), () => holder.scenario), [injected, holder]);

  const load = useCallback(async () => {
    const r = await client.list();
    if (r.ok) { setSnap(r.data); setError(false); setNow(new Date()); } else setError(true);
  }, [client]);
  useEffect(() => { void load(); }, [load, scenario]);

  async function act(p: Promise<{ ok: boolean }>): Promise<void> {
    setBusy(true); setProblem(null);
    const r = await p;
    if (!r.ok) setProblem("That didn't go through. Nothing was changed.");
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
    <CareShell fixture section="Findings">
      <header className={c.header}>
        <h1 className={c.title}>Findings</h1>
        <p className={c.small}>Issues ServrSit found on your servers. Stage A keeps them here in the app. External alerts such as email are not available yet.</p>
      </header>

      {notice && <SchedulerNotice notice={notice} />}
      {error && <div className={`${c.notice} ${c.noticeFailed}`} role="alert"><p className={c.noticeTitle}>Couldn&rsquo;t load findings</p><p>Nothing is shown until real data arrives.</p></div>}
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

      <fieldset className={s.preview}>
        <legend>Fixture preview: scheduler state</legend>
        <p className={c.small}>[FIXTURE DATA] This control exists only to review the states below. It does not change any real scheduler.</p>
        <div className={s.choices}>
          {(["running", "paused", "delayed", "unavailable"] as const).map((v) => (
            <label key={v} className={s.choice}><input type="radio" name="sched" checked={scenario === v} onChange={() => setScenario(v)} /><span>{v === "running" ? "Running normally" : v === "paused" ? "Checks paused" : v === "delayed" ? "Check delayed" : "Scheduler unavailable"}</span></label>
          ))}
        </div>
      </fieldset>
    </CareShell>
  );
}
