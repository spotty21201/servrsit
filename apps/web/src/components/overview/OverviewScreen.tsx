/**
 * OverviewScreen — UX-04 fleet overview (v2, ADR-011 rounds 1–2)
 *
 * Order (DOM and reading order, all breakpoints):
 *   1. Fixture banner (non-dismissable)
 *   2. Servers column: "Your servers" h1 (pixel face) + cards
 *   3. Needs attention
 *   4. Recent activity
 *   5. Chat console (in document flow, never fixed)
 *
 * Round 4 layout:
 *   ≥1024px   three columns in one row, sized to the viewport; each column
 *             scrolls internally (ScrollRegion), the page does not
 *   768–1023  two columns: Servers | Attention over Activity; page scrolls
 *   ≤767px    single column; page scrolls (round 2 anchoring unchanged)
 *
 * Unknown/stale/unreachable state is carried by each card's status badge,
 * "Historical" chip and dashed border, and by the attention list. There is no
 * fleet-level "all clear" statement.
 */
import type { OverviewFixture } from "../../fixtures/overview.js";
import { FixtureBanner } from "../FixtureBanner/index.js";
import { ServerCard } from "../server-card/index.js";
import { AttentionColumn } from "./AttentionColumn.js";
import { RecentActivity } from "./RecentActivity.js";
import { ChatBar } from "./ChatBar.js";
import { ScrollRegion } from "../ScrollRegion/index.js";
import styles from "./OverviewScreen.module.css";

interface OverviewScreenProps {
  data: OverviewFixture;
  /** Must be true when data comes from fixtures, not a live API. */
  isFixture: boolean;
}

export function OverviewScreen({ data, isFixture }: OverviewScreenProps) {
  return (
    <div className={styles.appShell}>
      {isFixture && <FixtureBanner />}

      <nav className={styles.nav} aria-label="Main navigation">
        <div className={styles.wordmark}>
          <span className="sr-only">ServrSit</span>
          <span className={`${styles.wordmarkText} pixel-text`} aria-hidden="true">
            <span className={styles.wordmarkStack}>Servr</span>
            <span className={styles.wordmarkStack}>Sit</span>
          </span>
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

        <div className={styles.navAccount}>
          <button type="button" className={styles.accountButton} aria-label="Account settings">
            <span aria-hidden="true">S</span>
          </button>
        </div>
      </nav>

      <main className={styles.main} id="main-content">
        <div className={styles.band} aria-hidden="true" />

        <div className={styles.contentWrapper}>
          <div className={styles.columns}>
            <section className={`${styles.serversCol} ${styles.areaServers}`} aria-labelledby="servers-heading">
              <header className={styles.columnHeader}>
                <h1 id="servers-heading" className={`${styles.pageTitle} pixel-text`}>Your servers</h1>
                <p className={styles.pageMeta}>
                  <span>Spotty&rsquo;s fleet</span>
                  <span aria-hidden="true">·</span>
                  <span>{data.servers.length} servers</span>
                </p>
              </header>
              <ScrollRegion label="Servers list">
                <div className={styles.rosterGrid}>
                  {data.servers.map((server) => (
                    <ServerCard key={server.id} server={server} />
                  ))}
                </div>
              </ScrollRegion>
            </section>

            <AttentionColumn findings={data.findings} className={styles.areaAttention} />
            <RecentActivity operations={data.recentOperations} className={styles.areaActivity} />
          </div>

          <ChatBar />
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
