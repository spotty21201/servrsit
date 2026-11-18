/**
 * Minimal path router (no dependency). Pure, so it is unit-tested.
 * Ids are opaque: letters, digits, "-" and "_" only, 1–64 chars.
 */
export type Route =
  | { readonly name: "overview" }
  | { readonly name: "plan"; readonly id: string }
  | { readonly name: "operation"; readonly id: string }
  | { readonly name: "fixtureClock" };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function matchRoute(pathname: string): Route {
  const clean = pathname.replace(/\/+$/, "");
  if (clean === "/fixtures/clock") return { name: "fixtureClock" };
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
