/**
 * ChatBar — "Ask ServrSit" console at the bottom of the Overview
 *
 * Round 3: desktop console is ~5 lines tall (textarea rows=5), max 600 px wide.
 * Mobile (≤767px) keeps the single-line height the founder approved in round 2.
 * Visible persistent label and explicit scope chip (UX Spec §9, §15).
 *
 * Placeholder: disabled, does not submit. In normal document flow (never
 * fixed/sticky), so it cannot cover content or the mobile keyboard.
 */
import styles from "./ChatBar.module.css";

export function ChatBar() {
  return (
    <section className={styles.wrap} aria-labelledby="ask-label">
      <div className={styles.header}>
        <label id="ask-label" htmlFor="ask-input" className={styles.label}>
          Ask ServrSit
        </label>
        <span className={styles.scope}>
          <span className="sr-only">Scope: </span>All servers
        </span>
        <span className={styles.note}>not connected in this mockup</span>
      </div>
      <div className={styles.console}>
        <textarea
          id="ask-input"
          className={styles.input}
          rows={5}
          placeholder="What needs attention? Explain Nabire's updates…"
          autoComplete="off"
          disabled
        />
        <button
          type="button"
          className={styles.send}
          aria-label="Send question to ServrSit"
          disabled
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
            {/* pixel arrow */}
            <rect x="2" y="7" width="9" height="2" fill="currentColor" />
            <rect x="9" y="5" width="2" height="2" fill="currentColor" />
            <rect x="11" y="7" width="2" height="2" fill="currentColor" />
            <rect x="9" y="9" width="2" height="2" fill="currentColor" />
            <rect x="7" y="3" width="2" height="2" fill="currentColor" />
            <rect x="7" y="11" width="2" height="2" fill="currentColor" />
          </svg>
        </button>
      </div>
    </section>
  );
}
