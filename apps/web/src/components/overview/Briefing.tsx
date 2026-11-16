/**
 * Briefing — large typographic fleet state headline
 *
 * UX Spec §5.2: "approximately eight columns of large expressive text,
 * with a short factual subtitle and observation coverage."
 *
 * UX Spec §8.1: headline patterns:
 *   - "Everyone's behaving." — only when ALL checks fresh and clear
 *   - "Two things need a look." — when issues detected
 *   - "One server is out of reach." — when unreachable
 *   - "I need a fresh look." — when observations stale/incomplete
 */
import styles from "./Briefing.module.css";

interface BriefingProps {
  headline: string;
  subtitle: string;
  nextCheckRelative: string;
}

export function Briefing({ headline, subtitle, nextCheckRelative }: BriefingProps) {
  return (
    <section className={styles.briefing} aria-label="Fleet briefing">
      <div className={styles.main}>
        <h1 className={styles.headline}>{headline}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
      <div className={styles.aside}>
        <div className={styles.nextCheck}>
          <span className={styles.nextCheckLabel}>Next check</span>
          <span className={styles.nextCheckTime}>{nextCheckRelative}</span>
        </div>
      </div>
    </section>
  );
}
