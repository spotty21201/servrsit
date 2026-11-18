/**
 * ServerDetailScreen — UX-05 Server detail at /servers/:id (UX Spec §8.4).
 *
 * Live /api/fleet data only (the hook polls every 30 s; the API serves a cache
 * and never contacts servers on request). Layout: strong name row, then
 * Status (left) and Care + Settings (right) on desktop; stacked on mobile.
 *
 * Honesty rules: an empty value is an em dash plus the reason, never zero;
 * "no findings" names how many checks ran; nothing here changes a server.
 * Review updates is shown disabled with the writes-off reason.
 * Settings are read-only until editing exists. The address and the key in use
 * are not in the API yet and say so; no key path is ever shown.
 */
import { useEffect, useId, useState, type CSSProperties } from "react";
import { useFleet } from "../api/useFleet";
import { CareShell, LoadFailure, ProductionLabel } from "../care/CareShell";
import { useClock } from "../clock/ClockContext";
import { StatusBadge } from "../components/StatusBadge/index.js";
import { PixelServerIcon } from "../components/server-card/PixelServerIcon.js";
import { DEFAULT_OWNER_TIME_ZONE, resolveTimeZone } from "../lib/time";
import { usePageTitle } from "../lib/pageTitle";
import { DASH, toServerDetailVM, type MountRow, type ServerDetailVM, type Shown } from "./serverDetailViewModel";
import c from "../care/care.module.css";
import styles from "./servers.module.css";

const TICK_MS = 30_000;

const IDENTITY_VAR: Record<string, string> = {
  lilac: "var(--color-lilac)", citron: "var(--color-citron)", tangerine: "var(--color-tangerine)", bubblegum: "var(--color-bubblegum)",
};

/** A labelled value; a missing value reads "— reason" so nothing looks like zero. */
function Fact({ label, v, children }: { label: string; v?: Shown; children?: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>
        {v && (v.why === null ? <span className={styles.value}>{v.value}</span> : <><span className={styles.dash} aria-label="no value">{DASH}</span> <span className={styles.why}>{v.why}</span></>)}
        {children}
      </dd>
    </div>
  );
}

function Mount({ m }: { m: MountRow }) {
  return (
    <li className={styles.mount}>
      <span className={styles.mountName}>{m.mount}</span>
      <span className={styles.mountSpace}>{m.space.value}</span>
      {m.spacePercent !== null && (
        <span className={styles.bar} aria-hidden="true"><span style={{ width: `${m.spacePercent}%` } as CSSProperties} /></span>
      )}
      <span className={styles.mountInodes}>Inodes: {m.inodes.why === null ? m.inodes.value : `${DASH} ${m.inodes.why}`}</span>
    </li>
  );
}

function severityClass(s: "critical" | "warning" | "advisory"): string {
  return s === "critical" ? c.tagBlocked ?? "" : s === "warning" ? c.tagOwner ?? "" : c.tagUnknown ?? "";
}

