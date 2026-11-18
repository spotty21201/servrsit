/**
 * Real-browser sign-in walkthrough on the release candidate (UX 7.1, FR-01, T-053/T-066, T-065/T-080):
 * enrol with the setup token, TOTP from my own RFC 6238 code (tests/e2e/auth/support/totp.mts, never the product's
 * library), save recovery codes, sign out, sign in with a TOTP code, sign out, sign in with a recovery code, the
 * recovery code is refused a second time, and a wrong password is refused. axe (contrast on) runs at every step.
 *
 * Everything runs in ONE process and is torn down at the end: my OWN API instance (buildServer, fixture mode, synthetic
 * config, a temp auth database) listening on a random loopback port, the built web app (apps/web/dist) served through
 * Playwright request interception, and headless Chromium. Nothing else is contacted; never the founder's :3001.
 *
 * Run:  pnpm --filter @servrsit/web build
 *       cd apps/api && PW=/tmp/pw/ LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu pnpm exec tsx ../../tests/e2e/a11y/browser/signin-walkthrough.mts
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "../../../../apps/api/src/server.ts";
import { FleetConfigSchema } from "../../../../apps/api/src/fleet/config.ts";
import { SqliteAuthStore } from "../../../../packages/store/src/index.ts";
import { totp } from "../../auth/support/totp.mts";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../../../..");
const DIST = join(process.env.WEB_ROOT ?? ROOT, "apps/web/dist");
const OUT = process.env.OUT ?? join(ROOT, "docs/team/evidence/next-001");
const ORIGIN = "http://127.0.0.1:5173";
const { chromium } = createRequire(process.env.PW ?? "/tmp/pw/")("playwright-core");
const AXE = readFileSync(join(here, "../node_modules/axe-core/axe.min.js"), "utf8");
const PASSWORD = "walkthrough-only-password-0001"; // synthetic, test only

const steps: { step: string; ok: boolean; note: string; axe: string[]; focus: string }[] = [];
const fail = (m: string): never => { throw new Error(m); };

// ------------------------------------------------------------------------------------------- my own API instance
const dir = mkdtempSync(join(tmpdir(), "tester-walkthrough-"));
let setupToken: string | null = null;
const config = FleetConfigSchema.parse({ healthIntervalMinutes: 15, ownerTimeZone: "Asia/Jakarta", registration: {},
  hosts: [{ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", name: "Walk Alpha", role: null, production: true, importantServices: [], collect: true, writesEnabled: false, access: "ssh", address: "100.64.1.10", port: 22, user: "servrsit" },
          { id: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb", name: "Walk Bravo", role: null, production: false, importantServices: [], collect: true, writesEnabled: false, access: "ssh", address: "100.64.1.11", port: 22, user: "servrsit" }] });
const api = await buildServer({ config: config as never, mode: "fixture", startChecks: false, logger: false, ownerContextPath: null,
  auth: { store: new SqliteAuthStore({ path: join(dir, "auth.db") }), onSetupToken: (t: string) => { setupToken = t; } } } as never);
await api.listen({ host: "127.0.0.1", port: 0 });
const apiBase = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
if (apiBase.endsWith(":3001")) fail("refusing to use port 3001");

// ------------------------------------------------------------------------------------------- browser
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage(); const consoleErrors: string[] = [];
page.on("pageerror", (e: Error) => consoleErrors.push(String(e).slice(0, 160)));
await page.route("**/*", async (route: any) => {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) return route.abort();
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
    const resp = await route.fetch({ url: apiBase + url.pathname + url.search }); return route.fulfill({ response: resp });
  }
  let file = join(DIST, url.pathname === "/" ? "index.html" : url.pathname); if (!existsSync(file) || url.pathname.endsWith("/")) file = join(DIST, "index.html");
  const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
  return route.fulfill({ status: 200, contentType: types[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
});
mkdirSync(OUT, { recursive: true });
async function record(step: string, ok: boolean, note: string): Promise<void> {
  await page.waitForTimeout(150);
  const axe = await page.evaluate(async (src: string) => { if (!(window as any).axe) (0, eval)(src); const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } }); return r.violations.map((v: any) => `${v.id} (${v.nodes.length})`); }, AXE);
  const focus = await page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}` : "none"; });
  // Screens that show the authenticator key or the recovery codes are never captured (credentials stay out of evidence).
  if (!/^setup-(authenticator|recovery-codes)$/.test(step)) await page.screenshot({ path: join(OUT, `${String(steps.length + 1).padStart(2, "0")}-${step}.png`) });
  steps.push({ step, ok, note, axe, focus }); console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${note}${axe.length ? ` | axe: ${axe.join(", ")}` : ""}`);
}
const btn = (name: string | RegExp) => page.getByRole("button", { name });
const nextTotpWindow = async () => { const ms = 30_000 - (Date.now() % 30_000) + 500; await page.waitForTimeout(ms); }; // a step can be used once

