/**
 * AttentionColumn — right-column findings list
 *
 * UX Spec §5.2: "four-column 'Needs attention' list. The attention column uses
 * open rows and separators, giving the composition contrast against server cards."
 *
 * "Avoid filling every available gap. With no findings, it becomes a small quiet
 * note and the roster can expand."
 */
import { useState } from "react";
import type { AttentionItemVM } from "./fleetViewModel.js";
import { ScrollRegion } from "./ScrollRegion.js";
import styles from "./AttentionColumn.module.css";

interface AttentionColumnProps {
  findings: AttentionItemVM[];
  /** True while there is no fleet data (loading or API down): don't claim "nothing needs attention". */
  unavailable?: boolean;
  /** No server is connected yet: say nothing was checked, not that nothing needs attention. */
  noServers?: boolean;
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

export function AttentionColumn({ findings, unavailable = false, noServers = false }: AttentionColumnProps) {
  const [hidden, setHidden] = useState(0);
  if (noServers) {
    return (
      <section className={styles.column} aria-labelledby="attention-heading">
        <h2 id="attention-heading" className={styles.heading}>Needs attention</h2>
        <p className={styles.empty}>No server is connected, so nothing has been checked yet.</p>
      </section>
    );
  }
  if (unavailable) {
    return (
      <section className={styles.column} aria-labelledby="attention-heading">
        <h2 id="attention-heading" className={styles.heading}>Needs attention</h2>
        <p className={styles.empty}>Unknown until server data loads.</p>
      </section>
    );
  }

  if (findings.length === 0) {
    return (
      <section className={styles.column} aria-labelledby="attention-heading">
        <h2 id="attention-heading" className={styles.heading}>Needs attention</h2>
        <p className={styles.empty}>Nothing needs attention in the checks that ran.</p>
      </section>
    );
  }

  return (
    <section className={styles.column} aria-labelledby="attention-heading">
      <h2 id="attention-heading" className={styles.heading}>
        Needs attention
        <span className={styles.count}>
          {findings.length}
          <span className="sr-only"> items</span>
        </span>
      </h2>
      <ScrollRegion label="Needs attention, list of findings" className={styles.scroll} onHidden={setHidden}>
      <ul className={styles.list} role="list">
        {findings.map((finding) => (
          <li key={finding.id} className={`${styles.finding} ${styles[finding.severity]}`}>
            <div className={styles.findingIcon}>
              <FindingIcon severity={finding.severity} />
            </div>
            <div className={styles.findingContent}>
              <div className={styles.findingHeader}>
                <span className={styles.serverName}>{finding.serverName}</span>
                {finding.firstObservedRelative && (
                  <time dateTime={finding.firstObservedAt} className={styles.findingTime}>
                    {finding.firstObservedRelative}
                  </time>
                )}
              </div>
              <p className={styles.findingTitle}>{finding.title}</p>
              <p className={styles.findingDetail}>{finding.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      </ScrollRegion>
      <p className={styles.footer}>
        {hidden > 0 && <span role="status">+{hidden} more, scroll the list. </span>}
        <a href="/findings">View all findings</a>
      </p>
    </section>
  );
}
