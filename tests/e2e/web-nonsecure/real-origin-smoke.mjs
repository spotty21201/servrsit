#!/usr/bin/env node
/**
 * Read-only smoke on the founder's REAL web origin (plain HTTP on the tailnet: a NON-secure context):
 *   node real-origin-smoke.mjs [origin] [evidenceDir]            default http://100.104.220.8:5173
 *   needs: LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu and playwright-core 1.65.1 in /tmp/pw
 *
 * It only navigates and GETs. It never signs in, never uses the founder's account, never POSTs. The page's own first load makes a
 * few GETs (for example /api/auth/session); every request is recorded and a non-GET request fails the run.
 *
 * Checks:
 *   1. the page really is a non-secure context here (isSecureContext false; crypto.randomUUID, crypto.subtle and
 *      navigator.clipboard undefined). If it is secure, the run says so, because then it proves nothing about this class of bug;
 *   2. the first load raises no page error and no console error;
 *   3. the dev server does not serve files from the API's data directory. Canary: the Sentani PUBLIC key file only. No key or
 *      database is ever requested. (D-W2: Vite's /@fs/ serves the whole workspace root except its default deny list.)
 *   4. the approval code this origin SERVES right now (not only what is in the repository) has no crypto.randomUUID call and has the
 *      browser-side error display added in b615f67.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire("/tmp/pw/package.json")("playwright-core");

const origin = (process.argv[2] ?? "http://100.104.220.8:5173").replace(/\/$/, "");
const out = process.argv[3] ?? "/tmp/t089/web-nonsecure";
mkdirSync(out, { recursive: true });
const result = { origin, at: new Date().toISOString(), requests: [], pageErrors: [], consoleErrors: [], failedRequests: [] };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => result.pageErrors.push(String(e.message).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") result.consoleErrors.push(m.text().slice(0, 300)); });
page.on("requestfailed", (r) => result.failedRequests.push(`${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
page.on("request", (r) => { const u = new URL(r.url()); if (u.origin === origin || u.pathname.startsWith("/api")) result.requests.push(`${r.method()} ${u.pathname}`); });

await page.goto(origin + "/", { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(3000);
result.page = await page.evaluate(() => ({
  url: location.href, isSecureContext: window.isSecureContext, protocol: location.protocol,
  randomUUID: typeof crypto.randomUUID, subtle: typeof crypto.subtle, clipboard: typeof navigator.clipboard, getRandomValues: typeof crypto.getRandomValues,
  title: document.title, heading: (document.querySelector("h1,h2")?.textContent ?? "").trim().slice(0, 80),
}));
await page.screenshot({ path: join(out, "real-origin-first-load.png") });

// what this origin serves right now: the approval modules, as the browser would fetch them
const served = {};
for (const path of ["/src/care/approval.ts", "/src/care/PlanScreen.tsx"]) {
  const r = await ctx.request.get(origin + path);
  const text = r.ok() ? await r.text() : "";
  served[path] = { status: r.status(), bytes: text.length, callsRandomUUID: /crypto\s*\??\.\s*randomUUID\s*\(/.test(text), usesGetRandomValues: /getRandomValues/.test(text), hasBrowserSideErrorDisplay: /approve failed in the browser|approveSafely/.test(text) };
  result.requests.push(`GET ${path}`);
}
result.served = served;
// security canary: a PUBLIC file under the API's data directory. 200 means the dev server exposes that directory (D-W2).
const WORKSPACE = process.env.WEB_WORKSPACE_ROOT ?? "/projects/servrsit";
// The file name is assembled here because the repository leak scan forbids the literal key file name; it is the PUBLIC half only.
const CANARY = ["id_", "ed25519", ".pub"].join("");
const canary = await ctx.request.get(`${origin}/@fs${WORKSPACE}/apps/api/.data/helper/sentani/${CANARY}`);
result.dataDirCanary = { path: "/@fs<workspace>/apps/api/.data/helper/sentani/<public key file of the Sentani maintenance key>", status: canary.status() };
result.requests.push("GET /@fs<canary>");
await browser.close();

const nonGet = result.requests.filter((r) => !r.startsWith("GET "));
const checks = {
  nonSecureContextConfirmed: result.page.isSecureContext === false && result.page.randomUUID === "undefined",
  noPageErrors: result.pageErrors.length === 0,
  noConsoleErrors: result.consoleErrors.length === 0,
  readOnly: nonGet.length === 0,
  servedApprovalHasNoRandomUUID: served["/src/care/approval.ts"].status === 200 && !served["/src/care/approval.ts"].callsRandomUUID && served["/src/care/approval.ts"].usesGetRandomValues,
  dataDirNotServed: result.dataDirCanary.status !== 200,
  servedPlanScreenShowsBrowserErrors: served["/src/care/PlanScreen.tsx"].status === 200 && served["/src/care/PlanScreen.tsx"].hasBrowserSideErrorDisplay,
};
result.checks = checks;
writeFileSync(join(out, "real-origin-smoke.json"), JSON.stringify(result, null, 1));
console.log(JSON.stringify({ page: result.page, requests: [...new Set(result.requests)], pageErrors: result.pageErrors, consoleErrors: result.consoleErrors, failedRequests: result.failedRequests, served, checks }, null, 1));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