let recovery: string[] = [];
let secret = "";
try {
  await page.goto(ORIGIN + "/", { waitUntil: "networkidle" });
  await page.getByLabel("Username").waitFor({ timeout: 8000 });
  await record("signin-first-load", (await page.title()).length > 0, `title "${await page.title()}"`);

  // 1. enrol
  if (!setupToken) fail("my API instance did not hand out a setup token");
  await btn("Set up the owner account").click(); await page.getByLabel("Setup token").waitFor();
  await page.getByLabel("Setup token").fill(setupToken!); await page.getByLabel("Username").fill("owner"); await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await btn(/Continue to authenticator/).click(); await page.getByLabel("6-digit code from the app").waitFor({ timeout: 8000 });
  secret = (await page.locator("[class*='key']").filter({ hasText: /^[A-Z2-7 ]{16,}$/ }).first().innerText()).replace(/\s+/g, "");
  const qr = await page.locator("svg[role=img]").count();
  await record("setup-authenticator", secret.length >= 16 && qr === 1, `key shown as text (${secret.length} chars), QR ${qr}`);
  await page.getByLabel("6-digit code from the app").fill(totp(secret, Date.now())); await btn(/Confirm and create account/).click();
  await page.locator("ul[aria-label='Recovery codes'] li").first().waitFor({ timeout: 8000 });
  recovery = await page.locator("ul[aria-label='Recovery codes'] li").allInnerTexts();
  const contBefore = await btn(/Continue to ServrSit/).getAttribute("aria-disabled") ?? String(await btn(/Continue to ServrSit/).isDisabled());
  await record("setup-recovery-codes", recovery.length === 10 && /true/.test(contBefore), `${recovery.length} codes; Continue unavailable before ticking: ${contBefore}`);
  await btn(/Continue to ServrSit/).focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(200); // keyboard path: an aria-disabled button must do nothing
  const stillHere = await page.locator("ul[aria-label='Recovery codes']").count();
  await page.getByLabel("I saved these recovery codes").check(); await btn(/Continue to ServrSit/).click();
  await page.getByRole("heading", { level: 1 }).waitFor(); await page.waitForTimeout(400);
  const h1 = await page.getByRole("heading", { level: 1 }).innerText();
  await record("signed-in-after-setup", stillHere === 1 && !/Sign in|Set up/.test(h1), `pressing Continue before ticking kept the codes page: ${stillHere === 1}; now on "${h1}"`);

  // 2. sign out
  await btn(/^Sign out/).first().click(); await page.getByLabel("Username").waitFor({ timeout: 8000 });
  await record("signed-out", (await page.locator("text=signed out").count()) > 0, "signed-out notice shown");

  // 3. sign in with TOTP (next 30 s step: the setup confirmation used the current one)
  await page.getByLabel("Username").fill("owner"); await page.getByLabel("Password", { exact: true }).fill(PASSWORD); await btn(/^Continue$/).click();
  await page.getByLabel("6-digit code").waitFor({ timeout: 8000 }); await nextTotpWindow();
  await page.getByLabel("6-digit code").fill(totp(secret, Date.now())); await btn(/^Sign in$/).click();
  await page.waitForTimeout(800); const signedIn = (await page.getByLabel("Username").count()) === 0 && (await btn(/^Sign out/).count()) > 0;
  await record("signed-in-with-totp", signedIn, `own RFC 6238 code accepted: ${signedIn}`);

  // 4. sign out, sign in with a recovery code
  await btn(/^Sign out/).first().click(); await page.getByLabel("Username").waitFor({ timeout: 8000 });
  await page.getByLabel("Username").fill("owner"); await page.getByLabel("Password", { exact: true }).fill(PASSWORD); await btn(/^Continue$/).click();
  await btn(/Use a recovery code instead/).click(); await page.locator("#si-rec").fill(recovery[0]!); await btn(/Sign in with recovery code/).click();
  await page.waitForTimeout(800); const viaRecovery = (await btn(/^Sign out/).count()) > 0;
  await record("signed-in-with-recovery-code", viaRecovery, `recovery code accepted: ${viaRecovery}`);

  // 5. the same recovery code a second time is refused
  await btn(/^Sign out/).first().click(); await page.getByLabel("Username").waitFor({ timeout: 8000 });
  await page.getByLabel("Username").fill("owner"); await page.getByLabel("Password", { exact: true }).fill(PASSWORD); await btn(/^Continue$/).click();
  await btn(/Use a recovery code instead/).click(); await page.locator("#si-rec").fill(recovery[0]!); await btn(/Sign in with recovery code/).click();
  await page.locator("[role=alert]").first().waitFor({ timeout: 8000 }); const reuseText = await page.locator("[role=alert]").first().innerText();
  await record("recovery-code-reuse-refused", (await btn(/^Sign out/).count()) === 0, `alert: "${reuseText.slice(0, 90)}"`);

  // 6. a wrong password is refused with a non-disclosing message
  await btn(/Use the authenticator code instead/).click().catch(() => undefined); await btn(/Start over/).click().catch(() => undefined);
  await page.getByLabel("Username").waitFor({ timeout: 8000 }); await page.getByLabel("Username").fill("owner"); await page.getByLabel("Password", { exact: true }).fill("not-the-password-000");
  await btn(/^Continue$/).click(); await page.locator("[role=alert]").first().waitFor({ timeout: 8000 }); const wrongText = await page.locator("[role=alert]").first().innerText();
  await record("wrong-password-refused", !/not exist|no such|unknown user/i.test(wrongText), `alert: "${wrongText.slice(0, 90)}"`);
} catch (e) {
  steps.push({ step: "aborted", ok: false, note: String(e).slice(0, 300), axe: [], focus: "" }); console.log(`FAIL aborted: ${String(e).slice(0, 300)}`);
} finally {
  await browser.close(); await api.close(); rmSync(dir, { recursive: true, force: true });
  const summary = { at: new Date().toISOString(), api: "own instance, fixture mode, random loopback port", steps, consoleErrors, secretsInEvidence: false };
  writeFileSync(join(OUT, "signin-walkthrough.json"), JSON.stringify(summary, null, 1));
  // never keep the TOTP secret or recovery codes in evidence or logs
  const ev = readFileSync(join(OUT, "signin-walkthrough.json"), "utf8"); if ((secret && ev.includes(secret)) || recovery.some((c) => ev.includes(c))) fail("a secret reached the evidence file");
  console.log(`${steps.filter((s) => s.ok).length} of ${steps.length} steps passed; console errors: ${consoleErrors.length}`);
  process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
}
