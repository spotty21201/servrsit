/**
 * CareShell — frame for the Plan review and Operation detail pages.
 * A plain top bar (wordmark + back to Overview), then the page. No fixed
 * elements, no 100vw, so nothing can drift on mobile. The [FIXTURE DATA]
 * banner is rendered whenever the page is backed by fixtures.
 */
import type { ReactNode } from "react";
import { TopBanners } from "../clock/TopBanners";
import { SignOutButton } from "../auth/SignOutButton";
import styles from "./care.module.css";

interface CareShellProps {
  fixture: boolean;
  /** Short label for the breadcrumb, e.g. "Plan" or "Operation". */
  section: string;
  children: ReactNode;
}

export function CareShell({ fixture, section, children }: CareShellProps) {
  return (
    <div className={styles.shell}>
      <TopBanners fixture={fixture} />
      <header className={styles.topbar}>
        <a href="/" className={`${styles.brand} pixel-text`} aria-label="ServrSit, back to Overview">ServrSit</a>
        <nav aria-label="Breadcrumb" className={styles.crumbs}>
          <a href="/">Overview</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{section}</span>
        </nav>
        <SignOutButton variant="bar" />
      </header>
      <main id="main-content" className={styles.main} tabIndex={-1}>{children}</main>
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

export function LoadFailure({ title, text, onRetry }: { title: string; text: string; onRetry?: () => void }) {
  return (
    <div className={`${styles.notice} ${styles.noticeFailed}`} role="alert">
      <p className={styles.noticeTitle}>{title}</p>
      <p>{text}</p>
      <div className={styles.row}>
        {onRetry && <button type="button" className={styles.secondary} onClick={onRetry}>Try again</button>}
        <a className={styles.linkBtn} href="/">Back to Overview</a>
      </div>
    </div>
  );
}
