/**
 * RecentActivity — compact operation list below the roster
 *
 * UX Spec §5.2: "Recent activity: a compact list below the roster,
 * not another wall of metrics."
 */
import type { RecentOperationFixture } from "../../fixtures/overview.js";
import { ScrollRegion } from "../ScrollRegion/index.js";
import styles from "./RecentActivity.module.css";

interface RecentActivityProps {
  operations: RecentOperationFixture[];
  /** Layout placement from the parent (grid area). */
  className?: string;
}

function OperationStateIcon({ state }: { state: string }) {
  switch (state) {
    case "succeeded":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4.5 7.5L6 9L9.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "failed":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 5L9 9M9 5L5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "outcome_unknown":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.5 5.5C5.5 4.7 6.2 4 7 4C7.8 4 8.5 4.7 8.5 5.5C8.5 6.5 7 7 7 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="7" cy="9.5" r="0.75" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false">
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" />
          <path d="M7 1C10.3 1 13 3.7 13 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

function getStateClass(state: string): string {
  switch (state) {
    case "succeeded": return "succeeded";
    case "failed": return "failed";
    case "partially_succeeded": return "partial";
    case "outcome_unknown": return "unknown";
    default: return "progress";
  }
}

export function RecentActivity({ operations, className = "" }: RecentActivityProps) {
  return (
    <section className={`${styles.section} ${className}`} aria-labelledby="activity-heading">
      <h2 id="activity-heading" className={styles.heading}>Recent activity</h2>
      {operations.length === 0 ? (
        <p className={styles.empty}>No recent operations.</p>
      ) : (
        <ScrollRegion label="Recent activity list">
        <ul className={styles.list} role="list">
          {operations.map((op) => {
            const stateClass = getStateClass(op.state);
            return (
              <li key={op.id} className={styles.item}>
                <span className={`${styles.stateIcon} ${styles[stateClass]}`}>
                  <OperationStateIcon state={op.state} />
                </span>
                <div className={styles.content}>
                  <div className={styles.row}>
                    <a href={`/operations/${op.id}`} className={styles.title}>
                      {op.title}
                    </a>
                    <span className={styles.time}>{op.completedRelative}</span>
                  </div>
                  <p className={styles.summary}>{op.changeSummary}</p>
                </div>
              </li>
            );
          })}
        </ul>
        </ScrollRegion>
      )}

      <a href="/activity" className={styles.viewAll}>
        View all activity
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
          <path d="M2.5 6H9.5M6.5 3L9.5 6L6.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </section>
  );
}
