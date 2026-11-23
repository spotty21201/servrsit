/**
 * CareShell — frame for the Plan review and Operation detail pages.
 * A plain top bar (wordmark + back to Overview), then the page. No fixed
 * elements, no 100vw, so nothing can drift on mobile. The [FIXTURE DATA]
 * banner is rendered whenever the page is backed by fixtures.
 */
import type { ReactNode } from "react";
import { TopBanners } from "../clock/TopBanners";
import { SignOutButton } from "../auth/SignOutButton";
import { BellroadLinks, BellroadMark, isBellroadPage } from "../bellroad/Bellroad";
import bellroad from "../bellroad/Bellroad.module.css";
import styles from "./care.module.css";

interface CareShellProps {
  fixture: boolean;
  /** Short label for the breadcrumb, e.g. "Plan" or "Operation". */
  section: string;
  children: ReactNode;
}

export function CareShell({ fixture, section, children }: CareShellProps) {
  // Every screen in this shell wears the Bellroad theme (round 5): the rail from the Overview beside the content.
  // The breadcrumb and Sign out stay at the top of the content column, in their old tab order after the navigation.
  // Only the four section pages (Findings, Activity, Baselines, Settings) are marked as the current page in the rail.
  return (
    <div className={`${styles.shell} ${bellroad.theme} bellroad-theme`}>
      <TopBanners fixture={fixture} />
      <div className={bellroad.frame}>
        <aside className={bellroad.rail}>
          <BellroadMark />
          <nav aria-label="Main navigation">
            <BellroadLinks current={isBellroadPage(section) ? section : ""} className={bellroad.railLinks} />
          </nav>
        </aside>
        <div className={bellroad.pane}>
          <header className={`${styles.topbar} ${bellroad.paneBar}`}>
            <nav aria-label="Breadcrumb" className={styles.crumbs}>
              <a href="/">Overview</a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{section}</span>
            </nav>
            <SignOutButton variant="bar" />
          </header>
          <main id="main-content" className={styles.main} tabIndex={-1}>{children}</main>
        </div>
      </div>
    </div>
  );
}

export function ProductionLabel() {
  return <span className={styles.productionLabel}>Production</span>;
}

export function SimulatedLabel() {
  return <span className={styles.simLabel}>Simulated target</span>;
}

export function LockGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x="2" y="0" width="4" height="1" fill="currentColor" />
      <rect x="1" y="1" width="1" height="3" fill="currentColor" />
      <rect x="6" y="1" width="1" height="3" fill="currentColor" />
      <rect x="0" y="3" width="8" height="5" fill="currentColor" />
      <rect x="3" y="5" width="2" height="2" fill="var(--color-state-attention-bg)" />
    </svg>
  );
}

/**
 * A page-level failure. By default its title is the page's <h1> (the screens that
 * show it have nothing else to head the page); screens that already have their
 * own <h1> pass `heading={false}`.
 */
export function LoadFailure({ title, text, onRetry, heading = true }: { title: string; text: string; onRetry?: () => void; heading?: boolean }) {
  return (
    <div className={`${styles.notice} ${styles.noticeFailed}`} role="alert">
      {heading ? <h1 className={styles.noticeTitle}>{title}</h1> : <p className={styles.noticeTitle}>{title}</p>}
      <p>{text}</p>
      <div className={styles.row}>
        {onRetry && <button type="button" className={styles.secondary} onClick={onRetry}>Try again</button>}
        <a className={styles.linkBtn} href="/">Back to Overview</a>
      </div>
    </div>
  );
}
