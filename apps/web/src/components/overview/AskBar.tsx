/**
 * AskBar — task entry surface
 *
 * UX Spec §5.2: "a clearly labeled 'Ask ServrSit' input with a scope chip
 * and up to three contextual suggestions. This is a task entry surface,
 * not an empty chat occupying half the screen."
 *
 * This is a non-interactive placeholder for T-018. The input and suggestions
 * are rendered but do not submit. Conversation panel integration comes later.
 */
import styles from "./AskBar.module.css";

const SUGGESTIONS = [
  "What needs attention?",
  "Explain these updates",
  "Compare directory conventions",
] as const;

export function AskBar() {
  return (
    <section className={styles.askBar} aria-label="Ask ServrSit">
      <div className={styles.inputWrapper}>
        {/* Scope chip */}
        <span className={styles.scopeChip} aria-label="Scope: All servers">
          All servers
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        {/* Ask input — placeholder only in this iteration */}
        <input
          type="text"
          className={styles.input}
          placeholder="Ask ServrSit…"
          aria-label="Ask ServrSit a question about your fleet"
          disabled
          aria-disabled="true"
        />

        {/* Send button */}
        <button
          type="button"
          className={styles.sendButton}
          aria-label="Send question to ServrSit"
          disabled
          aria-disabled="true"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
            <path d="M14 8L2 2L5 8L2 14L14 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Contextual suggestions */}
      <div className={styles.suggestions} role="list" aria-label="Suggested questions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={styles.suggestion}
            role="listitem"
            disabled
            aria-disabled="true"
            aria-label={`Ask: ${suggestion}`}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}
