/**
 * TopBanners: the [FIXTURE DATA] banner, then the clock banner, as ONE sticky
 * block. Its measured height is published as --banner-h so the Overview's
 * navigation (which sits below the banners) never overlaps them, however many
 * lines the clock text wraps to. Neither banner can be dismissed.
 */
import { useLayoutEffect, useRef } from "react";
import { FixtureBanner } from "../components/FixtureBanner/index.js";
import { useClock } from "./ClockContext";
import styles from "./clock.module.css";

function Icon({ critical }: { critical: boolean }) {
  return critical ? (
    <svg width="20" height="20" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x="3" y="0" width="2" height="1" fill="currentColor" />
      <rect x="2" y="1" width="4" height="1" fill="currentColor" />
      <rect x="2" y="2" width="1" height="4" fill="currentColor" />
      <rect x="5" y="2" width="1" height="4" fill="currentColor" />
      <rect x="1" y="6" width="6" height="1" fill="currentColor" />
      <rect x="3" y="3" width="2" height="2" fill="currentColor" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect x="2" y="0" width="4" height="1" fill="currentColor" />
      <rect x="1" y="1" width="1" height="1" fill="currentColor" />
      <rect x="6" y="1" width="1" height="1" fill="currentColor" />
      <rect x="0" y="2" width="1" height="4" fill="currentColor" />
      <rect x="7" y="2" width="1" height="4" fill="currentColor" />
      <rect x="1" y="6" width="1" height="1" fill="currentColor" />
      <rect x="6" y="6" width="1" height="1" fill="currentColor" />
      <rect x="2" y="7" width="4" height="1" fill="currentColor" />
      <rect x="3" y="2" width="1" height="3" fill="currentColor" />
      <rect x="4" y="4" width="2" height="1" fill="currentColor" />
    </svg>
  );
}

export function ClockBanner() {
  const { view } = useClock();
  if (!view) return null;
  const critical = view.severity === "critical";
  return (
    <div className={`${styles.banner} ${critical ? styles.critical : styles.attention}`} role={critical ? "alert" : "status"}>
      <span className={styles.icon}><Icon critical={critical} /></span>
      <div className={styles.body}>
        <p className={styles.title}>{view.title}</p>
        <p className={styles.text}>{view.text}</p>
        {view.reason && <p className={styles.reason}>Why: {view.reason}</p>}
        {view.agesUncertain && <p className={styles.reason}>Ages marked ≈ are uncertain until the clock is fixed.</p>}
      </div>
    </div>
  );
}

export function TopBanners({ fixture }: { fixture: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Sticky from 768px up. On phones the block scrolls away with the page (it can be
    // ~180 px tall), so the navigation must not reserve space for it.
    const apply = (): void => {
      const sticky = getComputedStyle(el).position === "sticky";
      document.documentElement.style.setProperty("--banner-h", sticky ? `${el.offsetHeight}px` : "0px");
    };
    apply();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    ro?.observe(el);
    window.addEventListener("resize", apply);
    return () => { ro?.disconnect(); window.removeEventListener("resize", apply); document.documentElement.style.removeProperty("--banner-h"); };
  }, []);
  return (
    <div ref={ref} className={styles.stack}>
      {fixture && <FixtureBanner />}
      <ClockBanner />
    </div>
  );
}
