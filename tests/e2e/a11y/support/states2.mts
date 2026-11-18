/**
 * States for Designer's T-067 (server detail), T-068 (connect), T-070 (findings), T-071 (activity),
 * T-073 (baselines), T-074 (settings) and T-075 (overview list/empty). Each screen is the REAL component
 * reached through the real App router, with its own built-in [FIXTURE DATA] client; /api/fleet comes from the
 * scripted fake API. Only added when the screens exist in the checked-out code.
 *
 * Multi-step flows are walked by `walk`: on each step it fills every visible empty text field (found by its
 * label) with a valid synthetic value, picks the first radio of each group, and presses the step's primary
 * action. Every step is captured as its own state.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { installFetch, type Handler } from "./api.mts";
import { $, $$, click, h, mount, settle, type, waitFor } from "./render.mts";
import { WEB } from "./env.mts";
import type { Opened, State } from "./states.mts";

const authed: Record<string, Handler> = { "GET /api/auth/session": () => ({ json: { authenticated: true, username: "owner", csrfToken: "A".repeat(43), csrfHeader: "x-csrf-token", idleExpiresAt: new Date(Date.now() + 3.6e6).toISOString(), absoluteExpiresAt: new Date(Date.now() + 2.88e7).toISOString() } }) };
async function app(path: string): Promise<Opened> {
  const api = installFetch(authed);
  const App = (await import("../../../../apps/web/src/App.tsx")).default;
  const m = await mount(path, () => h(App));
  await waitFor(() => { const t = ($("main")?.textContent ?? "").trim(); return t.length > 0 && !/^Loading|Checking your session/.test(t); }, `${path} rendered`, 4000); // no h1 required: a missing h1 is a finding (ST-01), not a harness wait
  await settle(20);
  return { m, api };
}

const VALUES: [RegExp, string][] = [[/name/i, "Fixture Delta"], [/address|host/i, "100.64.1.40"], [/port/i, "22"], [/user/i, "servrsit"], [/role|purpose|describe/i, "web"], [/fingerprint/i, "SHA256:" + "A".repeat(43)], [/search/i, "fixture"], [/time/i, "02:00"]];
const labelOf = (el: HTMLInputElement): string => (el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? el.placeholder ?? "").trim();
async function fillStep(): Promise<void> {
  for (const el of $$<HTMLInputElement>("main input[type=text], main input:not([type]), main input[type=search]")) {
    if (el.value || el.disabled || el.closest("[hidden]")) continue;
    const v = VALUES.find(([re]) => re.test(labelOf(el)))?.[1]; if (v) await type(el, v);
  }
  const groups = new Map<string, HTMLInputElement>();
  for (const r of $$<HTMLInputElement>("main input[type=radio]")) if (!groups.has(r.name)) groups.set(r.name, r);
  for (const r of groups.values()) if (![...$$<HTMLInputElement>(`main input[type=radio][name="${r.name}"]`)].some((x) => x.checked)) await click(r);
}
const primary = (): HTMLButtonElement | undefined => $$<HTMLButtonElement>("main button[type=submit], main button[class*='primary']").find((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true");
/** Walk `steps` steps of a flow and return a state opener that stops after `n`. */
function walk(path: string, n: number, tickChecks = false): () => Promise<Opened> {
  return async () => {
    const x = await app(path);
    for (let i = 0; i < n; i++) {
      await fillStep();
      if (tickChecks) for (const c of $$<HTMLInputElement>("main input[type=checkbox]")) if (!c.checked && !c.disabled) await click(c);
      const before = $("h1, h2")?.textContent + "|" + ($("[aria-current='step']")?.textContent ?? "") + "|" + ($("main")?.textContent?.length ?? 0);
      const b = primary(); if (!b) break;
      await click(b); await settle(40);
      const after = $("h1, h2")?.textContent + "|" + ($("[aria-current='step']")?.textContent ?? "") + "|" + ($("main")?.textContent?.length ?? 0);
      if (before === after) break;
    }
    return x;
  };
}
const SRV = "11111111-1111-4111-a111-111111111111";

const exists = (dir: string) => existsSync(join(WEB, "src", dir));
const defs: (State & { dir: string })[] = [
  { dir: "servers", id: "server-detail", group: "overview", label: "T-067 server detail (fresh fixture server)", open: () => app(`/servers/${SRV}`) },
  { dir: "servers", id: "server-detail-unreachable", group: "overview", label: "T-067 server detail (unreachable)", open: () => app("/servers/22222222-2222-4222-a222-222222222222") },
  { dir: "servers", id: "server-detail-settings", group: "overview", label: "T-067 server detail, settings section", open: () => app(`/servers/${SRV}/settings`) },
  { dir: "servers", id: "server-detail-unknown", group: "overview", label: "T-067 server detail, unknown id", open: () => app("/servers/no-such-server") },
  { dir: "connect", id: "connect-0", group: "overview", label: "T-068 connect, step 1 (details)", open: () => app("/servers/new") },
  { dir: "connect", id: "connect-0-errors", group: "overview", label: "T-068 connect, step 1 submitted empty", open: async () => { const x = await app("/servers/new"); const b = $$<HTMLButtonElement>("main button[type=submit]")[0]; if (b) { await click(b); await settle(20); } return x; } },
  { dir: "connect", id: "connect-1", group: "overview", label: "T-068 connect, step 2", open: walk("/servers/new", 1) },
  { dir: "connect", id: "connect-2", group: "overview", label: "T-068 connect, step 3", open: walk("/servers/new", 2) },
  { dir: "connect", id: "connect-3", group: "overview", label: "T-068 connect, step 4", open: walk("/servers/new", 3, true) },
  { dir: "findings", id: "findings", group: "overview", label: "T-070 findings", open: () => app("/findings") },
  { dir: "findings", id: "findings-acknowledge", group: "overview", label: "T-070 findings, after Acknowledge", open: async () => { const x = await app("/findings"); const b = $$<HTMLButtonElement>("main button").find((e) => /^Acknowledge/.test(e.textContent ?? "") && !e.disabled); if (b) { await click(b); await settle(20); } return x; } },
  { dir: "activity", id: "activity", group: "overview", label: "T-071 activity", open: () => app("/activity") },
  { dir: "activity", id: "activity-search-empty", group: "overview", label: "T-071 activity, search with no results", open: async () => { const x = await app("/activity"); const s = $<HTMLInputElement>("main input[type=search]"); if (s) { await type(s, "zzzz-no-match-zzzz"); await settle(20); } return x; } },
  { dir: "baselines", id: "baselines-0", group: "overview", label: "T-073 baselines, choose reference", open: () => app("/baselines") },
  { dir: "baselines", id: "baselines-1", group: "overview", label: "T-073 baselines, conventions", open: walk("/baselines", 1) },
  { dir: "baselines", id: "baselines-2", group: "overview", label: "T-073 baselines, compare", open: walk("/baselines", 2) },
  { dir: "baselines", id: "baselines-3", group: "overview", label: "T-073 baselines, setup plan", open: walk("/baselines", 3) },
  { dir: "settings", id: "settings", group: "overview", label: "T-074 settings", open: () => app("/settings") },
  { dir: "settings", id: "overview-list", group: "overview", label: "T-075 overview stress fixture", open: () => app("/fixtures/overview") },
];
export const states2: State[] = defs.filter((d) => exists(d.dir)).map(({ dir: _d, ...s }) => s);
