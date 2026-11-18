/**
 * Minimal path router (no dependency). Pure, so it is unit-tested.
 * Ids are opaque: letters, digits, "-" and "_" only, 1–64 chars.
 */
export type Route =
  | { readonly name: "overview" }
  | { readonly name: "plan"; readonly id: string }
  | { readonly name: "operation"; readonly id: string }
  | { readonly name: "fixtureClock" }
  | { readonly name: "server"; readonly id: string; readonly section: "settings" | "verify" | null }
  | { readonly name: "connect" }
  | { readonly name: "findings" }
  | { readonly name: "fixtureOverview" }
  | { readonly name: "fixtureConnect" }
  | { readonly name: "fixtureFindings" }
  | { readonly name: "fixtureActivity" }
  | { readonly name: "fixtureBaselines" }
  | { readonly name: "fixtureSettings" }
  | { readonly name: "baselines" }
  | { readonly name: "settings" }
  | { readonly name: "activity" };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function matchRoute(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, "");
  if (clean === "/fixtures/clock") return { name: "fixtureClock" };
  if (clean === "/servers/new") return { name: "connect" };
  if (clean === "/findings") return { name: "findings" };
  if (clean === "/fixtures/connect") return { name: "fixtureConnect" };
  if (clean === "/fixtures/findings") return { name: "fixtureFindings" };
  if (clean === "/fixtures/settings") return { name: "fixtureSettings" };
  if (clean === "/fixtures/baselines") return { name: "fixtureBaselines" };
  if (clean === "/fixtures/activity") return { name: "fixtureActivity" };
  if (clean === "/fixtures/overview") return { name: "fixtureOverview" };
  if (clean === "/baselines") return { name: "baselines" };
  if (clean === "/settings") return { name: "settings" };
  if (clean === "/activity") return { name: "activity" };
  const sv = /^\/servers\/([^/]+)(?:\/(settings|verify))?$/.exec(clean);
  if (sv?.[1]) {
    let id: string;
    try { id = decodeURIComponent(sv[1]); } catch { return { name: "overview" }; }
    if (ID.test(id)) return { name: "server", id, section: (sv[2] as "settings" | "verify" | undefined) ?? null };
  }
  const m = /^\/(plans|operations)\/([^/]+)$/.exec(clean);
  if (m?.[1] && m[2]) {
    let id: string;
    try { id = decodeURIComponent(m[2]); } catch { return { name: "overview" }; }
    if (ID.test(id)) return m[1] === "plans" ? { name: "plan", id } : { name: "operation", id };
  }
  return { name: "overview" };
}

export const planPath = (id: string): string => `/plans/${encodeURIComponent(id)}`;
export const operationPath = (id: string): string => `/operations/${encodeURIComponent(id)}`;

export const serverPath = (id: string): string => `/servers/${encodeURIComponent(id)}`;
