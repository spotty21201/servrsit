/**
 * [FIXTURE DATA] /fixtures/clock: every clock-banner state side by side, so
 * the founder can review them without breaking a real clock. Synthetic only.
 */
import { CareShell } from "../care/CareShell";
import { formatRelative } from "../lib/time";
import { ClockProvider } from "./ClockContext";
import { ClockBanner } from "./TopBanners";
import { clockBanner, FIXTURE_CLOCKS } from "./clockBanner";
import styles from "../care/care.module.css";

const LABELS: Record<keyof typeof FIXTURE_CLOCKS, string> = {
  trusted: "Trusted (no banner)",
  "untrusted-fast": "Untrusted, about 7 h fast",
  "untrusted-unverified": "Untrusted, cannot be verified",
  "not-checked": "Not checked (fixture or test mode)",
};

export function FixtureClockPage() {
  const now = new Date();
  const seen = new Date(now.getTime() - 3 * 60_000);
  return (
    <CareShell fixture section="Clock banner states">
      <header className={styles.header}>
        <h1 className={styles.title}>Clock banner states</h1>
        <p className={styles.small}>[FIXTURE DATA] Synthetic clock states. No real clock is involved.</p>
      </header>
      {(Object.keys(FIXTURE_CLOCKS) as Array<keyof typeof FIXTURE_CLOCKS>).map((k) => {
        const v = clockBanner(FIXTURE_CLOCKS[k]);
        return (
          <section key={k} className={styles.panel} aria-label={LABELS[k]}>
            <h2 className={styles.h2}>{LABELS[k]}</h2>
            <ClockProvider fixed={FIXTURE_CLOCKS[k]}>
              <ClockBanner />
            </ClockProvider>
            {!v && <p className={styles.small}>Nothing is shown when the clock is trusted.</p>}
            <p className={styles.p}>Observed {formatRelative(seen, now, "Asia/Jakarta", v?.agesUncertain ?? false)}</p>
          </section>
        );
      })}
    </CareShell>
  );
}
