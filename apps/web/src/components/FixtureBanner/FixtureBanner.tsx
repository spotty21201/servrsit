/**
 * FixtureBanner — [FIXTURE DATA] label
 *
 * Non-dismissable banner displayed whenever a screen is backed by fixture
 * data. Required by the Structure steering:
 *
 *   "Any screen, component, or data snapshot that uses synthetic/fixture data
 *   must carry a visible [FIXTURE DATA] label in the UI and in the file."
 *
 * This component must remain visible until the screen is connected to a real,
 * authorized data source.
 */
import styles from "./FixtureBanner.module.css";

export function FixtureBanner() {
  return (
    <div className={styles.banner} role="status" aria-live="off">
      <span className={styles.label} aria-label="This screen displays fixture data, not live server information">
        [FIXTURE DATA]
      </span>
      <span className={styles.description}>
        Synthetic data only — not connected to any real server
      </span>
    </div>
  );
}
