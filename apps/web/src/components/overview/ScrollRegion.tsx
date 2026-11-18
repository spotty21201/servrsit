/**
 * ScrollRegion — a labelled region that may scroll internally on desktop (the
 * Overview fits the window without page scrolling). It is a keyboard stop
 * (tabIndex 0) only while its content actually overflows, so a short list adds
 * no empty Tab stop; when it overflows axe requires exactly that.
 *
 * `onHidden` reports how many direct list items are cut off below the visible
 * area ("+N more"), updated on resize and scroll.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function ScrollRegion({ label, className, children, onHidden }: { label: string; className?: string | undefined; children: ReactNode; onHidden?: (n: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrollable, setScrollable] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      setScrollable(el.scrollHeight > el.clientHeight + 1);
      if (onHidden) {
        const items = [...el.querySelectorAll(":scope > ul > li, :scope > li")] as HTMLElement[];
        const bottom = el.scrollTop + el.clientHeight + 1;
        onHidden(el.scrollHeight > el.clientHeight + 1 ? items.filter((li) => li.offsetTop + li.offsetHeight > bottom).length : 0);
      }
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    el.addEventListener("scroll", measure, { passive: true });
    return () => { ro?.disconnect(); el.removeEventListener("scroll", measure); };
  });

  return (
    <div ref={ref} role="group" aria-label={label} tabIndex={scrollable ? 0 : undefined} className={className}>
      {children}
    </div>
  );
}
