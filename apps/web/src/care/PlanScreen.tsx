/**
 * PlanScreen — UX-07 Plan review at /plans/:id (UX Spec §10).
 *
 * One dedicated page. Always visible: action + target + Production label,
 * scope, impact, preconditions, verification (and what it cannot establish),
 * expiry in the owner's zone with a relative label. Versions, digest and the
 * operation id sit in an expansion; nothing that matters lives only there.
 *
 * The approval panel only renders an approve control when the plan can
 * actually be approved. Writes-off, blocked, expired and changed plans show
 * the specific reason and "Refresh plan" instead (never a disabled approve
 * button that hides why). Acknowledgements start unchecked. Nothing receives
 * focus on load. A reply such as "yes" can never approve: only this control.
 *
 * Time is formatted in the owner's zone (lib/time). The zone comes from
 * /api/fleet (ownerTimeZone); until that is known the default applies.
 *
 * Fixture ids (fixture-plan-…) use createFixtureClient and show the
 * [FIXTURE DATA] banner. Real ids use the stub client in api/stubs/care.ts.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchFleet } from "../api/fleet";
import { useClock } from "../clock/ClockContext";
import { createCareClient, type CareClient, type PlanView } from "../api/stubs/care";
import { DEFAULT_OWNER_TIME_ZONE, resolveTimeZone } from "../lib/time";
import { operationPath } from "../lib/router";
import { usePageTitle } from "../lib/pageTitle";
import { StatusBadge } from "../components/StatusBadge/index.js";
import { IDLE, newIdempotencyKey, PHASE_LABEL, submitApproval, type ApprovalPhase } from "./approval";
import { CareShell, LoadFailure, LockGlyph, ProductionLabel, SimulatedLabel } from "./CareShell";
import { createFixtureClient, isFixtureId } from "./fixtures";
import { diffIsEmpty, diffScope, noticeText, toPlanVM, type PlanNotice, type PlanVM, type ScopeDiff } from "./planViewModel";
import styles from "./care.module.css";

const TICK_MS = 15_000;

interface Refreshed { readonly fromVersion: number; readonly toVersion: number; readonly diff: ScopeDiff }

function useOwnerZone(skip: boolean): string {
  const [tz, setTz] = useState(DEFAULT_OWNER_TIME_ZONE);
  useEffect(() => {
    if (skip) return;
    const c = new AbortController();
    void fetchFleet({ signal: c.signal }).then((r) => { if (r.ok) setTz(resolveTimeZone(r.data.ownerTimeZone)); });
    return () => c.abort();
  }, [skip]);
  return tz;
}

export function PlanScreen({ planId, client: injected }: { planId: string; client?: CareClient }) {
  const fixture = isFixtureId(planId);
  const client = useMemo(() => injected ?? (fixture ? createFixtureClient() : createCareClient()), [injected, fixture]);
  const tz = useOwnerZone(fixture);
  const clockView = useClock().view;

  const [plan, setPlan] = useState<PlanView | null>(null);
  const [loadError, setLoadError] = useState<"missing" | "failed" | null>(null);
  const [notice, setNotice] = useState<PlanNotice | null>(null);
  const [refreshed, setRefreshed] = useState<Refreshed | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [acks, setAcks] = useState<readonly boolean[]>([false, false]);
  const [phase, setPhase] = useState<ApprovalPhase>(IDLE);
  const keyRef = useRef<{ version: number; key: string } | null>(null);
  const ids = useId();

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await client.getPlan(planId);
    if (r.ok) setPlan(r.data);
    else setLoadError(r.kind === "http" && r.status === 404 ? "missing" : "failed");
  }, [client, planId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = globalThis.setInterval(() => setNow(new Date()), TICK_MS);
    return () => globalThis.clearInterval(t);
  }, []);

  const vm: PlanVM | null = plan ? toPlanVM(plan, now, tz, notice, clockView?.approvalsPaused ?? false) : null;
  const busy = phase.phase === "submitting" || phase.phase === "checking" || phase.phase === "accepted";
  const allAcked = vm ? vm.acknowledgements.every((_, i) => acks[i] === true) : false;

  async function refreshPlan(): Promise<void> {
    if (!plan || refreshing) return;
    setRefreshing(true);
    setRefreshFailed(false);
    let r = await client.getPlan(plan.id);
    const stillExpired = r.ok && Date.parse(r.data.expiresAt) <= Date.now();
    if (r.ok && r.data.version === plan.version && (stillExpired || notice?.code === "PLAN_EXPIRED" || notice?.code === "PLAN_CHANGED")) {
      r = await client.revisePlan(plan.id);
    }
    setRefreshing(false);
    if (!r.ok) { setRefreshFailed(true); return; }
    const next = r.data;
    if (next.version !== plan.version) {
      setRefreshed({ fromVersion: plan.version, toVersion: next.version, diff: diffScope(plan.scope.packages, next.scope.packages) });
    } else {
      setRefreshed(null);
    }
    setPlan(next);
    setNotice(null);
    setPhase(IDLE);
    setAcks([false, false]); // acknowledgements never transfer between versions
    setNow(new Date());
  }

  async function approve(): Promise<void> {
    if (!plan || !vm || !vm.disposition.canApprove || busy || phase.phase === "unconfirmed" || !allAcked) return;
    if (keyRef.current?.version !== plan.version) keyRef.current = { version: plan.version, key: newIdempotencyKey() };
    const body = { planVersion: plan.version, planDigest: plan.digest, idempotencyKey: keyRef.current.key, acknowledgements: vm.acknowledgementTokens };
    await settle(await submitApproval({ client, planId: plan.id, body, onPhase: setPhase }));
  }

  async function checkAgain(): Promise<void> {
    if (!plan || !vm || !keyRef.current || keyRef.current.version !== plan.version) return;
    const body = { planVersion: plan.version, planDigest: plan.digest, idempotencyKey: keyRef.current.key, acknowledgements: vm.acknowledgementTokens };
    await settle(await submitApproval({ client, planId: plan.id, body, onPhase: setPhase }));
  }

  async function settle(end: ApprovalPhase): Promise<void> {
    if (end.phase === "accepted") globalThis.location.assign(operationPath(end.operationId));
    if (end.phase === "rejected") { setNotice(end.notice); setPhase(IDLE); }
  }

  usePageTitle(vm ? `Plan review: ${vm.title}${vm.disposition.canApprove ? "" : ` (${vm.disposition.title})`}` : loadError ? "Plan not available" : "Loading the plan", vm !== null || loadError !== null);
  const sectionId = (s: string): string => `${ids}-${s}`;

  return (
    <CareShell fixture={fixture} section="Plan review">
      {loadError === "missing" && <LoadFailure title="Plan not found" text="There is no plan with this id. Nothing was started." />}
      {loadError === "failed" && <LoadFailure title="Couldn't load the plan" text="The ServrSit API did not return a usable plan. Nothing was started." onRetry={() => void load()} />}
      {!plan && !loadError && <><h1 className={styles.title}>Plan review</h1><p className={styles.p} role="status">Loading the plan…</p></>}

      {vm && plan && (
        <>
          <header className={styles.header}>
            <p className={styles.small}>Plan version {vm.version}</p>
            <h1 className={styles.title}>{vm.title}</h1>
            <div className={styles.chips}>
              {vm.isProduction && <ProductionLabel />}
              {vm.simulated && <SimulatedLabel />}
              <StatusBadge state={vm.disposition.kind === "ready" ? "progress" : "attention"} label={vm.disposition.kind === "ready" ? "Ready to review" : vm.disposition.title} {...(vm.disposition.kind === "writes-disabled" ? { icon: "lock" as const } : {})} />
            </div>
            <p className={styles.meta}>
              <span>Target: <strong>{vm.serverName}</strong></span>
              <span>Server ID <span className={styles.mono}>{vm.serverId}</span></span>
              <span>Prepared {vm.createdText}</span>
            </p>
          </header>

          {refreshed && !diffIsEmpty(refreshed.diff) && (
            <div className={`${styles.notice} ${styles.noticeAttention}`} role="status">
              <p className={styles.noticeTitle}>Plan updated from version {refreshed.fromVersion} to {refreshed.toVersion}</p>
              <p>Your earlier acknowledgements and approval did not carry over. What changed in scope:</p>
              <ul className={styles.diffList}>
                {refreshed.diff.added.map((p) => <li key={`a-${p.name}:${p.arch}`}>+ added {p.name}:{p.arch} {p.from} → {p.to}</li>)}
                {refreshed.diff.removed.map((p) => <li key={`r-${p.name}:${p.arch}`}>− removed {p.name}:{p.arch}</li>)}
                {refreshed.diff.changed.map((c) => <li key={`c-${c.after.name}:${c.after.arch}`}>~ changed {c.after.name}:{c.after.arch} target {c.before.to} → {c.after.to}</li>)}
              </ul>
            </div>
          )}
          {refreshed && diffIsEmpty(refreshed.diff) && (
            <p className={styles.small} role="status">Plan refreshed to version {refreshed.toVersion}. The scope is unchanged. Acknowledgements start again.</p>
          )}

          <div className={styles.layout}>
            <div className={styles.stack}>
              <section className={styles.panel} aria-labelledby={sectionId("scope")}>
                <h2 id={sectionId("scope")} className={styles.h2}>Scope</h2>
                <p className={styles.p}>{vm.scopeSummary}</p>
                {vm.directories.length > 0 && (
                  <>
                    <p className={styles.rowLabel}>Directories to create</p>
                    <ul className={styles.pkgGrid} aria-label="Directories to create">
                      {vm.directories.map((d) => <li key={d.path}>{d.path}</li>)}
                    </ul>
                  </>
                )}
                {vm.packages.length > 0 && (
                  <>
                    {vm.directories.length > 0 && <p className={styles.rowLabel}>Packages to install</p>}
                    <ul className={styles.pkgGrid} aria-label="Packages in this plan">
                      {vm.packages.map((p) => <li key={`${p.name}:${p.arch}`}>{p.name}</li>)}
                    </ul>
                  </>
                )}
                {vm.leftAlone.length > 0 && (
                  <>
                    <p className={styles.rowLabel}>Left alone</p>
                    <ul className={`${styles.list} ${styles.bullets}`} aria-label="Left alone">
                      {vm.leftAlone.map((x) => <li key={x.label}><span className={styles.mono}>{x.label}</span>: {x.reason}</li>)}
                    </ul>
                  </>
                )}
                <ul className={`${styles.list} ${styles.bullets}`} aria-label="Not included">
                  {vm.exclusions.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </section>

              <section className={styles.panel} aria-labelledby={sectionId("impact")}>
                <h2 id={sectionId("impact")} className={styles.h2}>Impact</h2>
                <ul className={`${styles.list} ${styles.bullets}`}>{vm.impact.map((t) => <li key={t}>{t}</li>)}</ul>
              </section>

              <section className={styles.panel} aria-labelledby={sectionId("pre")}>
                <h2 id={sectionId("pre")} className={styles.h2}>Preconditions</h2>
                <ul className={styles.list}>
                  {vm.preconditions.map((c) => (
                    <li key={c.label} className={styles.rowItem}>
                      <span className={`${styles.stateTag} ${c.state === "met" ? styles.tagMet : c.state === "blocked" ? styles.tagBlocked : c.state === "owner" ? styles.tagOwner : styles.tagUnknown}`}>
                        {c.state === "met" ? "Met" : c.state === "blocked" ? "Blocked" : c.state === "owner" ? "You confirm" : "Not checked"}
                      </span>
                      <span><span className={styles.rowLabel}>{c.label}.</span> {c.detail}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className={styles.panel} aria-labelledby={sectionId("verify")}>
                <h2 id={sectionId("verify")} className={styles.h2}>Verification</h2>
                <ul className={`${styles.list} ${styles.bullets}`} aria-label="What will be checked">{vm.verifyChecks.map((t) => <li key={t}>{t}</li>)}</ul>
                <p className={styles.rowLabel}>What this cannot establish</p>
                <ul className={`${styles.list} ${styles.bullets}`} aria-label="Stays unverified">{vm.verifyCannot.map((t) => <li key={t}>{t}</li>)}</ul>
                <details className={styles.details}>
                  <summary>Technical details</summary>
                  <ul className={styles.diffList} aria-label="Package versions">
                    {vm.packages.map((p) => <li key={`${p.name}:${p.arch}`}>{p.name}:{p.arch} {p.from} → {p.to}</li>)}
                    {vm.directories.map((d) => <li key={`d-${d.path}`}>create {d.path} owner {d.owner} mode {d.mode}</li>)}
                    {vm.packages.length === 0 && vm.directories.length === 0 && <li>No versions or directories: nothing was prepared.</li>}
                  </ul>
                  <p className={styles.small}>Operation: apply.packages.v1 · Plan ID <span className={styles.mono}>{vm.id}</span> · Digest <span className={styles.mono}>{vm.digestShort}…</span></p>
                </details>
              </section>
            </div>

            <aside className={`${styles.stack} ${styles.aside}`} aria-label="Approval">
              <section className={`${styles.panel} ${styles.panelAccent}`} aria-labelledby={sectionId("approve")}>
                <h2 id={sectionId("approve")} className={styles.h2}>Approval</h2>
                <p className={styles.p}>
                  {vm.expiry.expired ? "Expired" : "Valid until"} <strong>{vm.expiry.absolute}</strong> ({vm.expiry.relative})
                </p>
                <p className={styles.small}>Approval applies to version {vm.version} only. If anything material changes, you will need a new plan.</p>

                {!vm.disposition.canApprove && (
                  <div className={`${styles.notice} ${styles.noticeAttention}`} role={notice ? "alert" : "status"}>
                    <p className={styles.noticeTitle}>
                      {vm.disposition.kind === "writes-disabled" && <LockGlyph />}
                      {vm.disposition.title}
                    </p>
                    <p>{vm.disposition.reason}</p>
                    {vm.blockers.length > 1 && (
                      <ul className={`${styles.list} ${styles.bullets}`}>{vm.blockers.slice(1).map((b) => <li key={b.code}>{b.message}</li>)}</ul>
                    )}
                    {vm.disposition.kind === "writes-disabled" && <p>No approval can be given for this plan.</p>}
                    {vm.disposition.offerRefresh && (
                      <button type="button" className={styles.secondary} onClick={() => void refreshPlan()} disabled={refreshing}>
                        {refreshing ? "Refreshing plan" : "Refresh plan"}
                      </button>
                    )}
                    {refreshFailed && <p role="alert">Couldn&rsquo;t refresh the plan. Try again.</p>}
                  </div>
                )}

                {vm.disposition.canApprove && (
                  <>
                    {notice && (
                      <div className={`${styles.notice} ${styles.noticeAttention}`} role="alert">
                        <p className={styles.noticeTitle}>{noticeText(notice, vm.serverName).title}</p>
                        <p>{noticeText(notice, vm.serverName).reason}</p>
                      </div>
                    )}
                    {vm.acknowledgements.length > 0 && (
                      <fieldset className={styles.fieldset} disabled={busy}>
                        <legend className={styles.legend}>Before you approve, confirm both:</legend>
                        {vm.acknowledgements.map((a, i) => (
                          <label key={a.id} className={styles.check}>
                            <input type="checkbox" checked={acks[i] === true} onChange={(e) => setAcks((cur) => cur.map((v, j) => (j === i ? e.target.checked : v)))} />
                            <span>{a.label}</span>
                          </label>
                        ))}
                        <p className={styles.small}>This records your confirmation. ServrSit does not verify that a backup or recovery route exists.</p>
                      </fieldset>
                    )}
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => void approve()}
                      disabled={busy}
                      aria-disabled={phase.phase === "unconfirmed" || !allAcked ? true : undefined}
                      aria-describedby={`${ids}-help`}
                    >
                      {vm.approveLabel}
                    </button>
                    <p id={`${ids}-help`} className={styles.small}>
                      {!allAcked && vm.acknowledgements.length > 0 ? "Tick both confirmations to enable approval." : "Approving starts the update on this server. The review above is the checkpoint."}
                    </p>
                  </>
                )}

                <div className={styles.statusLine} role="status" aria-live="polite">
                  {phase.phase === "submitting" && PHASE_LABEL.submitting}
                  {phase.phase === "checking" && PHASE_LABEL.checking}
                  {phase.phase === "accepted" && "Approved. Opening the operation…"}
                </div>
                {phase.phase === "unconfirmed" && (
                  <div className={`${styles.notice} ${styles.noticeUnknown}`} role="alert">
                    <p className={styles.noticeTitle}>Couldn&rsquo;t confirm whether this started</p>
                    <p>ServrSit did not get an answer. The approval is not sent again as a new one. Check again to look up the existing record. Do not approve a second time.</p>
                    <button type="button" className={styles.secondary} onClick={() => void checkAgain()}>Check again</button>
                  </div>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </CareShell>
  );
}
