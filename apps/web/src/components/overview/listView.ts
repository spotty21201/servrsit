/**
 * listView — view mode, sort order and saved preference for the Overview
 * roster (T-075, UX Spec §5.2). Pure; no React.
 *
 * Rules carried here:
 *   - the compact list and the sort control are offered from 6 servers;
 *   - sort keys are attention (default), name, last check (oldest first);
 *   - the initial order is computed on entry. Later status changes update in
 *     place and never reshuffle the list under the owner: the order changes
 *     only when the owner changes the sort or presses "Update order";
 *   - the saved preference holds only the view and the sort key.
 */
import type { ServerCardVM } from "./fleetViewModel";

export type ViewMode = "cards" | "list";
export type SortKey = "attention" | "name" | "last-check";

export interface OverviewPrefs {
  readonly view: ViewMode;
  readonly sort: SortKey;
}

export const DEFAULT_PREFS: OverviewPrefs = { view: "cards", sort: "attention" };
export const PREFS_KEY = "servrsit.overview.prefs.v1";
/** Below this many servers the roster is always cards and has no sort control. */
export const LIST_THRESHOLD = 6;

export const SORT_LABEL: Readonly<Record<SortKey, string>> = {
  attention: "Needs attention first",
  name: "Name, A to Z",
  "last-check": "Last check, oldest first",
};

export function parsePrefs(text: string | null): OverviewPrefs {
  if (!text || text.length > 512) return DEFAULT_PREFS;
  try {
    const j = JSON.parse(text) as { view?: unknown; sort?: unknown };
    return {
      view: j.view === "list" ? "list" : "cards",
      sort: j.sort === "name" || j.sort === "last-check" ? j.sort : "attention",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const serializePrefs = (p: OverviewPrefs): string => JSON.stringify({ view: p.view, sort: p.sort });

export const offersList = (count: number): boolean => count >= LIST_THRESHOLD;

/** The view actually shown: the list only when it is offered and chosen. */
export const effectiveView = (prefs: OverviewPrefs, count: number): ViewMode => (offersList(count) && prefs.view === "list" ? "list" : "cards");

const RANK: Readonly<Record<ServerCardVM["statusKey"], number>> = { failed: 0, attention: 1, unknown: 2, progress: 3, passed: 4 };

export function sortCards(cards: readonly ServerCardVM[], key: SortKey): ServerCardVM[] {
  const byName = (a: ServerCardVM, b: ServerCardVM): number => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });
  const t = (c: ServerCardVM): number => (c.observedAt ? Date.parse(c.observedAt) : Number.NEGATIVE_INFINITY);
  return [...cards].sort((a, b) => {
    if (key === "name") return byName(a, b);
    if (key === "last-check") return t(a) - t(b) || byName(a, b); // never observed first, then oldest
    return RANK[a.statusKey] - RANK[b.statusKey] || Number(b.isProduction) - Number(a.isProduction) || byName(a, b);
  });
}

export const orderIds = (cards: readonly ServerCardVM[], key: SortKey): string[] => sortCards(cards, key).map((c) => c.id);

/** Latest data in the remembered order. New servers go last; removed ones drop out. */
export function applyOrder(cards: readonly ServerCardVM[], ids: readonly string[], key: SortKey): ServerCardVM[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const known = ids.map((id) => byId.get(id)).filter((c): c is ServerCardVM => c !== undefined);
  const seen = new Set(ids);
  return [...known, ...sortCards(cards.filter((c) => !seen.has(c.id)), key)];
}

/** True when sorting the current data now would give a different order than the one shown. */
export function orderDiffers(cards: readonly ServerCardVM[], ids: readonly string[], key: SortKey): boolean {
  const shown = applyOrder(cards, ids, key).map((c) => c.id);
  const fresh = orderIds(cards, key);
  return shown.length !== fresh.length || shown.some((id, i) => id !== fresh[i]);
}
