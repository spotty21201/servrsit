/**
 * AttentionColumn — right-column findings list
 *
 * UX Spec §5.2: "four-column 'Needs attention' list. The attention column uses
 * open rows and separators, giving the composition contrast against server cards."
 *
 * "Avoid filling every available gap. With no findings, it becomes a small quiet
 * note and the roster can expand."
 */
import type { FindingFixture } from "../../fixtures/overview.js";
import { ScrollRegion } from "../ScrollRegion/index.js";
import styles from "./AttentionColumn.module.css";

interface AttentionColumnProps {
  findings: FindingFixture[];
  /** Layout placement from the parent (grid area). */
  className?: string;
}

function FindingIcon({ severity }: { severity: "attention" | "failed" }) {
  if (severity === "failed") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 2L14.5 13H1.5L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" />
    </svg>
  );
}

export function AttentionColumn({ findings, className = "" }: AttentionColumnProps) {
  if (findings.length === 0) {
    return (
      <section className={`${styles.column} ${className}`} aria-labelledby="attention-heading">
        <h2 id="attention-heading" className={styles.heading}>Needs attention</h2>
        <p className={styles.empty}>Nothing needs attention in the checks that ran.</p>
      </section>
    );
  }

  return (
    <section className={`${styles.column} ${className}`} aria-labelledby="attention-heading">
      <h2 id="attention-heading" className={styles.heading}>
        Needs attention
        <span className={styles.count}>
          {findings.length}
          <span className="sr-only"> items</span>
        </span>
      </h2>
      <ScrollRegion label="Needs attention list">
      <ul className={styles.list} role="list">
        {findings.map((finding) => (
          <li key={finding.id} className={`${styles.finding} ${styles[finding.severity]}`}>
            <div className={styles.findingIcon}>
              <FindingIcon severity={finding.severity} />
            </div>
            <div className={styles.findingContent}>
              <div className={styles.findingHeader}>
                <span className={styles.serverName}>{finding.serverName}</span>
                <span className={styles.findingTime}>{finding.firstObservedRelative}</span>
              </div>
              <p className={styles.findingTitle}>{finding.title}</p>
              <p className={styles.findingDetail}>{finding.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      </ScrollRegion>
    </section>
  );
}
