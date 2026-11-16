/**
 * OverviewScreen — UX-04 fleet overview
 *
 * UX Spec §5.2 desktop composition (top to bottom):
 *   1. Compact top line (workspace name + service indicator + account)
 *   2. Briefing — 8-col large headline + 4-col next-check aside
 *   3. Ask bar
 *   4. Working area — 8-col server roster + 4-col attention column
 *   5. Recent activity — below the roster
 *
 * Responsive:
 *   ≥1200 px  Navigation rail (88 px) + content column
 *   768–1199  Compact top nav + single column, attention above roster
 *   ≤767      Single column, 16 px padding, full-width cards
 */
import type { OverviewFixture } from "../../fixtures/overview.js";
import { FixtureBanner } from "../FixtureBanner/index.js";
import { ServerCard } from "../server-card/index.js";
import { Briefing } from "./Briefing.js";
import { AskBar } from "./AskBar.js";
import { AttentionColumn } from "./AttentionColumn.js";
import { RecentActivity } from "./RecentActivity.js";
import styles from "./OverviewScreen.module.css";

interface OverviewScreenProps {
  data: OverviewFixture;
  /** Must be true when data comes from fixtures, not a live API. */
  isFixture: boolean;
}

export function OverviewScreen({ data, isFixture }: OverviewScreenProps) {
  return (
    <div className={styles.appShell}>
      {/* Fixture banner — non-dismissable, appears at very top */}
      {isFixture && <FixtureBanner />}

      {/* Navigation rail (desktop) / top nav (tablet/mobile) */}
      <nav className={styles.nav} aria-label="Main navigation">
        {/* Wordmark */}
        <div className={styles.wordmark} aria-label="ServrSit">
          <span className={styles.wordmarkText}>ServrSit</span>
        </div>

        {/* Nav items */}
        <ul className={styles.navList} role="list">
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

        {/* Account control — bottom of rail on desktop */}
        <div className={styles.navAccount}>
          <button type="button" className={styles.accountButton} aria-label="Account settings">
            <span className={styles.accountAvatar} aria-hidden="true">S</span>
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className={styles.main} id="main-content">
        {/* Skip-nav target */}
        <a href="#main-content" className={`${styles.skipNav} sr-only`}>
          Skip to main content
        </a>

        <div className={styles.contentWrapper}>
          {/* Compact top line */}
          <div className={styles.topLine}>
            <span className={styles.workspaceName}>Spotty's fleet</span>
            {/* Service availability indicator omitted: no data source yet.
                UX Spec §5.2 requires it to be meaningful, not decorative. */}
          </div>

          {/* Briefing */}
          <Briefing
            headline={data.briefingHeadline}
            subtitle={data.briefingSubtitle}
            nextCheckRelative={data.nextCheckRelative}
          />

          {/* Ask bar */}
          <AskBar />

          {/* Working area: server roster + attention column */}
          <div className={styles.workingArea}>
            {/* Server roster — 8 cols at desktop */}
            <section className={styles.roster} aria-label="Server roster">
              <h2 className={styles.rosterHeading}>Your fleet</h2>
              <div className={styles.rosterGrid}>
                {data.servers.map((server) => (
                  <ServerCard key={server.id} server={server} />
                ))}
              </div>
            </section>

            {/* Attention column — 4 cols at desktop, above roster on tablet */}
            <AttentionColumn findings={data.findings} />
          </div>

          {/* Recent activity */}
          <RecentActivity operations={data.recentOperations} />
        </div>
      </main>
    </div>
  );
}

// ── Nav icons (inline SVG, Lucide-style outline, 20×20) ───────────────────

function NavIconOverview() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function NavIconActivity() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <polyline points="2,10 6,5 10,13 14,8 18,10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavIconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
