/**
 * ScrollRegion — internally scrolling column body (round 4, desktop ≥1024px)
 *
 * Only on desktop is the region height-limited (CSS). When its content
 * overflows, it becomes:
 *   - keyboard reachable: tabIndex=0, so arrow keys / PageDown scroll it
 *   - a labelled landmark: role="region" + aria-label
 *   - visibly scrollable: a "More below" cue while content remains below,
 *     plus a thin always-present scrollbar (CSS)
 * When it does not overflow (mobile, tablet, or short lists) it is a plain
 * div: no dead tab stop, no extra landmark.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./ScrollRegion.module.css";

interface ScrollRegionProps {
  /** Accessible name used when the region is scrollable, e.g. "Servers list". */
  label: string;
  children: ReactNode;
}

export function ScrollRegion({ label, children }: ScrollRegionProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const [moreBelow, setMoreBelow] = useState(false);

  useEffect(() => {
    const region = regionRef.current;
    const content = contentRef.current;
    if (!region || !content) return;

    const update = () => {
      const overflow = region.scrollHeight - region.clientHeight;
      setScrollable(overflow > 1);
      setMoreBelow(overflow - region.scrollTop > 1);
    };

    update();
    region.addEventListener("scroll", update, { passive: true });
    // Region size changes (viewport resize) and content size changes (fonts
    // loading, data changes) both affect overflow.
    const ro = new ResizeObserver(update);
    ro.observe(region);
    ro.observe(content);

    return () => {
      region.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return (
    <div className={styles.outer}>
      <div
        ref={regionRef}
        className={styles.region}
        {...(scrollable
          ? { role: "region", "aria-label": label, tabIndex: 0 }
          : {})}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {moreBelow && (
        <div className={styles.more} aria-hidden="true">
          <span className={styles.moreLabel}>
            More below
            <svg width="12" height="12" viewBox="0 0 6 6" shapeRendering="crispEdges" focusable="false">
              <rect x="0" y="1" width="6" height="1" fill="currentColor" />
              <rect x="1" y="2" width="4" height="1" fill="currentColor" />
              <rect x="2" y="3" width="2" height="1" fill="currentColor" />
            </svg>
          </span>
        </div>
      )}
    </div>
  );
}
