/**
 * BaselineScreen — UX-09 Baseline compare and prepare a server at /baselines
 * (UX Spec §12, PRD FR-09 and FR-15).
 *
 *   1 Choose reference    role and observation age; the reference is evidence
 *                         for a proposed baseline, not a source for a clone
 *   2 Select conventions  checkboxes for directories and Ubuntu packages;
 *                         nothing sensitive or machine-specific is eligible
 *   3 Compare target      Matches / Missing / Different by design / Conflict /
 *                         Not checked; Mark intentional (record only)
 *   4 Review plan         what a setup would do and never touch, then the
 *                         canonical Plan review (/plans/:id)
 *
 * Runs on the [FIXTURE] baselines client (api/stubs/baselines.ts), so the
 * [FIXTURE DATA] banner is always shown. Nothing here changes a server. A setup
 * plan for a real host opens blocked by writesEnabled=false on the same Plan
 * review screen used for updates.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createFixtureBaselinesClient, type Baseline, type BaselineServer, type BaselinesClient, type Candidate, type ComparisonRow, type HistoryEvent } from "../api/stubs/baselines";
import { CareShell, ProductionLabel } from "../care/CareShell";
import { ReasonButton } from "../auth/AuthFrame";
import { useClock } from "../clock/ClockContext";
import { usePageTitle } from "../lib/pageTitle";
import { planPath } from "../lib/router";
import { DEFAULT_OWNER_TIME_ZONE, formatClockWithAge, parseIso } from "../lib/time";
import { WRITES_OFF_TEXT } from "../care/planViewModel";
import {
  canMarkIntentional, describeSetup, EXCLUSION_STATEMENT, groupRows, referenceAge, SAVE_NOTE, setupScope, splitCandidates, STATUS_LABEL, STATUS_TONE,
  summaryText, validateBaselineName,
} from "./baselineLogic";
import c from "../care/care.module.css";
import s from "../servers/servers.module.css";
import b from "./baselines.module.css";

const STEPS = ["Choose reference", "Select conventions", "Compare target", "Review plan"] as const;
const TONE = { passed: c.tagMet, attention: c.tagOwner, failed: c.tagBlocked, unknown: c.tagUnknown, progress: c.tagProgress } as const;

function Row({ r, busy, onMark, onUnmark }: { r: ComparisonRow; busy: boolean; onMark: (reason: string) => void; onUnmark: () => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <li className={b.row}>
      <div className={b.rowHead}>
        <span className={`${c.stateTag} ${TONE[STATUS_TONE[r.status]]}`}>{STATUS_LABEL[r.status]}</span>
        <span className={b.kind}>{r.kind === "directory" ? "Directory" : "Package"}</span>
        <strong className={b.label}>{r.label}</strong>
      </div>
      <p className={b.line}><span className={b.k}>Baseline expects</span> {r.expected}</p>
      <p className={b.line}><span className={b.k}>This server</span> {r.found ?? "—"}</p>
      <p className={b.line}>{r.reason}{r.intentional && <> {r.intentional.reason ? `Reason: ${r.intentional.reason}.` : "No reason was given."}</>}</p>
      {canMarkIntentional(r.status) && !open && (
        <button type="button" className={c.secondary} onClick={() => setOpen(true)} aria-label={`Mark ${r.label} intentional`}>Mark intentional</button>
      )}
      {open && (
        <div className={b.mark} role="group" aria-label={`Mark ${r.label} intentional`}>
          <label htmlFor={`${id}-why`} className={b.k}>Reason (optional)</label>
          <input id={`${id}-why`} type="text" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
          <p className={c.small}>This changes the exception record for this machine only. It does not change the server.</p>
          <div className={c.row}>
            <button type="button" className={c.primary} disabled={busy} onClick={() => { onMark(reason); setOpen(false); setReason(""); }}>Save as intentional</button>
            <button type="button" className={c.secondary} onClick={() => { setOpen(false); setReason(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {r.status === "different-by-design" && <button type="button" className={c.secondary} disabled={busy} onClick={onUnmark} aria-label={`Remove the intentional mark from ${r.label}`}>Remove the mark</button>}
    </li>
  );
}

export function BaselineScreen({ client: injected }: { client?: BaselinesClient }) {
  const client = useMemo(() => injected ?? createFixtureBaselinesClient(), [injected]);
  const ids = useId();
  const tz = DEFAULT_OWNER_TIME_ZONE;
  const uncertain = useClock().view?.agesUncertain ?? false;
  const [now, setNow] = useState(() => new Date());
  const [step, setStep] = useState(0);
  const [servers, setServers] = useState<readonly BaselineServer[]>([]);
  const [referenceId, setReferenceId] = useState("");
  const [candidates, setCandidates] = useState<readonly Candidate[]>([]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [targetId, setTargetId] = useState("");
  const [rows, setRows] = useState<readonly ComparisonRow[] | null>(null);
  const [history, setHistory] = useState<readonly HistoryEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const shown = useRef(0);

  usePageTitle(`Baselines: step ${step + 1} of 4, ${STEPS[step]}`);
  useEffect(() => { if (shown.current !== step) titleRef.current?.focus(); shown.current = step; }, [step]);
  useEffect(() => { void client.listServers().then((r) => { if (r.ok) { setServers(r.data); setNow(new Date()); } else setProblem("Couldn't load servers. Nothing is shown until real data arrives."); }); }, [client]);

  const reference = servers.find((x) => x.id === referenceId) ?? null;
  const target = servers.find((x) => x.id === targetId) ?? null;
  const { eligible, ineligible } = splitCandidates(candidates);
  const groups = rows ? groupRows(rows) : null;
  const scope = rows ? setupScope(rows) : null;
  const fail = (): void => setProblem("That didn't go through. Nothing was changed.");

  async function toConventions(): Promise<void> {
    setBusy(true); setProblem(null);
    const r = await client.listCandidates(referenceId);
    setBusy(false);
    if (!r.ok) return fail();
    setCandidates(r.data); setPicked(new Set(r.data.filter((x) => x.eligible && x.kind === "directory").map((x) => x.id))); setStep(1);
  }

  async function save(): Promise<void> {
    const err = validateBaselineName(name);
    setNameError(err);
    if (err) return;
    setBusy(true); setProblem(null);
    const r = await client.saveBaseline({ name: name.trim(), referenceId, conventionIds: [...picked] });
    setBusy(false);
    if (!r.ok) return fail();
    setBaseline(r.data); setStep(2);
  }

  async function runCompare(): Promise<void> {
    if (!baseline || !targetId) return;
    setBusy(true); setProblem(null);
    const [r, h] = await Promise.all([client.compare(baseline.id, targetId), client.history(baseline.id, targetId)]);
    setBusy(false);
    if (!r.ok) return fail();
    setRows(r.data); if (h.ok) setHistory(h.data);
    setNow(new Date());
  }

  async function mark(conventionId: string, reason: string | null, undo = false): Promise<void> {
    if (!baseline) return;
    setBusy(true); setProblem(null);
    const r = undo ? await client.unmarkIntentional(baseline.id, targetId, conventionId) : await client.markIntentional(baseline.id, targetId, conventionId, reason);
    if (!r.ok) { setBusy(false); return fail(); }
    setRows(r.data);
    const h = await client.history(baseline.id, targetId);
    if (h.ok) setHistory(h.data);
    setBusy(false);
  }

  async function openPlan(): Promise<void> {
    if (!baseline) return;
    setBusy(true); setProblem(null);
    const r = await client.createSetupPlan(baseline.id, targetId);
    setBusy(false);
    if (!r.ok) return fail();
    globalThis.location.assign(planPath(r.data.planId));
  }

  const toggle = (id: string): void => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const back = (n: number): void => { setProblem(null); setStep(n); if (n < 2) { setRows(null); setHistory([]); } };

  return (
    <CareShell fixture section="Baselines">
      <header className={c.header}>
        <h1 className={c.title} ref={titleRef} tabIndex={-1}>Baselines and server setup</h1>
        <p className={c.small}>Step {step + 1} of 4: {STEPS[step]}. Comparing copies and deletes nothing. A setup only ever happens through a plan you approve.</p>
      </header>

      <ol className={s.stepper} aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} data-state={i < step ? "done" : i === step ? "current" : "todo"} aria-current={i === step ? "step" : undefined}>
            <span className={s.stepNum}>{i < step ? `${i + 1} ✓` : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {problem && <div className={`${c.notice} ${c.noticeFailed}`} role="alert"><p className={c.noticeTitle}>That didn&rsquo;t work</p><p>{problem}</p></div>}

      <section className={c.panel} aria-labelledby={`${ids}-h`}>
        <h2 id={`${ids}-h`} className={c.h2}>{STEPS[step]}</h2>

        {step === 0 && (
          <div className={s.form}>
            <p className={c.p}>Pick the machine whose directories and packages should guide the others. It is <strong>evidence for a proposed baseline</strong>, not a source for an unrestricted clone.</p>
            <fieldset className={s.fieldset}>
              <legend className={s.legend}>Reference server</legend>
              {servers.map((x) => {
                const age = referenceAge(x, now, tz, uncertain);
                return (
                  <label key={x.id} className={s.choice}>
                    <input type="radio" name={`${ids}-ref`} checked={referenceId === x.id} onChange={() => setReferenceId(x.id)} />
                    <span>
                      <span className={s.choiceTitle}>{x.name} {x.production && <ProductionLabel />}</span>
                      {x.role ?? "No role set"}. {age.text}.{age.old && <strong> The observation is more than a day old, so it may not describe the machine now.</strong>}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className={s.nav}>
              <ReasonButton id={`${ids}-s0`} className={c.primary} busy={busy} reason={referenceId ? null : "Choose a reference server to continue."} onClick={() => void toConventions()}>{busy ? "Reading conventions" : "Continue"}</ReasonButton>
            </div>
          </div>
        )}

        {step === 1 && reference && (
          <div className={s.form}>
            <p className={c.p}>From <strong>{reference.name}</strong>. Tick the conventions that should be part of the baseline.</p>
            <fieldset className={s.fieldset}>
              <legend className={s.legend}>Eligible directories and Ubuntu packages</legend>
              {eligible.map((x) => (
                <label key={x.id} className={s.choice}>
                  <input type="checkbox" checked={picked.has(x.id)} onChange={() => toggle(x.id)} />
                  <span><span className={s.choiceTitle}><span className={c.mono}>{x.label}</span> <span className={b.kind}>{x.kind === "directory" ? "Directory" : "Package"}</span></span>{x.detail}</span>
                </label>
              ))}
            </fieldset>
            <h3 className={s.h3}>Not eligible</h3>
            <ul className={`${c.list} ${c.bullets}`} aria-label="Not eligible for a baseline">
              {ineligible.map((x) => <li key={x.id}><span className={c.mono}>{x.label}</span>: {x.ineligibleReason}</li>)}
            </ul>
            <div className={s.field}>
              <label htmlFor={`${ids}-name`}>Baseline name</label>
              <input id={`${ids}-name`} type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoComplete="off" aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `${ids}-name-e` : undefined} />
              {nameError && <p id={`${ids}-name-e`} className={s.errorText}>{nameError}</p>}
            </div>
            <p className={c.small}>{SAVE_NOTE}</p>
            <div className={s.nav}>
              <button type="button" className={c.secondary} onClick={() => back(0)}>Back</button>
              <ReasonButton id={`${ids}-s1`} className={c.primary} busy={busy} reason={picked.size === 0 ? "Tick at least one convention to save a baseline." : null} onClick={() => void save()}>{busy ? "Saving" : "Save baseline"}</ReasonButton>
            </div>
          </div>
        )}

        {step === 2 && baseline && (
          <div className={s.form}>
            <p className={c.p}>Baseline <strong>{baseline.name}</strong>, version {baseline.version}, from {baseline.referenceName}. {referenceAge({ observedAt: baseline.sourceObservedAt } as BaselineServer, now, tz, uncertain).text}.</p>
            <fieldset className={s.fieldset}>
              <legend className={s.legend}>Server to compare</legend>
              {servers.filter((x) => x.id !== baseline.referenceId).map((x) => (
                <label key={x.id} className={s.choice}>
                  <input type="radio" name={`${ids}-tgt`} checked={targetId === x.id} onChange={() => { setTargetId(x.id); setRows(null); setHistory([]); }} />
                  <span><span className={s.choiceTitle}>{x.name} {x.production && <ProductionLabel />}</span>{x.role ?? "No role set"}. {referenceAge(x, now, tz, uncertain).text}.</span>
                </label>
              ))}
            </fieldset>
            <ReasonButton id={`${ids}-cmp`} className={c.secondary} busy={busy} reason={targetId ? null : "Choose a server to compare."} onClick={() => void runCompare()}>{busy ? "Comparing" : "Compare"}</ReasonButton>

            {rows && groups && (
              <div role="region" aria-label="Comparison result" className={s.form}>
                <p className={c.p} role="status">{summaryText(rows)}</p>
                {groups.needsDecision.length > 0 && <><h3 className={s.h3}>Needs a decision</h3><ul className={b.rows}>{groups.needsDecision.map((r) => <Row key={r.conventionId} r={r} busy={busy} onMark={(why) => void mark(r.conventionId, why)} onUnmark={() => void mark(r.conventionId, null, true)} />)}</ul></>}
                {groups.intentional.length > 0 && <><h3 className={s.h3}>Different by design</h3><ul className={b.rows}>{groups.intentional.map((r) => <Row key={r.conventionId} r={r} busy={busy} onMark={() => undefined} onUnmark={() => void mark(r.conventionId, null, true)} />)}</ul></>}
                {groups.notChecked.length > 0 && <><h3 className={s.h3}>Not checked</h3><ul className={b.rows}>{groups.notChecked.map((r) => <Row key={r.conventionId} r={r} busy={busy} onMark={() => undefined} onUnmark={() => undefined} />)}</ul></>}
                {groups.matches.length > 0 && <><h3 className={s.h3}>Matches</h3><ul className={b.rows}>{groups.matches.map((r) => <Row key={r.conventionId} r={r} busy={busy} onMark={() => undefined} onUnmark={() => undefined} />)}</ul></>}
                <h3 className={s.h3}>History for this server</h3>
                {history.length === 0 ? <p className={c.small}>No changes to the exception record yet.</p> : (
                  <ul className={`${c.list} ${c.bullets}`}>{history.map((h) => { const d = parseIso(h.at); return <li key={h.at + h.text}>{d ? formatClockWithAge(d, now, tz, uncertain) : "unknown time"}: {h.text}</li>; })}</ul>
                )}
              </div>
            )}
            <div className={s.nav}>
              <button type="button" className={c.secondary} onClick={() => back(1)}>Back</button>
              <ReasonButton id={`${ids}-s2`} className={c.primary} reason={rows ? null : "Run the comparison first."} onClick={() => setStep(3)}>Review a setup plan</ReasonButton>
            </div>
          </div>
        )}

        {step === 3 && baseline && target && scope && rows && (
          <div className={s.form}>
            <p className={c.p}>Preparing <strong>{target.name}</strong> {target.production && <ProductionLabel />} from <strong>{baseline.name}</strong>.</p>
            <p className={c.p} role="status">{describeSetup(scope)}</p>
            {scope.directories.length > 0 && <><h3 className={s.h3}>Directories to create</h3><ul className={`${c.list} ${c.bullets}`}>{scope.directories.map((r) => <li key={r.conventionId}><span className={c.mono}>{r.label}</span>, {r.expected}</li>)}</ul></>}
            {scope.packages.length > 0 && <><h3 className={s.h3}>Ubuntu packages to install</h3><ul className={`${c.list} ${c.bullets}`}>{scope.packages.map((r) => <li key={r.conventionId}><span className={c.mono}>{r.label}</span>, {r.expected}</li>)}</ul></>}
            {scope.leftAlone.length > 0 && <><h3 className={s.h3}>Left alone</h3><ul className={`${c.list} ${c.bullets}`}>{scope.leftAlone.map((x) => <li key={x.label}><span className={c.mono}>{x.label}</span>: {x.reason}</li>)}</ul></>}
            <div className={`${c.notice} ${c.noticeProgress}`}><p className={c.noticeTitle}>What a setup never touches</p><p>{EXCLUSION_STATEMENT}</p></div>
            {!target.writesEnabled && (
              <div className={`${c.notice} ${c.noticeAttention}`} role="status"><p className={c.noticeTitle}>This plan will open blocked</p><p>{WRITES_OFF_TEXT} You can still read the plan.</p></div>
            )}
            <p className={c.small}>Opening the plan does not approve anything. It shows the same review page as an update, with its own approval, expiry and verification.</p>
            <div className={s.nav}>
              <button type="button" className={c.secondary} onClick={() => back(2)}>Back</button>
              <ReasonButton id={`${ids}-s3`} className={c.primary} busy={busy} reason={scope.nothingToDo ? "Nothing to set up, so there is no plan to open." : null} onClick={() => void openPlan()}>{busy ? "Preparing the plan" : "Open the plan"}</ReasonButton>
            </div>
          </div>
        )}
      </section>
    </CareShell>
  );
}
