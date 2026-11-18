/**
 * Page titles and route announcements (WCAG 2.4.2, T-072 / D-U1).
 *
 * Every screen sets a descriptive document title ("Plan review: Update
 * packages on Nabire · ServrSit"). When the title changes after the first one
 * of the page load, a polite live region (RouteAnnouncer, rendered once in
 * App) says "Navigated to …", so a screen reader user hears the new place even
 * when the app changes screens without a page load (sign-in steps, connect
 * steps). Loading placeholders pass `announce: false` so they are not spoken.
 */
import { useEffect } from "react";

export const SITE_NAME = "ServrSit";

export function formatTitle(page: string): string {
  const p = page.trim();
  return p === "" ? SITE_NAME : `${p} · ${SITE_NAME}`;
}

type Listener = (message: string) => void;
let listener: Listener | null = null;
let first = true;

/** Subscribe the announcer; returns an unsubscribe function. */
export function onAnnounce(l: Listener): () => void {
  listener = l;
  return () => { if (listener === l) listener = null; };
}

/** For tests. */
export function resetPageTitleState(): void { first = true; listener = null; }

export function setPageTitle(page: string, announce = true, doc: { title: string } = document): void {
  const next = formatTitle(page);
  const changed = doc.title !== next;
  doc.title = next;
  if (announce && changed && !first) listener?.(`Navigated to ${page}`);
  if (announce) first = false;
}

export function usePageTitle(page: string, announce = true): void {
  useEffect(() => { setPageTitle(page, announce); }, [page, announce]);
}
