/**
 * OverviewScreen — UX-04 fleet overview (v2, ADR-011 rounds 1–2)
 *
 * Order (DOM and reading order, all breakpoints):
 *   1. Fixture banner (non-dismissable)
 *   2. Servers roster: "Your servers" h1 (pixel face) + cards, full width
 *   3. Needs attention | Recent activity (side by side ≥768px)
 *   4. Chat console (in document flow, never fixed)
 *
 * Round 5 layout (round 4 three-column fit reverted):
 *   ≥1024px   3 server cards per row; attention + activity two columns
 *   768–1023  2 server cards per row; attention + activity two columns
 *   ≤767px    single column (round 2 anchoring unchanged)
 * The page scrolls normally; no internal scroll regions.
 *
 * Unknown/stale/unreachable state is carried by each card's status badge,
 * "Historical" chip, border style and failure line, and by the attention
 * list. There is no fleet-level "all clear" statement.
 *
 * T-046: renders OverviewVM (fleetViewModel.ts) built from useFleet().
 * Page states:
 *   loading          no data yet → status text, no placeholder cards
 *   error, no data   inline error + Retry; no cards, never fake data
 *   ready + error    last data kept, with an inline "refresh failed" notice
 *                    stating when that data was received; cards keep their
 *                    own observed times
 *   ready, 0 servers empty state
 * The [FIXTURE DATA] banner shows only when at least one card is fixture.
 */
import { useEffect, useMemo, useState } from "react";
import { TopBanners } from "../../clock/TopBanners";
import { ServerCard } from "../server-card/index.js";
import { AttentionColumn } from "./AttentionColumn.js";
import { RecentActivity } from "./RecentActivity.js";
import { ChatBar } from "./ChatBar.js";
import type { OverviewVM } from "./fleetViewModel.js";
import { CompactServerList } from "./CompactServerList.js";
import {
  applyOrder, effectiveView, offersList, orderDiffers, orderIds, parsePrefs, PREFS_KEY, serializePrefs, SORT_LABEL,
  type OverviewPrefs, type SortKey,
} from "./listView.js";
import { SchedulerNotice } from "../../findings/SchedulerNotice";
import { SignOutButton } from "../../auth/SignOutButton";
import { useSession } from "../../auth/session";
import styles from "./OverviewScreen.module.css";

interface OverviewScreenProps {
  vm: OverviewVM;
  onRetry: () => void;
}

