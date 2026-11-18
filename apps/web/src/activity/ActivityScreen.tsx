/**
 * ActivityScreen — UX-10 Activity and export at /activity (UX Spec §14).
 *
 * Runs on the [FIXTURE] activity client (api/stubs/activity.ts): the API has
 * no history listing yet, so the [FIXTURE DATA] banner is always shown.
 *
 * The default list shows operations and findings; routine checks are one
 * checkbox away. Filters: server, result, period, type. Search matches name,
 * title and id only. Export builds a file and keeps the result as a
 * persistent panel with a Download link and a "Recent exports" list that
 * survives navigation and reload in this session; it never relies on a toast.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createFixtureActivityClient, type ActivityClient, type ActivityRecord, type ActivityResult, type ActivityType, type ExportFormat, type ExportResult } from "../api/stubs/activity";
import { CareShell, ProductionLabel } from "../care/CareShell";
import { useClock } from "../clock/ClockContext";
import { usePageTitle } from "../lib/pageTitle";
import { DEFAULT_OWNER_TIME_ZONE, formatClockWithAge, parseIso } from "../lib/time";
import {
  countText, DEFAULT_FILTERS, filterRecords, formatBytes, groupByDay, isDefault, PERIOD_LABEL, planExport, RESULT_LABEL, toRow, TYPE_LABEL,
  type Filters, type Period,
} from "./activityViewModel";
import c from "../care/care.module.css";
import s from "./activity.module.css";

const TONE_CLASS = { passed: c.tagMet, attention: c.tagOwner, failed: c.tagBlocked, unknown: c.tagUnknown, progress: c.tagProgress } as const;
const TYPES: readonly ActivityType[] = ["operation", "finding", "inspection"];
const RESULTS = Object.keys(RESULT_LABEL) as ActivityResult[];

function downloadHref(e: ExportResult): string {
  return URL.createObjectURL(new Blob([e.content], { type: e.mime }));
}

export function ActivityScreen({ client: injected }: { client?: ActivityClient }) {
  const client = useMemo(() => injected ?? createFixtureActivityClient(), [injected]);
  const ids = useId();
  const tz = DEFAULT_OWNER_TIME_ZONE;
  const uncertain = useClock().view?.agesUncertain ?? false;
  const [records, setRecords] = useState<readonly ActivityRecord[] | null>(null);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [format, setFormat] = useState<ExportFormat>("report");
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [latest, setLatest] = useState<ExportResult | null>(null);
  const [recent, setRecent] = useState<readonly ExportResult[]>([]);
  const [now, setNow] = useState(() => new Date());

  usePageTitle("Activity");

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([client.list(), client.listExports()]);
    if (r.ok) { setRecords(r.data); setError(false); } else setError(true);
    if (e.ok) setRecent(e.data);
    setNow(new Date());
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const servers = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of records ?? []) m.set(r.serverId, r.serverName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [records]);

  const shown = records ? filterRecords(records, filters, now) : [];
  const groups = groupByDay(shown, now, tz);
  const plan = planExport(format, shown, filters, now, tz);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]): void => setFilters((f) => ({ ...f, [k]: v }));
  const toggleType = (t: ActivityType): void => setFilters((f) => ({ ...f, types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] }));

  async function doExport(): Promise<void> {
    if (exporting || shown.length === 0) return;
    setExporting(true); setExportFailed(false);
    const r = await client.createExport(plan.request, shown);
    setExporting(false);
    if (!r.ok) { setExportFailed(true); return; }
    setLatest(r.data);
    const list = await client.listExports();
    if (list.ok) setRecent(list.data);
  }

  return (
    <CareShell fixture section="Activity">
      <header className={c.header}>
        <h1 className={c.title}>Activity</h1>
        <p className={c.small}>What ServrSit did and found, newest first. Times are in {tz}.</p>
      </header>

      <form className={`${c.panel} ${s.filters}`} onSubmit={(e) => e.preventDefault()} role="search" aria-label="Filter activity">
        <div className={s.field}>
          <label htmlFor={`${ids}-q`}>Search by server, title or id</label>
          <input id={`${ids}-q`} type="search" value={filters.query} onChange={(e) => set("query", e.target.value)} autoComplete="off" />
        </div>
        <div className={s.selects}>
          <div className={s.field}>
            <label htmlFor={`${ids}-srv`}>Server</label>
            <select id={`${ids}-srv`} value={filters.serverId} onChange={(e) => set("serverId", e.target.value)}>
              <option value="">All servers</option>
              {servers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div className={s.field}>
            <label htmlFor={`${ids}-res`}>Result</label>
            <select id={`${ids}-res`} value={filters.result} onChange={(e) => set("result", e.target.value as Filters["result"])}>
              <option value="any">Any result</option>
              {RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABEL[r]}</option>)}
            </select>
          </div>
          <div className={s.field}>
            <label htmlFor={`${ids}-per`}>Period</label>
            <select id={`${ids}-per`} value={filters.period} onChange={(e) => set("period", e.target.value as Period)}>
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
            </select>
          </div>
        </div>
        <fieldset className={s.types}>
          <legend>Show</legend>
          {TYPES.map((t) => (
            <label key={t} className={s.check}><input type="checkbox" checked={filters.types.includes(t)} onChange={() => toggleType(t)} /><span>{TYPE_LABEL[t]}</span></label>
          ))}
        </fieldset>
        {!isDefault(filters) && <button type="button" className={c.secondary} onClick={() => setFilters(DEFAULT_FILTERS)}>Reset filters</button>}
      </form>

      {error && <div className={`${c.notice} ${c.noticeFailed}`} role="alert"><p className={c.noticeTitle}>Couldn&rsquo;t load activity</p><p>Nothing is shown until real data arrives.</p></div>}

      {records && (
        <section className={c.panel} aria-labelledby={`${ids}-list`}>
          <h2 id={`${ids}-list`} className={c.h2}>Records</h2>
          <p className={c.small} role="status">{countText(shown.length, records.length)}{!filters.types.includes("inspection") ? ". Routine checks are hidden." : ""}</p>
          {shown.length === 0 ? (
            <p className={c.p}>No records match these filters. {isDefault(filters) ? "" : "Reset the filters to see everything."}</p>
          ) : groups.map((g) => (
            <div key={g.label} className={s.day}>
              <h3 className={s.dayLabel}>{g.label}</h3>
              <ul className={s.list}>
                {g.records.map((r) => {
                  const row = toRow(r, now, tz, uncertain);
                  return (
                    <li key={row.id} className={s.row}>
                      <div className={s.rowHead}>
                        <span className={s.type}>{row.typeTag}</span>
                        <span className={`${c.stateTag} ${TONE_CLASS[row.tone]}`}>{row.resultLabel}</span>
                        <span className={s.when}>{row.when}</span>
                      </div>
                      <p className={s.title}>{row.href ? <a href={row.href}>{row.title}<span className="sr-only"> on {row.serverName}</span></a> : row.title}</p>
                      <p className={s.meta}><span>{row.serverName}</span>{row.production && <ProductionLabel />}<span className={s.id}>{row.id}</span></p>
                      <p className={s.summary}>{row.summary}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section className={c.panel} aria-labelledby={`${ids}-exp`}>
        <h2 id={`${ids}-exp`} className={c.h2}>Export</h2>
        <p className={c.small}>Exports what the filters above show: {plan.statement} Secrets are redacted: no keys, passwords, tokens, raw command output or log contents.</p>
        <fieldset className={s.types}>
          <legend>Format</legend>
          <label className={s.check}><input type="radio" name={`${ids}-fmt`} checked={format === "report"} onChange={() => setFormat("report")} /><span>Readable report (.txt)</span></label>
          <label className={s.check}><input type="radio" name={`${ids}-fmt`} checked={format === "json"} onChange={() => setFormat("json")} /><span>Machine-readable (.json)</span></label>
        </fieldset>
        <button type="button" className={c.primary} onClick={() => void doExport()} aria-disabled={exporting || shown.length === 0 || undefined} aria-describedby={`${ids}-exp-r`}>{exporting ? "Creating the export" : "Create export"}</button>
        <p id={`${ids}-exp-r`} className={c.small}>{shown.length === 0 ? "There is nothing to export with these filters." : exporting ? "Building the file. It will stay on this page when it is ready." : "The file is built from the records listed above."}</p>
        {exportFailed && <div className={`${c.notice} ${c.noticeFailed}`} role="alert"><p className={c.noticeTitle}>The export failed</p><p>No file was created. Try again.</p></div>}
        {latest && (
          <div className={`${c.notice} ${c.noticePassed}`} role="status">
            <p className={c.noticeTitle}>Export ready</p>
            <p>{latest.filename}: {latest.recordCount} records, {formatBytes(latest.sizeBytes)}. {latest.redaction} [FIXTURE: built in this browser from sample data.]</p>
            <a className={c.linkBtn} href={downloadHref(latest)} download={latest.filename}>Download {latest.filename}</a>
          </div>
        )}
        {recent.length > 0 && (
          <>
            <h3 className={s.dayLabel}>Recent exports</h3>
            <ul className={s.list}>
              {recent.map((e) => {
                const at = parseIso(e.createdAt);
                return (
                  <li key={e.id} className={s.row}>
                    <p className={s.title}><a href={downloadHref(e)} download={e.filename}>{e.filename}</a></p>
                    <p className={s.meta}><span>{at ? formatClockWithAge(at, now, tz, uncertain) : "unknown time"}</span><span>{e.recordCount} records</span><span>{formatBytes(e.sizeBytes)}</span></p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </CareShell>
  );
}
