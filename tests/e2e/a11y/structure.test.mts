/**
 * Structure, names, forms, live regions and keyboard behaviour, per state. Written from the UX Spec
 * accessibility section (Target WCAG 2.2 AA; skip navigation; descriptive page titles; associated
 * errors; announced state changes; no unexpected focus moves) and WCAG 2.2 success criteria.
 * Tests marked `todo` assert the required behaviour and fail today: each is a reported defect.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { collectFacts, accessibleName, type Facts } from "./support/facts.mts";
import { installFetch } from "./support/api.mts";
import { $, $$, byText, click, h, mount, settle, type, waitFor } from "./support/render.mts";
import { states, type State } from "./support/states.mts";
import { WEB } from "./support/env.mts";

const byId = (id: string): State => states.find((s) => s.id === id)!;
async function inState<T>(id: string, fn: (f: Facts) => T | Promise<T>): Promise<T> {
  const { m, api } = await byId(id).open();
  try { return await fn(collectFacts()); } finally { await m.unmount(); api.restore(); }
}
const forEachState = (name: string, filter: (s: State) => boolean, check: (s: State, f: Facts) => void, opts: { todo?: string } = {}) =>
  test(name, opts, async () => {
    const failures: string[] = [];
    for (const s of states.filter(filter)) {
      try { await inState(s.id, (f) => check(s, f)); } catch (e) { failures.push(`${s.id}: ${(e as Error).message.split("\n")[0]}`); }
    }
    assert.deepEqual(failures, []);
  });
const screens = (s: State) => s.group === "overview" || s.group === "plan" || s.group === "operation";

// ------------------------------------------------------------------------------------------- landmarks, headings, names
forEachState("ST-01 every state has exactly one <h1>, one <main>, a lang, and no skipped heading level (WCAG 1.3.1, 2.4.6, 3.1.1)", () => true, (s, f) => {
  assert.equal(f.h1.length, 1, `h1 count ${f.h1.length}`);
  assert.equal(f.mains, 1, `main count ${f.mains}`);
  assert.equal(f.lang, "en");
  let prev = 0; for (const x of f.headings) { assert.ok(prev === 0 || x.level <= prev + 1, `h${prev} then h${x.level} "${x.text}"`); prev = x.level; }
});

forEachState("ST-02 every enabled control has an accessible name, and it contains the visible text (WCAG 4.1.2, 2.5.3)", () => true, (_s, f) => {
  assert.deepEqual(f.unnamed, []); assert.deepEqual(f.nameMismatch, []); assert.deepEqual(f.placeholderOnly, []); assert.deepEqual(f.brokenRefs, []); assert.deepEqual(f.positiveTabindex, []);
});

forEachState("ST-03 identity fields carry the right autocomplete tokens (WCAG 1.3.5)", (s) => s.group === "auth" || s.group === "setup", (s, f) => {
  const want: Record<string, string> = { "si-user": "username", "si-pass": "current-password", "si-code": "one-time-code", "su-user": "username", "su-pass": "new-password", "su-code": "one-time-code" };
  for (const [id, token] of Object.entries(want)) { const el = $(`#${id}`); if (el) assert.equal(el.getAttribute("autocomplete"), token, `#${id}`); }
  assert.deepEqual(f.noAutocomplete, []);
});

// overview-api-down is excluded on purpose: with no data on screen there is nothing to label (the banner follows the data).
forEachState("ST-04 every state that shows fixture data says so in text, not only in colour (product invariant, WCAG 1.4.1)", (s) => s.group === "plan" || s.group === "operation" || s.id === "overview", (_s, f) => {
  assert.match(f.bodyText, /\[FIXTURE DATA\]/);
});

// ------------------------------------------------------------------------------------------- page title and bypass blocks
test("ST-05 each screen has its own descriptive page title (WCAG 2.4.2; UX Spec: descriptive page titles)", { todo: "reported: D-U1" }, async () => {
  const pick = ["auth-password", "setup-details", "overview", "plan-ready", "op-running"];
  const titles = new Map<string, string>();
  for (const id of pick) titles.set(id, await inState(id, (f) => f.title));
  console.log(`# ST-05 titles: ${[...titles].map(([k, v]) => `${k}="${v}"`).join("; ")}`);
  assert.equal(new Set(titles.values()).size, pick.length, "screens share a page title");
  assert.ok(!/Overview/.test(titles.get("auth-password")!), "the sign-in page is titled 'Overview'");
});

forEachState("ST-06 pages with a navigation block before the content offer a skip link (WCAG 2.4.1; UX Spec: skip navigation)", screens, (_s, f) => {
  assert.ok(f.skipLink, "no 'skip to content' link");
}, { todo: "reported: D-U2" });

// ------------------------------------------------------------------------------------------- errors, live regions, focus
const ERROR_STATES = ["auth-password-error", "auth-lockout", "auth-code-error", "setup-error", "setup-enrol-error"];

test("ST-07 a failed submit puts an error in an alert, and the alert is not there before the submit (WCAG 4.1.3)", async () => {
  assert.equal(await inState("auth-password", (f) => f.live.filter((l) => l.role === "alert").length), 0);
  for (const id of ERROR_STATES) {
    const alerts = await inState(id, (f) => f.live.filter((l) => l.role === "alert"));
    assert.equal(alerts.length, 1, `${id}: ${alerts.length} alerts`);
    assert.ok(alerts[0]!.text.length > 10, `${id}: empty alert`);
  }
});

test("ST-08 the error text is programmatically tied to the field it concerns (WCAG 3.3.1; UX Spec: form field 'associated error')", { todo: "reported: D-U3" }, async () => {
  const bad: string[] = [];
  for (const id of ERROR_STATES) await inState(id, () => {
    const invalid = $$("[aria-invalid='true']");
    const errText = $("[role=alert]")?.textContent?.trim() ?? "";
    if (invalid.length === 0) { bad.push(`${id}: no field is marked aria-invalid`); return; }
    for (const el of invalid) {
      const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      const text = ids.map((i) => document.getElementById(i)?.textContent ?? "").join(" ");
      if (!errText || !text.includes(errText)) bad.push(`${id}: #${el.id} is aria-invalid but aria-describedby ${ids.length ? `("${text.slice(0, 40)}")` : "is missing"}`);
    }
  });
  assert.deepEqual(bad, []);
});

test("ST-09 a lockout names when to retry, and the form says why it cannot be submitted (WCAG 3.3.1, UX button 'disabled reason nearby')", async () => {
  await inState("auth-lockout", (f) => {
    assert.match(f.live.find((l) => l.role === "alert")!.text, /Try again in 5 min/);
    const submit = $<HTMLButtonElement>("button[type=submit]")!;
    assert.equal(submit.disabled, true, "the form must be disabled during a lockout");
  });
});

test("ST-10 a disabled primary button has a reason attached to it (UX Spec button: 'disabled reason available nearby')", { todo: "reported: D-U4" }, async () => {
  const bad: string[] = [];
  for (const id of ["auth-password", "auth-code", "auth-recovery", "setup-details", "setup-enrol", "setup-codes", "plan-production"]) await inState(id, () => {
    for (const b of $$<HTMLButtonElement>("button:disabled")) {
      const ref = (b.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).map((i) => document.getElementById(i)?.textContent ?? "").join(" ").trim();
      if (!ref) bad.push(`${id}: "${accessibleName(b)}" is disabled with no described reason`);
    }
  });
  assert.deepEqual(bad, []);
});

test("ST-11 nothing steals focus on first load; focus moves to the new step's heading when the step changes (WCAG 3.2.1, 2.4.3)", async () => {
  for (const id of ["auth-password", "setup-details", "plan-production", "op-running", "overview"]) assert.equal(await inState(id, (f) => f.active), "body", `${id} focuses something on load`);
  for (const id of ["auth-code", "auth-recovery", "setup-enrol", "setup-codes"]) assert.match(await inState(id, (f) => f.active), /^h1#auth-title/, `${id} did not move focus to the heading`);
});

test("ST-12 signing out leaves keyboard focus somewhere sensible, not on a removed element (WCAG 2.4.3)", { todo: "reported: D-U5" }, async () => {
  const { m, api } = await byId("overview").open();
  try {
    const btn = $$("button").find((b) => /^Sign out/.test(accessibleName(b)))!; btn.focus(); assert.equal(document.activeElement, btn, "premise: the button is focused");
    await click(btn); await waitFor(() => !!$("#si-user"), "sign-in screen"); await settle();
    const a = document.activeElement; console.log(`# ST-12 focus after sign-out: ${a?.tagName.toLowerCase()}${a?.id ? "#" + a.id : ""}`);
    assert.ok(a && a !== document.body, "focus fell back to <body>: a keyboard user starts again from the top of the page and a screen reader announces nothing");
  } finally { await m.unmount(); api.restore(); }
});

test("ST-13 the whole sign-in, using only form controls, reaches the overview (keyboard-equivalent path)", async () => {
  const api = installFetch(); const App = (await import("../../../apps/web/src/App.tsx")).default; const m = await mount("/", () => h(App));
  try {
    await waitFor(() => !!$("#si-user"), "sign-in");
    const form = $("form")!; assert.ok(form.querySelector("button[type=submit]"), "the form has no submit button: Enter would do nothing");
    await type($<HTMLInputElement>("#si-user")!, "owner"); await type($<HTMLInputElement>("#si-pass")!, "synthetic-password-0001");
    await click(byText("button", "Continue")!); await waitFor(() => !!$("#si-code"), "code step");
    assert.ok($("form")!.querySelector("button[type=submit]"), "the code form has no submit button");
    await type($<HTMLInputElement>("#si-code")!, "123456"); await click(byText("button", "Sign in")!);
    await waitFor(() => /Your servers/.test(document.body.textContent ?? ""), "overview");
    assert.ok(!document.body.textContent!.includes("123456"), "the code is still on the page");
  } finally { await m.unmount(); api.restore(); }
});

test("ST-14 a refused code clears nothing the owner needs and does not echo the secret or server text (UX 7.1, execution-security)", async () => {
  const text = await inState("auth-code-error", (f) => f.bodyText);
  assert.ok(!text.includes("INVALID_CODE"), "the raw API error code is shown to the owner");
});

// ------------------------------------------------------------------------------------------- controls with known pitfalls
test("ST-15 the password Show/Hide button does not change its name AND state (WAI-ARIA APG toggle button)", { todo: "reported: D-U6" }, async () => {
  await inState("auth-password", async () => {
    const t = $<HTMLButtonElement>("button[aria-pressed]")!; assert.ok(t);
    const before = accessibleName(t); await click(t); const after = accessibleName($("button[aria-pressed]")!);
    assert.equal($("button[aria-pressed]")!.getAttribute("aria-pressed"), "true");
    assert.equal(after, before, `name changed from "${before}" to "${after}" while aria-pressed=true: a screen reader says "${after}, pressed", which reads as the opposite`);
  });
});

test("ST-16 the authenticator QR code has a text alternative, and the key is available as text (WCAG 1.1.1, 2.1.1)", async () => {
  await inState("setup-enrol", () => {
    const svg = $("svg[role=img]")!; assert.ok(svg.getAttribute("aria-label")!.length > 20);
    assert.match(document.body.textContent!, /JBSW Y3DP|JBSWY3DP/);
    assert.ok(byText("a", /Open in authenticator app/), "no link to open the app directly");
    assert.ok(byText("button", "Copy key"));
  });
});

test("ST-17 recovery codes are real text in a labelled list, with copy and download, and the owner must tick a box to continue (UX 7.1)", async () => {
  await inState("setup-codes", () => {
    const items = $$("ul[aria-label='Recovery codes'] li"); assert.equal(items.length, 10);
    assert.ok(byText("button", "Copy all") && byText("button", "Download .txt"));
    const cont = byText("button", "Continue to ServrSit") as HTMLButtonElement; assert.equal(cont.disabled, true);
    const box = $<HTMLInputElement>("input[type=checkbox]")!; assert.ok(accessibleName(box).includes("saved"));
  });
});

test("ST-18 the transcript is a keyboard-focusable, named, read-only log region and is not announced on every line (WCAG 2.1.1, 4.1.3)", async () => {
  await inState("op-running-transcript-open", () => {
    const log = $("[role=log]")!; assert.ok(log);
    assert.equal(log.getAttribute("tabindex"), "0", "a scrollable region must be reachable by keyboard"); assert.ok(accessibleName(log).length > 5);
    assert.equal(log.getAttribute("aria-live"), "off");
  });
});

test("ST-19 the transcript uses valid ARIA: no role=log on a <ul> that leaves its <li> orphaned (axe aria-allowed-role, listitem)", { todo: "reported: D-U7" }, async () => {
  await inState("op-running-transcript-open", () => {
    const log = $("[role=log]")!; assert.ok(!(log.tagName === "UL" && log.querySelector(":scope > li")), "<ul role=log> with <li> children");
  });
});

forEachState("ST-20 no element carries aria-label where the role cannot be named (<p>, <span>, <div> without a role)", () => true, () => {
  const bad = $$("p[aria-label], span[aria-label], div[aria-label]:not([role]), li[aria-label]:not([role])").map((e) => `${e.tagName.toLowerCase()}[aria-label="${e.getAttribute("aria-label")}"]`);
  assert.deepEqual(bad, []);
}, { todo: "reported: D-U8" });

forEachState("ST-21 live regions never carry a ticking countdown or a long paragraph (UX: do not announce every countdown second)", screens, (_s, f) => {
  for (const l of f.live) assert.ok(!/\b\d+ ?(s|sec|seconds)\b/.test(l.text), `live region text "${l.text}" looks like a countdown`);
});

forEachState("ST-22 the overview and care screens have a labelled navigation, a current-page marker, and status shown as text", (s) => s.id === "overview" || s.group === "plan" || s.group === "operation", (s, f) => {
  assert.ok(f.navs.length >= 1 && f.navs.every((n) => !!n), `unlabelled navigation: ${JSON.stringify(f.navs)}`);
  if (s.id === "overview") assert.match(f.bodyText, /All checks passed.*Unreachable from ServrSit.*Check overdue/);
  else assert.ok($("[aria-current='page']"), "no aria-current on the breadcrumb");
});

// ------------------------------------------------------------------------------------------- source scan (static)
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.tsx$/.test(p) && !/\.test\./.test(p)) out.push(p); }
  return out;
}
test("ST-23 source scan: no click handler on a non-interactive element, no positive tabIndex, no autoFocus, no dangerouslySetInnerHTML, no <a> without href, no <img> without alt", () => {
  const bad: string[] = [];
  for (const file of walk(join(WEB, "src"))) {
    const src = readFileSync(file, "utf8"); const rel = file.replace(/^.*\/src\//, "");
    for (const m of src.matchAll(/<(div|span|li|p|section|article|td|tr)\b[^>]*\bonClick\b[^>]*>/g)) bad.push(`${rel}: onClick on <${m[1]}>`);
    for (const m of src.matchAll(/tabIndex=\{?(["']?)([1-9]\d*)\1\}?/g)) bad.push(`${rel}: tabIndex ${m[2]}`);
    if (/\bautoFocus\b/.test(src)) bad.push(`${rel}: autoFocus`);
    if (/dangerouslySetInnerHTML/.test(src)) bad.push(`${rel}: dangerouslySetInnerHTML`);
    for (const m of src.matchAll(/<a\b(?![^>]*\bhref\b)[^>]*>/g)) bad.push(`${rel}: <a> without href: ${m[0].slice(0, 50)}`);
    for (const m of src.matchAll(/<img\b(?![^>]*\balt\b)[^>]*>/g)) bad.push(`${rel}: <img> without alt`);
  }
  assert.deepEqual(bad, []);
});
