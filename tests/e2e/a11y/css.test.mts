/**
 * What the declared styles say about target size, text contrast, control boundaries, focus ring,
 * motion and reflow. Static analysis of the real CSS applied to the rendered DOM (support/css.mts).
 * It cannot see a browser's layout. Anything it cannot resolve is counted as UNKNOWN, not as a pass.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { backgroundOf, cascade, colorIn, colorOf, contrast, declaredSize, loadCss, px, resolveVars, parseColor, type RGB } from "./support/css.mts";
import { collectFacts } from "./support/facts.mts";
import { states } from "./support/states.mts";

const WIDTHS = [1280, 390, 320] as const;
const desc = (e: Element) => `${e.tagName.toLowerCase()}${[...e.classList].map((c) => "." + c.replace(/^.*__/, "")).join("")}`;
const label = (e: Element) => (e.getAttribute("aria-label") ?? e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

interface Row { state: string; el: string; name: string; width: number; h: number | null; w: number | null; how: string; verdict: "ok" | "small" | "below-24" | "unknown" }
const targetRows: Row[] = [];
interface CRow { state: string; el: string; text: string; width: number; ratio: number | null; need: number; fg: string; bg: string; why?: string }
const contrastRows: CRow[] = [];
const boundaryRows: { state: string; el: string; width: number; ratio: number | null; why?: string }[] = [];
const focusRows: { state: string; el: string; bg: string; ratio: number | null }[] = [];

const hex = (c: RGB) => "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
const FOCUS = parseColor(resolveVars("var(--color-focus)")) as RGB;

for (const s of states) {
  test(`css: ${s.id}`, async () => {
    const { m, api } = await s.open();
    try {
      collectFacts();
      const root = document.getElementById("root")!;
      // ---- target size
      const controls = [...root.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]")];
      for (const el of controls) {
        const isCheck = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
        const target = isCheck ? (el.closest("label") ?? el) : el;
        const inline = !!target.closest("p, li") && target.tagName === "A" && target.parentElement?.tagName !== "NAV" && getComputedStyle(target).display === "inline";
        for (const width of WIDTHS) {
          const sz = declaredSize(target, width);
          const verdict: Row["verdict"] = sz.h === null ? "unknown" : sz.h < 24 ? "below-24" : sz.h < 44 || (sz.w !== null && sz.w < 44 && (target.tagName === "BUTTON" && !(target.textContent ?? "").trim())) ? "small" : "ok";
          targetRows.push({ state: s.id, el: desc(target) + (inline ? " (inline link)" : ""), name: label(target), width, h: sz.h, w: sz.w, how: sz.how, verdict });
        }
      }
      // ---- text contrast (base state; disabled controls are exempt under WCAG 1.4.3)
      const texts = [...root.querySelectorAll<HTMLElement>("*")].filter((e) => !e.closest("svg") && ![...e.childNodes].every((n) => n.nodeType !== 3 || !(n.textContent ?? "").trim()) && !e.matches(":disabled") && !e.closest("[aria-hidden='true']"));
      for (const el of texts) for (const width of [1280, 390]) {
        const st = cascade(el, width);
        const fs = px(st.get("font-size")) ?? 16; const weight = Number(st.get("font-weight") ?? 400) || (st.get("font-weight") === "bold" ? 700 : 400);
        const large = fs >= 24 || (fs >= 18.66 && weight >= 700); const need = large ? 3 : 4.5;
        const fg = colorOf(el, width); const bg = backgroundOf(el, width);
        if ("unknown" in fg || "unknown" in bg) { contrastRows.push({ state: s.id, el: desc(el), text: label(el), width, ratio: null, need, fg: "unknown" in fg ? fg.unknown : hex(fg), bg: "unknown" in bg ? bg.unknown : hex(bg), why: "unresolved" }); continue; }
        contrastRows.push({ state: s.id, el: desc(el), text: label(el), width, ratio: Number(contrast(fg, bg).toFixed(2)), need, fg: hex(fg), bg: hex(bg) });
      }
      // ---- control boundaries (WCAG 1.4.11) and focus ring against the surface it sits on
      for (const el of root.querySelectorAll<HTMLElement>("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea")) for (const width of [1280, 390]) {
        const st = cascade(el, width); const border = colorIn(st.get("border-color") ?? st.get("border")); const bg = backgroundOf(el.parentElement ?? el, width);
        if (!border || border === "transparent" || "unknown" in bg) { boundaryRows.push({ state: s.id, el: desc(el), width, ratio: null, why: !border ? "no border colour declared" : "unresolved" }); continue; }
        boundaryRows.push({ state: s.id, el: desc(el), width, ratio: Number(contrast(border, bg).toFixed(2)) });
      }
      for (const el of controls) { const bg = backgroundOf(el.parentElement ?? el, 1280); if (!("unknown" in bg)) focusRows.push({ state: s.id, el: desc(el), bg: hex(bg), ratio: Number(contrast(FOCUS, bg).toFixed(2)) }); }
    } finally { await m.unmount(); api.restore(); }
  });
}

test.after(() => {
  writeFileSync("/tmp/a11y/css-results.json", JSON.stringify({ targetRows, contrastRows, boundaryRows, focusRows }, null, 1));
});

// ----------------------------------------------------------------------------- the checks themselves
const uniq = <T,>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];

// Links that are text-height only (no padding or min-height). WCAG 2.5.8 allows an undersized target when a 24 px circle
// around it touches no other target (spacing exception). That needs real layout, so these are reported, not passed.
const TEXT_HEIGHT_LINKS = /^(a\.brand\.pixel-text|a|a\.nameLink|a \(inline link\))$/;

test("CSS-01 apart from text-height links, no control is declared smaller than WCAG 2.2 AA's 24 px minimum (2.5.8)", () => {
  const bad = uniq(targetRows.filter((r) => r.verdict === "below-24" && !TEXT_HEIGHT_LINKS.test(r.el)), (r) => `${r.el}|${r.width}`);
  assert.deepEqual(bad.map((r) => `${r.el} "${r.name}" ${r.h}px @${r.width}`), []);
});

test("CSS-01b text-height links are 24 px or taller, or rely on the spacing exception that needs a browser to confirm", { todo: "reported: D-U10" }, () => {
  const bad = uniq(targetRows.filter((r) => r.verdict === "below-24" && TEXT_HEIGHT_LINKS.test(r.el) && !/inline link/.test(r.el)), (r) => `${r.el}|${r.name}|${r.width}`);
  console.log(`# CSS-01b text-height links under 24 px: ${[...new Set(bad.map((r) => `${r.el} "${r.name}" ${r.h}px`))].join("; ")}`);
  assert.deepEqual(bad.map((r) => `${r.el} "${r.name}" ${r.h}px @${r.width}`), []);
});

test("CSS-02 every control meets the product's 44 px target (UX Spec), at 1280, 390 and 320 px", { todo: "reported: D-U10" }, () => {
  const bad = uniq(targetRows.filter((r) => r.verdict === "small"), (r) => `${r.el}|${r.name}|${r.width}`);
  assert.deepEqual(bad.map((r) => `${r.el} "${r.name}" ${r.h}px @${r.width} (${r.how})`), []);
});

test("CSS-03 how much of CSS-02 could be resolved (unknown is not a pass)", () => {
  const total = targetRows.length; const unknown = targetRows.filter((r) => r.verdict === "unknown");
  const u = uniq(unknown, (r) => r.el);
  console.log(`# CSS-03 controls checked: ${total} (state x control x width). unresolved: ${unknown.length}. kinds: ${u.map((r) => r.el).join(", ") || "none"}`);
  assert.ok(total > 300, "the target-size check saw too few controls to mean anything");
});

const KNOWN_LOW = (r: CRow) => r.el === "strong.sPending";
test("CSS-04 text contrast: every resolvable text/background pair meets 4.5:1 (3:1 for large text), except the one reported in CSS-04b", () => {
  const known = contrastRows.filter((r) => r.ratio !== null);
  const bad = uniq(known.filter((r) => r.ratio! < r.need && !KNOWN_LOW(r)), (r) => `${r.el}|${r.fg}|${r.bg}`);
  console.log(`# CSS-04 pairs checked: ${known.length}; unresolved: ${contrastRows.length - known.length}; lowest ratio: ${Math.min(...known.map((r) => r.ratio!))}`);
  const margins = uniq(known.filter((r) => !KNOWN_LOW(r)).sort((a, b) => a.ratio! - b.ratio!), (r) => `${r.el}|${r.fg}|${r.bg}`).slice(0, 5);
  console.log(`# CSS-04 thinnest passing pairs: ${margins.map((r) => `${r.el} ${r.fg} on ${r.bg} = ${r.ratio} (need ${r.need})`).join(" | ")}`);
  assert.ok(known.length > 500);
  assert.deepEqual(bad.map((r) => `${r.el} "${r.text}" ${r.fg} on ${r.bg} = ${r.ratio} (need ${r.need})`), []);
});

test("CSS-04b the 'Waiting' step status is readable text, not the control-boundary grey (4.5:1)", { todo: "reported: D-U9" }, () => {
  const bad = uniq(contrastRows.filter((r) => r.ratio !== null && r.ratio < r.need && KNOWN_LOW(r)), (r) => `${r.fg}|${r.bg}`);
  assert.deepEqual(bad.map((r) => `${r.el} "${r.text}" ${r.fg} on ${r.bg} = ${r.ratio}`), []);
});

test("CSS-04c how many pairs the engine could not resolve (a pass only counts where a ratio was computed)", () => {
  const unresolved = contrastRows.filter((r) => r.ratio === null); const kinds = [...new Set(unresolved.map((r) => `${r.el}: ${r.fg} / ${r.bg}`))].slice(0, 12);
  console.log(`# CSS-04c unresolved ${unresolved.length} of ${contrastRows.length}. e.g. ${kinds.join(" | ")}`);
});

test("CSS-05 form-control boundaries reach 3:1 against their surface (1.4.11)", () => {
  const known = boundaryRows.filter((r) => r.ratio !== null); const bad = uniq(known.filter((r) => r.ratio! < 3), (r) => r.el);
  console.log(`# CSS-05 inputs checked: ${known.length}; no declared border colour or unresolved: ${boundaryRows.length - known.length}; lowest: ${Math.min(...known.map((r) => r.ratio!))}`);
  assert.ok(known.length > 10);
  assert.deepEqual(bad.map((r) => `${r.el} ${r.ratio}`), []);
});

test("CSS-06 the focus colour reaches 3:1 on every surface a focusable control sits on", () => {
  const bad = uniq(focusRows.filter((r) => r.ratio! < 3), (r) => `${r.bg}`);
  console.log(`# CSS-06 surfaces: ${[...new Set(focusRows.map((r) => r.bg))].join(", ")}`);
  assert.deepEqual(bad.map((r) => `${r.el} on ${r.bg}: ${r.ratio}`), []);
});

test("CSS-07 a visible focus indicator exists, is at least 2 px, and every rule that removes an outline puts another indicator back", () => {
  const { rules } = loadCss();
  const global = rules.find((r) => r.file === "tokens" && r.selector === ":focus-visible");
  assert.ok(global, "no global :focus-visible rule");
  const outline = global!.decls.find((d) => d.prop === "outline")?.value ?? ""; assert.match(resolveVars(outline), /^([2-9]|\d{2,})px solid/, `global outline is "${outline}"`);
  assert.ok(global!.decls.some((d) => d.prop === "outline-offset"), "no outline-offset on the global focus ring");
  const killers = rules.filter((r) => r.decls.some((d) => d.prop.startsWith("outline") && /^(none|0|transparent)\b/.test(d.value)) && !/:focus:not\(:focus-visible\)/.test(r.selector));
  const replaced = (k: typeof killers[number]): string | null => {
    const base = k.selector.replace(/:focus(-visible)?$/, "");
    const ring = (r: typeof rules[number]) => r.decls.some((d) => d.prop === "outline" && !/^(none|0)/.test(d.value));
    if (rules.some((r) => r.file === k.file && r.selector === base + ":focus-visible" && ring(r))) return "own :focus-visible outline";
    if (rules.some((r) => r.file === k.file && r.selector === base + ":focus-visible::after" && ring(r))) return "outline on ::after (stretched link)";
    if (rules.some((r) => r.file === k.file && /:focus-within/.test(r.selector) && ring(r))) return "outline on the container (:focus-within)";
    const own = rules.find((r) => r.selector === k.selector && r.decls.some((d) => d.prop === "text-decoration-thickness") && r.decls.some((d) => d.prop === "background-color" || d.prop === "background")); if (own) return "highlight + 3px underline";
    const cls = /\.([\w-]+):focus-visible$/.exec(k.selector)?.[1];
    if (cls && rules.some((r) => r.file === k.file && r.selector.includes(`:has(.${cls}:focus-visible)`) && ring(r))) return "outline on the row (:has)";
    // The skip-link target: <main tabindex=-1> is not interactive and only receives focus programmatically,
    // so hiding its ring is the standard pattern. Allowed for exactly this selector, nothing broader.
    if (k.selector === "main:focus" || k.selector === "main:focus-visible") return "skip-link target (non-interactive main)";
    return null;
  };
  const report = killers.map((k) => `${k.file} ${k.selector} -> ${replaced(k) ?? "NOTHING"}`);
  console.log(`# CSS-07 outline removals and their replacement: ${report.join(" | ")}`);
  assert.deepEqual(report.filter((x) => x.endsWith("NOTHING")), []);
});

test("CSS-08 motion respects prefers-reduced-motion: durations come from tokens that collapse under it, or the file has its own rule; no keyframe animation", () => {
  const { files, vars } = loadCss(); const problems: string[] = [];
  const collapsed = vars.filter((v) => v.name.startsWith("--duration") && v.media.some((m) => /prefers-reduced-motion/.test(m))).map((v) => v.name);
  assert.ok(collapsed.length >= 3, `tokens collapse only ${collapsed.join(", ") || "nothing"} under reduced motion`);
  for (const f of files) {
    const text = readFileSync(f, "utf8"); const rel = f.replace(/^.*\/(src|packages\/ui\/src)\//, "");
    if (/@keyframes|(^|[\s;{])animation\s*:/.test(text) && !/prefers-reduced-motion/.test(text)) problems.push(`${rel}: animation without a reduced-motion rule`);
    for (const m of text.matchAll(/transition\s*:([^;]+);/g)) {
      const own = /prefers-reduced-motion/.test(text);
      if (!own && !/var\(--duration-/.test(m[1]!)) problems.push(`${rel}: transition "${m[1]!.trim()}" has a fixed duration`);
    }
  }
  assert.deepEqual(problems, []);
});

test("CSS-09 the UI never follows the OS dark mode (Stage A is light only)", () => {
  const hits = loadCss().files.filter((f) => /prefers-color-scheme/.test(readFileSync(f, "utf8"))).map((f) => f.replace(/^.*\/src\//, ""));
  assert.deepEqual(hits, []);
});

test("CSS-10 forced-colors / high-contrast support exists (UX Spec asks for it)", { todo: "reported: D-U11" }, () => {
  const any = loadCss().files.some((f) => /forced-colors/.test(readFileSync(f, "utf8")));
  assert.ok(any, "no @media (forced-colors: active) rule in any stylesheet");
});

test("CSS-11 reflow risks at 320 px: fixed widths, nowrap, sticky/fixed positioning, visual reordering (listed for review)", () => {
  const { rules } = loadCss(); const notes: string[] = [];
  for (const r of rules) for (const d of r.decls) {
    const v = resolveVars(d.value);
    if (d.prop === "width" && /^\d+(\.\d+)?px$/.test(v) && Number(v.slice(0, -2)) > 300 && !r.media.some((m) => /min-width/.test(m))) notes.push(`${r.file} ${r.selector}: width ${v}`);
    if (d.prop === "white-space" && v === "nowrap") notes.push(`${r.file} ${r.selector}: nowrap`);
    if (d.prop === "position" && /fixed|sticky/.test(v)) notes.push(`${r.file} ${r.selector}: position ${v}`);
    if ((d.prop === "order" && v !== "0") || (d.prop === "flex-direction" && /reverse/.test(v))) notes.push(`${r.file} ${r.selector}: ${d.prop} ${v} (visual order may differ from DOM order)`);
    if (d.prop === "user-select" && v === "none") notes.push(`${r.file} ${r.selector}: user-select none`);
  }
  console.log(`# CSS-11 for manual review (${notes.length}):\n#   ${[...new Set(notes)].join("\n#   ")}`);
  assert.ok(true);
});

test("CSS-12 the overview navigation's visual order (CSS `order`) matches its DOM and Tab order at every width (WCAG 1.3.2, 2.4.3)", { todo: "reported: D-U12" }, async () => {
  const { m, api } = await states.find((s) => s.id === "overview")!.open();
  try {
    const nav = document.querySelector("nav[aria-label='Main navigation']")!;
    const kids = [...nav.children] as HTMLElement[]; assert.ok(kids.length >= 3, "premise: the nav has its blocks");
    const mismatches: string[] = [];
    for (const width of [1280, 1024, 768, 390, 320]) {
      const visual = kids.map((el, i) => ({ el, dom: i, order: Number(cascade(el, width).get("order") ?? 0) })).sort((a, b) => a.order - b.order || a.dom - b.dom);
      if (visual.map((v) => v.dom).join() !== kids.map((_, i) => i).join()) mismatches.push(`@${width}px visual order is [${visual.map((v) => desc(v.el)).join(", ")}] but DOM/Tab order is [${kids.map(desc).join(", ")}]`);
    }
    assert.deepEqual(mismatches, []);
  } finally { await m.unmount(); api.restore(); }
});
