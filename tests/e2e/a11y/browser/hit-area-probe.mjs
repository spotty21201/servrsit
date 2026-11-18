// D-U10 check: for every server card scrolled into view, sample a 5x5 grid and report how many points open the card (stretched link) vs other controls.
// Run like browser-check.mjs (PW, LD_LIBRARY_PATH; web built).
// Reproduces D-U16: Tab through /fixtures/overview and report focused controls covered by another element (WCAG 2.4.11).
// Run like browser-check.mjs: WEB_ROOT=<checkout> LD_LIBRARY_PATH=... node tests/e2e/a11y/browser/focus-obscured-probe.mjs
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
const ROOT = process.env.WEB_ROOT ?? join(here, "../../../..");
const DIST = join(ROOT, "apps/web/dist");
const { chromium } = createRequire(process.env.PW ?? "/tmp/pw/")("playwright-core");
const AXE = readFileSync(join(here, "../node_modules/axe-core/axe.min.js"), "utf8");
const ORIGIN = "http://127.0.0.1:5173";
const OUT = process.env.OUT ?? "/tmp/a11y/browser-results.json";
const ROOT_OVERRIDE = process.env.WEB_ROOT;

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






const browser = await chromium.launch({ headless: true });
for (const w of [1280, 1024, 390]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 } })).newPage(); await wire(page, { signedIn: true });
  await page.goto(ORIGIN + "/fixtures/overview", { waitUntil: "networkidle" }); await page.waitForSelector("h1"); await page.waitForTimeout(300);
  const n = await page.locator("article").count(); const out = [];
  for (let i = 0; i < n; i++) {
    await page.locator("article").nth(i).scrollIntoViewIfNeeded(); await page.waitForTimeout(50);
    out.push(await page.evaluate((i) => {
      const c = document.querySelectorAll("article")[i]; const cr = c.getBoundingClientRect(); const link = c.querySelector("a[class*=nameLink]"); const after = link ? getComputedStyle(link, "::after") : null;
      let hit = 0, other = 0, bar = 0, cnt = 0; const others = new Set();
      for (const gx of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const gy of [0.1, 0.3, 0.5, 0.7, 0.9]) { const t = document.elementFromPoint(cr.left + cr.width * gx, cr.top + cr.height * gy); if (!t) continue; cnt++;
        if (t === link) hit++; else if (t.closest("[class*=viewBar]")) bar++; else { const ctl = t.closest("a,button"); if (ctl) { other++; others.add(ctl.textContent.trim().slice(0, 22)); } } }
      return `${link?.textContent?.trim()} [${c.className.split(" ").map((x) => x.replace(/^_?([a-zA-Z]+)_.*/, "$1")).join(" ")}]: opens ${hit}/${cnt}, view bar ${bar}, other controls ${other} (${[...others].join("; ")}), ::after content=${after?.content} pos=${after?.position}`;
    }, i));
  }
  console.log(`== ${w}px`); for (const o of out) console.log("  " + o);
  if (w === 1280) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: process.env.SHOT ?? "/tmp/overlap-1280.png", clip: { x: 100, y: 150, width: 800, height: 160 } }); }
}
await browser.close();
