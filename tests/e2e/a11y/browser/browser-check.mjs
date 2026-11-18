/**
 * Real-browser spot check of what the jsdom pass could only estimate: rendered colour contrast (axe with
 * contrast ON), measured target sizes, real Tab order against visual order, focus indicators, 320 px reflow.
 *
 * NOT part of `pnpm test`: it needs a Chromium and Playwright that are not repo dependencies.
 *   node tests/e2e/a11y/browser/browser-check.mjs        (after: pnpm --filter @servrsit/web build)
 * Environment:
 *   PW=/tmp/pw/                            directory containing node_modules/playwright-core
 *   LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu   system libraries Chromium needs, if missing
 * No server is started: the built files in apps/web/dist are served through request interception and
 * every /api call is answered by a mock below. Synthetic data only. Nothing leaves this machine.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../../../..");
const DIST = join(ROOT, "apps/web/dist");
const { chromium } = createRequire(process.env.PW ?? "/tmp/pw/")("playwright-core");
const AXE = readFileSync(join(here, "../node_modules/axe-core/axe.min.js"), "utf8");
const ORIGIN = "http://127.0.0.1:5173";
const OUT = process.env.OUT ?? "/tmp/a11y/browser-results.json";

// ------------------------------------------------------------------ mock API (same shapes as support/api.mts)
const CSRF = "A".repeat(43);
const session = () => ({ authenticated: true, username: "owner", csrfToken: CSRF, csrfHeader: "x-csrf-token", idleExpiresAt: new Date(Date.now() + 3.6e6).toISOString(), absoluteExpiresAt: new Date(Date.now() + 2.88e7).toISOString() });
const server = (id, name, status, latestAttempt = null) => ({ id, name, role: null, production: false, importantServices: [], access: "ssh", source: "fixture", status, statusReason: `[FIXTURE DATA] Synthetic ${status} server.`, observedAt: new Date(Date.now() - 6e4).toISOString(), freshUntil: new Date(Date.now() + (status === "stale" ? -1 : 1) * 6e5).toISOString(), coverage: null, latestAttempt, findings: [], observation: null });
const fleet = () => ({ mode: "fixture", generatedAt: new Date().toISOString(), healthIntervalMinutes: 15, ownerTimeZone: "Asia/Jakarta", nextCheckAt: null, controlPlane: { clock: { status: "not-checked", checkedAt: null, ntpSynchronized: null, offsetSeconds: null, uncertaintySeconds: null, basis: "none", sources: [], reason: "[FIXTURE DATA] Fixture mode does not check ServrSit's own clock." }, findings: [] }, servers: [
  server("11111111-1111-4111-a111-111111111111", "Fixture One", "fresh"),
  server("22222222-2222-4222-a222-222222222222", "Fixture Two", "unreachable", { at: new Date().toISOString(), succeeded: false, failure: { code: "ROUTE_UNAVAILABLE", message: "The host could not be reached." }, consecutiveFailures: 2 }),
  server("33333333-3333-4333-a333-333333333333", "Fixture Three", "stale")] });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function wire(page, st) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    const p = url.pathname; const m = route.request().method();
    if (p.startsWith("/api/")) {
      if (p === "/api/auth/session") return json(route, st.signedIn ? session() : { authenticated: false });
      if (p === "/api/auth/login") return st.loginError ? json(route, { error: "INVALID_CREDENTIALS" }, 401) : json(route, { next: "totp" });
      if (p === "/api/auth/totp") { st.signedIn = true; return json(route, session()); }
      if (p === "/api/auth/setup") return json(route, { totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/ServrSit:owner?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=ServrSit", expiresInSeconds: 900 });
      if (p === "/api/auth/logout") { st.signedIn = false; return route.fulfill({ status: 204 }); }
      if (p === "/api/fleet") return json(route, fleet());
      if (p === "/api/csrf") return json(route, { token: CSRF, header: "x-csrf-token" });
      return json(route, { error: "NOT_FOUND" }, 404);
    }
    let file = join(DIST, p === "/" ? "index.html" : p);
    if (!existsSync(file) || p.endsWith("/")) file = join(DIST, "index.html"); // SPA fallback
    const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png", ".map": "application/json" };
    return route.fulfill({ status: 200, contentType: types[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
  });
}

// ------------------------------------------------------------------ states and viewports
const fillSignIn = async (p) => { await p.fill("#si-user", "owner"); await p.fill("#si-pass", "synthetic-password-0001"); };
const states = [
  { id: "signin", path: "/", signedIn: false },
  { id: "signin-code", path: "/", signedIn: false, drive: async (p) => { await fillSignIn(p); await p.click("text=Continue"); await p.waitForSelector("#si-code"); } },
  { id: "signin-error", path: "/", signedIn: false, loginError: true, drive: async (p) => { await fillSignIn(p); await p.click("text=Continue"); await p.waitForSelector("[role=alert]"); } },
  { id: "setup-details", path: "/", signedIn: false, drive: async (p) => { await p.click("text=Set up the owner account"); await p.waitForSelector("#su-token"); } },
  { id: "setup-enrol", path: "/", signedIn: false, drive: async (p) => { await p.click("text=Set up the owner account"); await p.fill("#su-token", "synthetic-setup-token-0001"); await p.fill("#su-pass", "synthetic-password-0001"); await p.click("text=Continue to authenticator"); await p.waitForSelector("#su-code"); } },
  { id: "overview", path: "/", signedIn: true, ready: "text=Fixture One" },
  { id: "plan-production", path: "/plans/fixture-plan-production", signedIn: true, ready: "h1" },
  { id: "plan-writes-off", path: "/plans/fixture-plan-writes-off", signedIn: true, ready: "h1" },
  { id: "op-running", path: "/operations/fixture-op-running", signedIn: true, ready: "h1" },
  { id: "op-unknown", path: "/operations/fixture-op-unknown", signedIn: true, ready: "h1" },
  { id: "clock-fixture", path: "/fixtures/clock", signedIn: true, ready: "h1" },
];
const viewports = [
  { id: "desktop-1280", width: 1280, height: 800 }, { id: "tablet-1024", width: 1024, height: 768 }, { id: "tablet-768", width: 768, height: 1024 },
  { id: "mobile-390", width: 390, height: 844, touch: true }, { id: "narrow-320", width: 320, height: 640, touch: true },
];

// ------------------------------------------------------------------ in-page measurements
const measure = async (page) => page.evaluate(async (axeSource) => {
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const sel = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex='-1'])";
  const nameOf = (e) => norm(e.getAttribute("aria-label") || (e.labels && e.labels[0]?.textContent) || e.textContent || e.getAttribute("title") || e.id);
  const inlineInText = (e) => e.tagName === "A" && !!e.closest("p, li") && getComputedStyle(e).display === "inline";
  const targets = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => {
    const isCheck = e instanceof HTMLInputElement && (e.type === "checkbox" || e.type === "radio");
    const t = isCheck ? (e.closest("label") ?? e) : e; const r = t.getBoundingClientRect();
    return { tag: t.tagName.toLowerCase() + (t.className && typeof t.className === "string" ? "." + t.className.split(" ")[0].replace(/^.*__/, "") : ""), name: nameOf(e).slice(0, 36), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, x: Math.round(r.x), y: Math.round(r.y + scrollY), inline: inlineInText(e), disabled: !!e.disabled };
  });
  if (!window.axe) (0, eval)(axeSource);
  const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations", "incomplete"] });
  const slim = (l) => l.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(" "), summary: (n.failureSummary ?? "").split("\n").slice(1, 3).join(" ").slice(0, 160) })) }));
  return { title: document.title, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, targets, axe: { violations: slim(res.violations), incomplete: slim(res.incomplete) } };
}, AXE);

async function tabWalk(page, max = 45) {
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  const stops = []; let first = null;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      const label = (e.getAttribute("aria-label") || (e.labels && e.labels[0]?.textContent) || e.textContent || e.id || "").replace(/\s+/g, " ").trim().slice(0, 34);
      return { tag: e.tagName.toLowerCase(), name: label, x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow !== "none", underline: cs.textDecorationLine, bg: cs.backgroundColor,
        // a control whose ring is drawn by a container (:focus-within), e.g. the Ask ServrSit console
        // WCAG 2.4.11 (AA, 2.2): is the focused control hidden under a sticky or fixed element that does not contain it?
        obscured: (() => { const f = e.getBoundingClientRect(); if (!f.width || !f.height) return 0; let worst = 0;
          for (const o of document.querySelectorAll("body *")) { const k = getComputedStyle(o); if ((k.position !== "sticky" && k.position !== "fixed") || o.contains(e) || e.contains(o)) continue;
            const r = o.getBoundingClientRect(); const w = Math.min(f.right, r.right) - Math.max(f.left, r.left); const h = Math.min(f.bottom, r.bottom) - Math.max(f.top, r.top);
            if (w > 0 && h > 0) worst = Math.max(worst, (w * h) / (f.width * f.height)); } return Math.round(worst * 100); })(),
        container: (() => { const c = e.closest("[class*=console]"); if (!c) return null; const k = getComputedStyle(c); return `${k.outlineStyle} ${k.outlineWidth} ${k.outlineColor}`; })() };
    });
    if (!s) break; const key = `${s.tag}|${s.name}|${s.x}|${s.y}`;
    if (first === null) first = key; else if (key === first) break;
    stops.push(s);
  }
  // reading order: a later stop must not be clearly ABOVE the previous one, nor clearly LEFT of it on the same row
  const order = [];
  for (let i = 1; i < stops.length; i++) { const a = stops[i - 1], b = stops[i]; if (b.y + b.h / 2 < a.y - 12 || (Math.abs(b.y - a.y) < 12 && b.x < a.x - 12 && b.y <= a.y)) order.push(`#${i} "${a.name}" (${a.x},${a.y}) -> "${b.name}" (${b.x},${b.y})`); }
  const noIndicator = stops.filter((s) => /^none/.test(s.outline) && !s.shadow && s.underline === "none" && !(s.container && !/^none/.test(s.container))).map((s) => `${s.tag} "${s.name}"`);
  return { stops, orderViolations: order, noIndicator };
}

// ------------------------------------------------------------------ run
const browser = await chromium.launch({ headless: true });
const results = []; const t0 = Date.now();
for (const vp of viewports) for (const st0 of states) {
  const st = { ...st0 };
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch, deviceScaleFactor: 1, locale: "en-US" });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120))); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
  await wire(page, st);
  try {
    await page.goto(ORIGIN + st.path, { waitUntil: "networkidle" });
    if (st.ready) await page.waitForSelector(st.ready, { timeout: 5000 }); else await page.waitForSelector("h1", { timeout: 5000 });
    if (st.drive) await st.drive(page);
    await page.waitForTimeout(150);
    const m = await measure(page);
    const tab = await tabWalk(page);
    results.push({ state: st0.id, viewport: vp.id, ...m, tab, errors });
  } catch (e) { results.push({ state: st0.id, viewport: vp.id, failed: String(e).slice(0, 200), errors }); }
  await ctx.close();
}

// sign-out: where does keyboard focus land? (real browser)
{
  const st = { signedIn: true }; const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); await wire(page, st);
  try {
    await page.goto(ORIGIN + "/", { waitUntil: "networkidle" }); await page.waitForSelector("h1");
    await page.focus("button:has-text('Sign out')"); await page.keyboard.press("Enter"); await page.waitForSelector("#si-user"); await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ active: document.activeElement?.tagName.toLowerCase() + (document.activeElement?.id ? "#" + document.activeElement.id : ""), notice: document.querySelector("[role=status]")?.textContent?.slice(0, 60) ?? null }));
    results.push({ state: "sign-out-focus", viewport: "desktop-1280", signOutFocus: after });
  } catch (e) { results.push({ state: "sign-out-focus", viewport: "desktop-1280", failed: String(e).slice(0, 200) }); }
  await ctx.close();
}
await browser.close();
mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), results }, null, 1));
console.log(`wrote ${OUT}: ${results.length} runs in ${Math.round((Date.now() - t0) / 1000)} s; failed: ${results.filter((r) => r.failed).length}`);
