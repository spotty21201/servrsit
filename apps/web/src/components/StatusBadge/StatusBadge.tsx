/**
 * StatusBadge — semantic state pill
 *
 * UX Spec §15: "Status badge — Passed, attention, critical, unknown, progress.
 * Icon + text; never interactive unless rendered as an actual control."
 *
 * Uses semantic state CSS tokens exclusively. Never uses Lilac or Citron.
 */
import type { CheckStatus } from "../../fixtures/overview.js";
import styles from "./StatusBadge.module.css";

interface StatusBadgeProps {
  state: CheckStatus;
  label: string;
}

/** SVG icons for each semantic state — inline for accessibility (no img alt needed separately). */
function StatusIcon({ state }: { state: CheckStatus }) {
  // All icons 16×16, stroke-based to match Lucide conventions (spec §4.4)
  switch (state) {
    case "passed":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 8.5L7 10.5L11 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "attention":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <path d="M8 2L14.5 13H1.5L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 6.5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="11" r="0.75" fill="currentColor" />
        </svg>
      );
    case "failed":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "unknown":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 6.5C6 5.4 6.9 4.5 8 4.5C9.1 4.5 10 5.4 10 6.5C10 7.6 9 8 8 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="11" r="0.75" fill="currentColor" />
        </svg>
      );
    case "progress":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
          <path d="M8 1C11.866 1 15 4.134 15 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

export function StatusBadge({ state, label }: StatusBadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[state]}`}>
      <StatusIcon state={state} />
      <span>{label}</span>
    </span>
  );
}