export function OverviewScreen({ vm, onRetry }: OverviewScreenProps) {
  const hasData = vm.phase === "ready";
  const session = useSession();
  const count = vm.servers.length;
  const empty = hasData && count === 0;

  // View and sort preference (saved); the order is fixed on entry and changes only on request (UX Spec §5.2).
  const [prefs, setPrefs] = useState<OverviewPrefs>(() => {
    try { return parsePrefs(globalThis.localStorage?.getItem(PREFS_KEY) ?? null); } catch { return parsePrefs(null); }
  });
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => { if (count > 0 && ids.length === 0) setIds(orderIds(vm.servers, prefs.sort)); }, [count, ids.length, vm.servers, prefs.sort]);
  const sorted = offersList(count);
  const ordered = useMemo(() => (sorted ? applyOrder(vm.servers, ids, prefs.sort) : vm.servers), [sorted, vm.servers, ids, prefs.sort]);
  const orderStale = sorted && ids.length > 0 && orderDiffers(vm.servers, ids, prefs.sort);
  const view = effectiveView(prefs, count);
  const savePrefs = (next: OverviewPrefs): void => {
    setPrefs(next);
    try { globalThis.localStorage?.setItem(PREFS_KEY, serializePrefs(next)); } catch { /* storage unavailable: the choice lasts for this visit */ }
  };
  const changeSort = (sort: SortKey): void => { savePrefs({ ...prefs, sort }); setIds(orderIds(vm.servers, sort)); };
  return (
    <div className={styles.appShell}>
      <TopBanners fixture={vm.anyFixture} />

      <nav className={styles.nav} aria-label="Main navigation">
        <div className={styles.wordmark}>
          <span className="sr-only">ServrSit</span>
          <span className={`${styles.wordmarkText} pixel-text`} aria-hidden="true">
            <span className={styles.wordmarkStack}>Servr</span>
            <span className={styles.wordmarkStack}>Sit</span>
          </span>
        </div>

        <div className={styles.navAccount}>
          {session ? (
            <SignOutButton variant="rail" />
          ) : (
            <button type="button" className={styles.accountButton} aria-label="Account settings">
              <span aria-hidden="true">S</span>
            </button>
          )}
        </div>

        <ul className={styles.navList}>
          <li>
            <a href="/overview" className={`${styles.navItem} ${styles.navItemActive}`} aria-current="page">
              <NavIconOverview />
              <span className={styles.navLabel}>Overview</span>
            </a>
          </li>
          <li>
            <a href="/activity" className={styles.navItem}>
              <NavIconActivity />
              <span className={styles.navLabel}>Activity</span>
            </a>
          </li>
          <li>
            <a href="/settings" className={styles.navItem}>
              <NavIconSettings />
              <span className={styles.navLabel}>Settings</span>
            </a>
          </li>
        </ul>

      </nav>

      <main className={styles.main} id="main-content" tabIndex={-1}>
        <div className={styles.band} aria-hidden="true" />

        <div className={styles.contentWrapper}>
          <section className={styles.roster} aria-labelledby="servers-heading" aria-busy={vm.phase === "loading" || undefined}>
            <header className={styles.columnHeader}>
              <h1 id="servers-heading" className={`${styles.pageTitle} pixel-text`}>Your servers</h1>
              <p className={styles.pageMeta}>
                <span>Spotty&rsquo;s fleet</span>
                {hasData && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {vm.counts.total} server{vm.counts.total === 1 ? "" : "s"}
                      {vm.counts.none > 0 && ` (${vm.counts.none} without data)`}
                    </span>
                  </>
                )}
                {vm.receivedText && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Updated {vm.receivedText}</span>
                  </>
                )}
                {vm.nextCheckText && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Next check {vm.nextCheckText}</span>
                  </>
                )}
                {vm.refreshing && hasData && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Refreshing…</span>
                  </>
                )}
              </p>
              {!empty && <a href="/servers/new" className={styles.connectLink}>Connect a server</a>}
            </header>

            {/* Data-state notices (inline, never a toast) */}
            {vm.scheduler && <SchedulerNotice notice={vm.scheduler} />}

            {vm.phase === "loading" && (
              <p className={styles.stateNote} role="status">
                Loading your servers…
              </p>
            )}

            {vm.phase === "error" && vm.error && (
              <div className={`${styles.stateNote} ${styles.stateError}`} role="alert">
                <p>
                  <strong>Couldn&rsquo;t load your servers.</strong> {vm.error.message} Nothing is shown
                  until real data arrives.
                </p>
                <button type="button" className={styles.retry} onClick={onRetry}>
                  Try again
                </button>
              </div>
            )}

            {hasData && vm.error && (
              <div className={`${styles.stateNote} ${styles.stateStale}`} role="alert">
                <p>
                  <strong>Couldn&rsquo;t refresh.</strong> {vm.error.message} Showing data received at{" "}
                  {vm.receivedText ?? "an earlier time"}. Each card shows when it was observed.
                </p>
                <button type="button" className={styles.retry} onClick={onRetry}>
                  Try again
                </button>
              </div>
            )}

            {empty && (
              <section className={styles.empty} aria-labelledby="empty-heading">
                <h2 id="empty-heading" className={`${styles.emptyTitle} pixel-text`}>Let&rsquo;s meet your first server.</h2>
                <p className={styles.emptyText}>Connect a supported Ubuntu server to check its condition and review care tasks.</p>
                <ul className={styles.emptyList}>
                  <li>Supported today: Ubuntu LTS servers.</li>
                  <li>ServrSit needs SSH access to the server and a network path to it, for example over your private network.</li>
                  <li>It only looks at first. It cannot change anything on the server yet.</li>
                </ul>
                <a href="/servers/new" className={styles.emptyAction}>Connect a server</a>
              </section>
            )}

            {sorted && (
              <div className={styles.viewBar}>
                <div role="group" aria-label="Roster layout" className={styles.viewToggle}>
                  <button type="button" aria-pressed={view === "cards"} onClick={() => savePrefs({ ...prefs, view: "cards" })}>Cards</button>
                  <button type="button" aria-pressed={view === "list"} onClick={() => savePrefs({ ...prefs, view: "list" })}>Compact list</button>
                </div>
                <label className={styles.sortLabel}>
                  <span>Sort by</span>
                  <select value={prefs.sort} onChange={(e) => changeSort(e.target.value as SortKey)}>
                    {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
                  </select>
                </label>
                {orderStale && (
                  <p className={styles.orderNote} role="status">
                    Order is from when you opened this page; statuses have changed since.{" "}
                    <button type="button" className={styles.linkButton} onClick={() => setIds(orderIds(vm.servers, prefs.sort))}>Update order</button>
                  </p>
                )}
              </div>
            )}

            {count > 0 && view === "list" && <CompactServerList servers={ordered} />}
            {count > 0 && view === "cards" && (
              <div className={styles.rosterGrid}>
                {ordered.map((server) => (
                  <ServerCard key={server.id} server={server} />
                ))}
              </div>
            )}
          </section>

          <div className={styles.lowerGrid}>
            <AttentionColumn findings={vm.attention} unavailable={!hasData} noServers={empty} />
            {/* The fleet API has no operation history yet: honest empty list. */}
            <RecentActivity operations={[]} />
          </div>

          {!empty && <ChatBar servers={vm.servers.map((s) => ({ id: s.id, name: s.name }))} timeZone={vm.timeZone} />}
        </div>
      </main>
    </div>
  );
}

// ── Nav icons (pixel style, 8×8 grid scaled to 24 px, crisp) ──────────────

function NavIconOverview() {
  return (
    <svg width="24" height="24" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="3" height="3" fill="currentColor" />
      <rect x="5" y="0" width="3" height="3" fill="currentColor" />
      <rect x="0" y="5" width="3" height="3" fill="currentColor" />
      <rect x="5" y="5" width="3" height="3" fill="currentColor" />
    </svg>
  );
}

function NavIconActivity() {
  return (
    <svg width="24" height="24" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x="0" y="4" width="2" height="1" fill="currentColor" />
      <rect x="2" y="2" width="1" height="2" fill="currentColor" />
      <rect x="3" y="1" width="1" height="1" fill="currentColor" />
      <rect x="4" y="2" width="1" height="4" fill="currentColor" />
      <rect x="5" y="5" width="1" height="1" fill="currentColor" />
      <rect x="6" y="3" width="2" height="1" fill="currentColor" />
    </svg>
  );
}

function NavIconSettings() {
  return (
    <svg width="24" height="24" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x="0" y="1" width="8" height="1" fill="currentColor" />
      <rect x="0" y="3" width="8" height="1" fill="currentColor" />
      <rect x="0" y="6" width="8" height="1" fill="currentColor" />
      <rect x="5" y="0" width="2" height="3" fill="currentColor" />
      <rect x="1" y="2" width="2" height="3" fill="currentColor" />
      <rect x="4" y="5" width="2" height="3" fill="currentColor" />
    </svg>
  );
}