function Sections({ vm, section }: { vm: ServerDetailVM; section: "settings" | "verify" | null }) {
  const reasonId = useId();
  const { facts, care, settings } = vm;
  useEffect(() => {
    if (section === "settings") document.getElementById("server-settings")?.scrollIntoView({ block: "start" });
  }, [section]);

  return (
    <div className={`${c.layout} ${styles.cols}`}>
      <div className={c.stack}>
        <section className={c.panel} aria-labelledby="server-status">
          <h2 id="server-status" className={c.h2}>Status</h2>

          <h3 className={styles.h3}>Findings</h3>
          {vm.findings.length > 0 ? (
            <ul className={c.list}>
              {vm.findings.map((f) => (
                <li key={f.id} className={c.rowItem}>
                  <span className={`${c.stateTag} ${severityClass(f.severity)}`}>{f.label}</span>
                  <span>{f.summary}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={c.p}>{vm.findingsEmpty}</p>
          )}

          {!vm.hasObservation ? (
            <p className={c.p}><span className={styles.dash}>{DASH}</span> <span className={styles.why}>Checks, resources and system facts appear after the first successful check. Nothing is estimated in the meantime.</span></p>
          ) : (
            <>
          <h3 className={styles.h3}>Checks</h3>
          <p className={c.p}>{vm.checks.summary}</p>
          {vm.checks.unavailable.length > 0 && (
            <ul className={`${c.list} ${c.bullets}`} aria-label="Checks that could not run">
              {vm.checks.unavailable.map((u) => <li key={u.check}><strong>{u.check}</strong>: {u.reason}</li>)}
            </ul>
          )}

          <h3 className={styles.h3}>Resources</h3>
          {vm.sampleText && <p className={c.small}>{vm.sampleText}</p>}
          <dl className={styles.facts}>
            <Fact label="CPU load" v={facts.load} />
            <Fact label="Memory" v={facts.memory} />
            <Fact label="Swap" v={facts.swap} />
          </dl>
          <h4 className={styles.h4}>Storage</h4>
          {facts.mounts.length > 0 ? (
            <ul className={styles.mounts}>{facts.mounts.map((m) => <Mount key={`${m.filesystem}:${m.mount}`} m={m} />)}</ul>
          ) : (
            <p className={c.p}><span className={styles.dash}>{DASH}</span> <span className={styles.why}>{facts.mountsWhy}</span></p>
          )}

          <h3 className={styles.h3}>System</h3>
          <dl className={styles.facts}>
            <Fact label="Platform" v={facts.platform} />
            <Fact label="Architecture" v={facts.architecture} />
            <Fact label="Uptime" v={facts.uptime} />
            <Fact label="Boot ID (first 8)" v={facts.bootId} />
            <Fact label="Server clock" v={facts.clock} />
            <Fact label="Failed services" v={facts.failedUnits} />
            {facts.importantServices.length > 0 && (
              <Fact label="Important services">
                <ul className={c.list}>{facts.importantServices.map((s) => <li key={s.name}><span className={c.mono}>{s.name}</span>: {s.note}</li>)}</ul>
              </Fact>
            )}
          </dl>
            </>
          )}
        </section>
      </div>

      <div className={c.stack}>
        <section className={c.panel} aria-labelledby="server-care">
          <h2 id="server-care" className={c.h2}>Care</h2>
          {vm.hasObservation ? (
          <dl className={styles.facts}>
            <Fact label="Pending updates" v={care.pending} />
            <Fact label="Package information" v={care.packageInfoAge}>
              {care.packageInfoCaveat && <span className={styles.caveat}>{care.packageInfoCaveat}</span>}
            </Fact>
            <Fact label="From Ubuntu" v={care.ubuntu} />
            <Fact label="From other sources" v={care.outside}>
              {care.outsideList.length > 0 && (
                <ul className={c.list} aria-label="Updates from outside Ubuntu">
                  {care.outsideList.map((p) => <li key={`${p.name}:${p.origin}`}><span className={c.mono}>{p.name}</span> from {p.origin}</li>)}
                </ul>
              )}
              {care.outsideList.length > 0 && <span className={styles.caveat}>Listed separately and left out of update plans by default.</span>}
            </Fact>
            <Fact label="Held back" v={care.heldBack} />
            <Fact label="Reboot" v={care.reboot} />
            <Fact label="Baseline" v={care.baseline} />
            <Fact label="Recent operations" v={care.operations} />
          </dl>
          ) : (
            <dl className={styles.facts}>
              <Fact label="Updates and reboot" v={care.pending} />
              <Fact label="Baseline" v={care.baseline} />
              <Fact label="Recent operations" v={care.operations} />
            </dl>
          )}
          <button type="button" className={c.secondary} disabled aria-describedby={reasonId}>Review updates</button>
          <p id={reasonId} className={c.small}>{care.reviewDisabledReason}</p>
        </section>

        <section className={c.panel} id="server-settings" aria-labelledby="server-settings-h">
          <h2 id="server-settings-h" className={c.h2}>Settings</h2>
          <p className={c.small}>Read-only for now. Editing is not available yet.</p>
          <dl className={styles.facts}>
            <Fact label="Name" v={{ value: settings.name, why: null }} />
            <Fact label="Role" v={settings.role} />
            <Fact label="Classification" v={{ value: settings.classification, why: null }} />
            <Fact label="Address" v={settings.address} />
            <Fact label="Key in use" v={settings.keyInUse} />
            <Fact label="Access" v={{ value: settings.access, why: null }} />
            <Fact label="Important services" v={settings.importantServices} />
          </dl>
        </section>
      </div>
    </div>
  );
}

export function ServerDetailScreen({ serverId, section }: { serverId: string; section: "settings" | "verify" | null }) {
  const fleet = useFleet();
  const clockView = useClock().view;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = globalThis.setInterval(() => setNow(new Date()), TICK_MS);
    return () => globalThis.clearInterval(t);
  }, []);
  useEffect(() => { setNow(new Date()); }, [fleet.receivedAt]);

  const tz = resolveTimeZone(fleet.data?.ownerTimeZone ?? DEFAULT_OWNER_TIME_ZONE);
  const index = fleet.data ? fleet.data.servers.findIndex((s) => s.id === serverId) : -1;
  const server = fleet.data && index >= 0 ? fleet.data.servers[index] : undefined;
  const vm = server ? toServerDetailVM(server, index, now, tz, clockView?.agesUncertain ?? false) : null;
  const card = vm?.card;
  usePageTitle(card ? `${card.name}: server detail` : fleet.phase === "ready" ? "Server not found" : fleet.phase === "error" ? "Servers not available" : "Loading the server", fleet.phase !== "loading");

  return (
    <CareShell fixture={server?.source === "fixture"} section="Server">
      {fleet.phase === "loading" && <p className={c.p} role="status">Loading the server…</p>}
      {fleet.phase === "error" && <LoadFailure title="Couldn't load your servers" text={`${fleet.error?.message ?? "The ServrSit API did not answer."} Nothing is shown until real data arrives.`} onRetry={fleet.refresh} />}
      {fleet.phase === "ready" && !server && <LoadFailure title="Server not found" text="No server with this id is in your fleet. It may have been removed from the configuration." />}

      {vm && card && server && (
        <>
          <header className={styles.head} style={{ "--card-identity": IDENTITY_VAR[card.identity] } as CSSProperties}>
            <PixelServerIcon variant={card.identity} className={styles.icon} />
            <div className={styles.headText}>
              <h1 className={styles.name}>{card.name}</h1>
              <div className={c.chips}>
                <span className={styles.role}>{card.role}</span>
                {card.isProduction && <ProductionLabel />}
                <span className={c.chip} title={vm.accessNote}>{vm.accessLabel}</span>
                <StatusBadge state={card.statusKey} label={card.statusLabel} {...(card.statusIcon ? { icon: card.statusIcon } : {})} />
              </div>
              <p className={c.meta}>
                <span>{vm.freshnessText}</span>
                <span>{vm.coverageText}</span>
              </p>
              <p className={c.small}>{vm.accessNote}</p>
            </div>
          </header>

          {fleet.error && (
            <div className={`${c.notice} ${c.noticeUnknown}`} role="alert">
              <p className={c.noticeTitle}>Couldn&rsquo;t refresh</p>
              <p>{fleet.error.message} This page shows the last data received.</p>
            </div>
          )}
          {card.latestFailure && (
            <div className={`${c.notice} ${c.noticeFailed}`} role="status">
              <p className={c.noticeTitle}>Latest check failed</p>
              <p>{card.latestFailure.text}</p>
            </div>
          )}
          {card.historical && (
            <div className={`${c.notice} ${c.noticeUnknown}`} role="status">
              <p className={c.noticeTitle}>Historical data</p>
              <p>{card.primaryLine} Figures below are from the last successful check, not from now.</p>
            </div>
          )}
          {(section === "verify" || card.status === "unverified-host" || card.status === "host-key-changed") && (
            <div className={`${c.notice} ${c.noticeAttention}`} role="status">
              <p className={c.noticeTitle}>{card.status === "host-key-changed" ? "Host key changed" : "Host key not verified"}</p>
              <p>{server.statusReason} Comparing the fingerprint with an independently obtained value is step 3 of <a href="/servers/new">Connect a server</a>. It is not available for existing servers yet.</p>
            </div>
          )}

          <nav aria-label="On this page" className={styles.jump}>
            <a href="#server-status">Status</a><a href="#server-care">Care</a><a href="#server-settings">Settings</a>
          </nav>
          <Sections vm={vm} section={section} />
        </>
      )}
    </CareShell>
  );
}
