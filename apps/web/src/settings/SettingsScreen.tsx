/**
 * SettingsScreen — UX-11 Settings at /settings (UX Spec §13.2 and §14, PRD
 * FR-19, FR-21, FR-03).
 *
 *   Schedules      interval, daily time, time zone, next runs, pause (a separate
 *                  immediate action from saving). Schedules only look.
 *   AI and data    AI on/off, provider shown, what is collected and sent, where
 *                  it is processed, retention (proposed), export, deletion
 *   Server access  per-server access and key kind; Disconnect with a
 *                  confirmation that names the server, lists queued and active
 *                  work, and says the remote key must be removed by you
 *
 * Runs on Coder's real settings client (api/settings.ts, T-079). The
 * [FIXTURE DATA] banner shows on /fixtures/settings (sample client, nothing
 * real changes) and whenever /api/fleet says it is in fixture mode. Disconnect
 * uses the T-069 `DisconnectResponse` contract and is blocked while an
 * operation on the server is unresolved.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { AccessServer, DisconnectPreview, DisconnectResponse, SettingsData } from "@servrsit/contracts";
import { copyText } from "../auth/copy";
import { ReasonButton } from "../auth/AuthFrame";
import { createSettingsClient, type SettingsClient, type SettingsClientError } from "../api/settings";
import { useFleet } from "../api/useFleet";
import { createFixtureSettingsClient } from "../fixtures/settingsFixture";
import { CareShell, LoadFailure, ProductionLabel } from "../care/CareShell";
import { useClock } from "../clock/ClockContext";
import { SchedulerNotice } from "../findings/SchedulerNotice";
import { schedulerNotice } from "../findings/findingsViewModel";
import { usePageTitle } from "../lib/pageTitle";
import { formatClockWithAge, parseIso } from "../lib/time";
import {
  AI_OFF_NOTE, COLLECTED, DAILY_NOT_IN_EFFECT, DELETION_NOTE, describeDisconnect, describeNext, disconnectCopy, INTERVAL_LABEL, INTERVALS, isDefaultSchedule, isDirty, KEY_KIND_LABEL, NOT_COLLECTED,
  nextDailyRun, nextHealthRun, REFRESH_NOTE, RETENTION_NOTE, SCHEDULE_STATEMENT, SENT_TO_AI, settingsErrorText, TIME_ZONES, toScheduleDraft, validateSchedule, zoneName,
  type ScheduleDraft,
} from "./settingsLogic";
import { BellroadPageHeader } from "../bellroad/Bellroad";
import c from "../care/care.module.css";
import s from "../servers/servers.module.css";
import st from "./settings.module.css";

type Confirm = { server: AccessServer; preview: DisconnectPreview } | null;
type Done = { name: string; result: DisconnectResponse; preview: DisconnectPreview };

export function SettingsScreen({ client: injected, fixture = false }: { client?: SettingsClient; fixture?: boolean }) {
  const client = useMemo(() => injected ?? (fixture ? createFixtureSettingsClient() : createSettingsClient()), [injected, fixture]);
  const fleet = useFleet({ pollMs: 0 });
  const ids = useId();
  const uncertain = useClock().view?.agesUncertain ?? false;
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const confirmHeading = useRef<HTMLHeadingElement | null>(null);

  usePageTitle("Settings");

  const load = useCallback(async () => {
    const r = await client.get();
    if (!r.ok) { setError(true); return; }
    setData(r.data); setDraft((d) => d ?? toScheduleDraft(r.data.schedule)); setNow(new Date()); setError(false);
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (confirm) confirmHeading.current?.focus(); }, [confirm]);

  const fail = (r: { error: SettingsClientError; reason?: string }): void => setProblem(settingsErrorText(r.error, r.reason));
  const savedDraft = data ? toScheduleDraft(data.schedule) : null;
  const errors = draft ? validateSchedule(draft) : {};
  const dirty = savedDraft && draft ? isDirty(savedDraft, draft) : false;
  const tz = data?.schedule.timeZone ?? "Asia/Jakarta";

  async function saveSchedule(): Promise<void> {
    if (!draft) return;
    setBusy(true); setProblem(null); setSaved(null);
    const r = await client.saveSchedule({ intervalMinutes: draft.intervalMinutes as 15, dailyTime: draft.dailyTime, timeZone: draft.timeZone });
    setBusy(false);
    if (!r.ok) return fail(r);
    setData(r.data); setDraft(toScheduleDraft(r.data.schedule)); setNow(new Date());
    setSaved("Schedule saved. It only changes when ServrSit looks, never what it may do.");
  }

  async function togglePause(): Promise<void> {
    if (!data) return;
    setBusy(true); setProblem(null); setSaved(null);
    const r = await client.setPaused(!data.schedule.paused);
    setBusy(false);
    if (!r.ok) return fail(r);
    setData(r.data); setNow(new Date());
    setSaved(r.data.schedule.paused ? "Checks are paused. Nothing is being checked until you resume." : "Checks resumed. One current check runs, not a backlog of missed ones.");
  }

  async function toggleAi(): Promise<void> {
    if (!data) return;
    setBusy(true); setProblem(null); setSaved(null);
    const r = await client.setAi(!data.ai.enabled);
    setBusy(false);
    if (!r.ok) return fail(r);
    setData(r.data);
    setSaved(r.data.ai.enabled ? "AI explanations are on." : "AI explanations are off. No new AI requests will be sent.");
  }

  async function openDisconnect(server: AccessServer): Promise<void> {
    setBusy(true); setProblem(null); setDone(null);
    const r = await client.previewDisconnect(server.id);
    setBusy(false);
    if (!r.ok) return fail(r);
    setConfirm({ server, preview: r.data });
  }

  function cancelDisconnect(): void {
    const id = confirm?.server.id;
    setConfirm(null);
    if (id) globalThis.setTimeout(() => document.getElementById(`${ids}-dc-${id}`)?.focus(), 0);
  }

  async function doDisconnect(): Promise<void> {
    if (!confirm) return;
    setBusy(true); setProblem(null);
    const r = await client.disconnect(confirm.server.id);
    setBusy(false);
    if (!r.ok) return fail(r);
    setDone({ name: confirm.server.name, result: r.data, preview: confirm.preview });
    setConfirm(null);
    await load();
  }

  const paused = data?.schedule.paused ?? false;
  const notice = data && paused ? schedulerNotice({ status: "paused", since: data.schedule.pausedSince ?? now.toISOString(), reason: "You paused checks." }, now, tz, uncertain) : null;
  const nextHealth = data ? nextHealthRun(now, data.schedule.intervalMinutes, paused) : null;
  const nextDaily = data ? nextDailyRun(now, data.schedule.dailyTime, tz, paused) : null;
  const result = done ? describeDisconnect(done.name, done.result, done.preview) : null;

  return (
    <CareShell fixture={fixture || fleet.data?.mode === "fixture"} section="Settings">
      <BellroadPageHeader scene="Settings">
        <h1 className={c.title}>Settings</h1>
        <p className={c.small}>Schedules, AI and data, and server access.{fixture ? " This page uses sample data and does not touch a real schedule or connection." : ""}</p>
      </BellroadPageHeader>

      {error && !data && <LoadFailure title="Couldn't load settings" text="Nothing is shown until real data arrives. Your schedule and connections are unchanged." onRetry={() => void load()} heading={false} />}
      {!data && !error && <p className={c.p} role="status">Loading settings…</p>}
      {problem && <div className={`${c.notice} ${c.noticeFailed}`} role="alert"><p>{problem}</p></div>}
      <div role="status" aria-live="polite" className={st.saved}>{saved}</div>

      {data && draft && (
        <>
          <nav aria-label="On this page" className={s.jump}><a href="#set-schedule">Schedules</a><a href="#set-ai">AI and data</a><a href="#set-access">Server access</a></nav>

          <section className={c.panel} id="set-schedule" aria-labelledby={`${ids}-sch`}>
            <h2 id={`${ids}-sch`} className={c.h2}>Schedules</h2>
            {notice && <SchedulerNotice notice={notice} />}
            <p className={c.small}>{SCHEDULE_STATEMENT}</p>
            <dl className={s.facts}>
              <div className={s.fact}><dt>Next health check</dt><dd>{describeNext(nextHealth, now, tz, uncertain)}</dd></div>
              <div className={s.fact}><dt>Next daily check</dt><dd>{data.schedule.dailyTimeInEffect ? describeNext(nextDaily, now, tz, uncertain) : <><span className={s.dash}>—</span> <span className={s.why}>Not scheduled yet.</span></>}</dd></div>
              <div className={s.fact}><dt>Time zone</dt><dd>{zoneName(tz, now)}</dd></div>
            </dl>

            <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (dirty && Object.keys(errors).length === 0 && !busy) void saveSchedule(); }} noValidate>
              <div className={s.field}>
                <label htmlFor={`${ids}-int`}>Health check interval</label>
                <select id={`${ids}-int`} className={st.control} value={draft.intervalMinutes} onChange={(e) => setDraft({ ...draft, intervalMinutes: Number(e.target.value) })} aria-describedby={`${ids}-int-h`}>
                  {INTERVALS.map((v) => <option key={v} value={v}>{INTERVAL_LABEL[v]}{v === 15 ? " (default)" : ""}</option>)}
                </select>
                <p id={`${ids}-int-h`} className={c.small}>Lightweight checks: load, memory, storage, services. Default is every 15 minutes.</p>
              </div>
              <div className={s.field}>
                <label htmlFor={`${ids}-day`}>Daily deeper check at{data.schedule.dailyTimeInEffect ? "" : " (not used yet)"}</label>
                <input id={`${ids}-day`} className={st.control} type="time" value={draft.dailyTime} onChange={(e) => setDraft({ ...draft, dailyTime: e.target.value })} aria-invalid={errors.dailyTime ? true : undefined} aria-describedby={`${ids}-day-h${errors.dailyTime ? ` ${ids}-day-e` : ""}`} />
                <p id={`${ids}-day-h`} className={c.small}>{data.schedule.dailyTimeInEffect ? "Inventory and update information, once a day. Default is 03:00." : DAILY_NOT_IN_EFFECT}</p>
                {errors.dailyTime && <p id={`${ids}-day-e`} className={s.errorText}>{errors.dailyTime}</p>}
              </div>
              <div className={s.field}>
                <label htmlFor={`${ids}-tz`}>Time zone</label>
                <select id={`${ids}-tz`} className={st.control} value={draft.timeZone} onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })} aria-describedby={`${ids}-tz-h`}>
                  {(TIME_ZONES.includes(draft.timeZone as never) ? TIME_ZONES : [draft.timeZone, ...TIME_ZONES]).map((z) => <option key={z} value={z}>{zoneName(z, now)}</option>)}
                </select>
                <p id={`${ids}-tz-h`} className={c.small}>Every time in ServrSit is shown in this zone.</p>
              </div>
              <p className={c.small}>{isDefaultSchedule(draft) ? "These are the default values." : "Some values differ from the defaults (every 15 minutes, 03:00, Asia/Jakarta)."} {REFRESH_NOTE}</p>
              <ReasonButton id={`${ids}-save`} type="submit" className={c.primary} busy={busy} reason={!dirty ? "There are no changes to save." : Object.keys(errors).length > 0 ? "Fix the fields marked above to save." : null}>{busy ? "Saving" : "Save schedule"}</ReasonButton>
            </form>

            <h3 className={s.h3}>Pause checks</h3>
            <p className={c.small}>Pausing is separate from saving. While paused nothing is checked, so a quiet Overview is not an all-clear.</p>
            <button type="button" className={c.secondary} disabled={busy} onClick={() => void togglePause()} aria-pressed={paused}>{paused ? "Resume checks" : "Pause checks"}</button>
          </section>

          <section className={c.panel} id="set-ai" aria-labelledby={`${ids}-ai`}>
            <h2 id={`${ids}-ai`} className={c.h2}>AI and data</h2>
            <label className={st.switch}>
              <input type="checkbox" role="switch" checked={data.ai.enabled} aria-disabled={busy || (!data.ai.available && !data.ai.enabled) || undefined} onChange={() => { if (!busy && (data.ai.available || data.ai.enabled)) void toggleAi(); }} aria-describedby={`${ids}-ai-h`} />
              <span><span className={s.choiceTitle}>Use AI to explain results: {data.ai.enabled ? "On" : "Off"}</span></span>
            </label>
            <p id={`${ids}-ai-h`} className={c.small}>{AI_OFF_NOTE}{!data.ai.available ? " No AI provider is configured on ServrSit, so AI cannot be turned on here." : ""}</p>
            <dl className={s.facts}>
              <div className={s.fact}><dt>Provider</dt><dd>{data.ai.providerLabel}</dd></div>
              <div className={s.fact}><dt>How it is reached</dt><dd>{data.ai.route}</dd></div>
              <div className={s.fact}><dt>Where it is processed</dt><dd>{data.ai.region ?? <><span className={s.dash}>—</span> <span className={s.why}>The region is not reported yet.</span></>}</dd></div>
            </dl>
            <h3 className={s.h3}>What ServrSit collects</h3>
            <ul className={`${c.list} ${c.bullets}`}>{COLLECTED.map((t) => <li key={t}>{t}</li>)}<li>{NOT_COLLECTED}</li></ul>
            <h3 className={s.h3}>What is sent to the AI</h3>
            <ul className={`${c.list} ${c.bullets}`}>{[data.ai.sends, ...SENT_TO_AI].map((t) => <li key={t}>{t}</li>)}</ul>
            <h3 className={s.h3}>How long it is kept</h3>
            <dl className={s.facts}>
              <div className={s.fact}><dt>Observations and chat</dt><dd>{data.retention.observationsDays} days</dd></div>
              <div className={s.fact}><dt>Operation records</dt><dd>{data.retention.operationRecordsDays} days</dd></div>
              <div className={s.fact}><dt>Exports</dt><dd>{data.retention.exportsDays} days</dd></div>
            </dl>
            <p className={c.small}>{RETENTION_NOTE}</p>
            <h3 className={s.h3}>Export and deletion</h3>
            <p className={c.p}><a className={s.inlineLink} href="/activity">Export your history from Activity</a></p>
            <p className={c.small}>{DELETION_NOTE}</p>
          </section>

          <section className={c.panel} id="set-access" aria-labelledby={`${ids}-acc`}>
            <h2 id={`${ids}-acc`} className={c.h2}>Server access</h2>
            <p className={c.small}>Every server is inspect only. Disconnecting stops ServrSit; it never deletes or shuts down the server.</p>
            <ul className={st.servers}>
              {data.servers.map((x) => {
                const at = parseIso(x.hostKeyConfirmedAt);
                return (
                  <li key={x.id} className={st.server}>
                    <div className={st.serverHead}><strong>{x.name}</strong>{x.production && <ProductionLabel />}{!x.connected && <span className={c.stateTag + " " + c.tagUnknown}>Disconnected</span>}</div>
                    <dl className={s.facts}>
                      <div className={s.fact}><dt>Access</dt><dd>Inspect only</dd></div>
                      <div className={s.fact}><dt>Key in use</dt><dd>{KEY_KIND_LABEL[x.keyKind]}{x.keyKind === "owner key" && <span className={s.caveat}>A dedicated ServrSit key is recommended.</span>}</dd></div>
                      <div className={s.fact}><dt>Host key confirmed</dt><dd>{at ? formatClockWithAge(at, now, tz, uncertain) : <><span className={s.dash}>—</span> <span className={s.why}>Not confirmed.</span></>}</dd></div>
                    </dl>
                    {x.connected
                      ? <button id={`${ids}-dc-${x.id}`} type="button" className={c.secondary} disabled={busy || confirm !== null} onClick={() => void openDisconnect(x)}>Disconnect {x.name}…</button>
                      : <a className={c.linkBtn} href="/servers/new">Reconnect {x.name}</a>}
                    {confirm?.server.id === x.id && (() => {
                      const k = disconnectCopy(confirm.server, confirm.preview);
                      return (
                        <div className={st.confirm} role="region" aria-labelledby={`${ids}-cf-h`}>
                          <h3 id={`${ids}-cf-h`} ref={confirmHeading} tabIndex={-1} className={s.h3}>{k.title}</h3>
                          {k.blocked && <div className={`${c.notice} ${c.noticeAttention}`} role="status"><p className={c.noticeTitle}>Disconnecting is blocked</p><p>{k.blocked}</p></div>}
                          <h4 className={s.h4}>What stops</h4>
                          <ul className={`${c.list} ${c.bullets}`}>{k.stops.map((t) => <li key={t}>{t}</li>)}</ul>
                          <h4 className={s.h4}>Queued work</h4>
                          <ul className={`${c.list} ${c.bullets}`}>{k.queued.map((t) => <li key={t}>{t}</li>)}</ul>
                          <h4 className={s.h4}>Work already running</h4>
                          <ul className={`${c.list} ${c.bullets}`}>{k.active.map((t) => <li key={t}>{t}</li>)}</ul>
                          <h4 className={s.h4}>What stays</h4>
                          <ul className={`${c.list} ${c.bullets}`}>{k.keep.map((t) => <li key={t}>{t}</li>)}</ul>
                          <div className={`${c.notice} ${c.noticeAttention}`}><p className={c.noticeTitle}>Your step on the server</p><p>{k.yourStep}</p></div>
                          <div className={c.row}>
                            <button type="button" className={c.secondary} onClick={cancelDisconnect}>{k.blocked ? "Close" : "Cancel"}</button>
                            {!k.blocked && <button type="button" className={st.danger} disabled={busy} onClick={() => void doDisconnect()}>{busy ? "Disconnecting" : k.confirmLabel}</button>}
                          </div>
                        </div>
                      );
                    })()}
                  </li>
                );
              })}
            </ul>

            {result && done && (
              <div className={`${c.notice} ${c.noticeAttention}`} role="status" aria-labelledby={`${ids}-res`}>
                <p id={`${ids}-res`} className={c.noticeTitle}>{result.headline}</p>
                <p><strong>Done</strong></p>
                <ul className={`${c.list} ${c.bullets}`}>{result.done.map((t) => <li key={t}>{t}</li>)}</ul>
                <p><strong>Not done, and why it matters</strong></p>
                <ul className={`${c.list} ${c.bullets}`}>{result.notDone.map((t) => <li key={t}>{t}</li>)}</ul>
                <p><strong>Remove ServrSit&rsquo;s access yourself</strong></p>
                <ol className={`${c.list} ${c.bullets}`}>{result.steps.map((t) => <li key={t}>{t}</li>)}</ol>
                {result.line && (
                  <>
                    <pre className={s.codeBlock} tabIndex={0} aria-label="authorized_keys line to remove">{result.line}</pre>
                    <button type="button" className={c.secondary} onClick={() => void copyText(result.line ?? "").then((ok) => setCopied(ok ? "ok" : "failed"))}>Copy the line</button>
                    <p className={c.small} role="status">{copied === "ok" ? "Copied." : copied === "failed" ? "Couldn't copy. Select the line and copy it by hand." : ""}</p>
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </CareShell>
  );
}
