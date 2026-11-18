/**
 * A small static cascade over the REAL stylesheets (apps/web/src/**.css), applied to the rendered jsdom DOM.
 * jsdom has no layout engine, so this answers "what do the declared styles say", not "what did a browser draw".
 * Handled: custom properties from :root, var(), class/id/tag selectors via element.matches (jsdom), specificity,
 * source order, @media (min/max-width) for a chosen viewport. Not handled: calc(), clamp(), inheritance of
 * anything but `color`, pseudo-elements, hover/focus states (skipped on purpose), flex/grid sizing.
 * Anything it cannot resolve is reported as UNKNOWN, never as a pass.
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, WEB } from "./env.mts";

const here = dirname(fileURLToPath(import.meta.url));
const postcss = createRequire(join(here, "../package.json"))("postcss") as typeof import("postcss");

export interface Decl { prop: string; value: string; important: boolean }
export interface Rule { file: string; selector: string; media: string[]; decls: Decl[]; order: number; spec: [number, number, number] }

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith(".css")) out.push(p); }
  return out;
}
// The token system lives in packages/ui and is pulled in by tokens.css with @import.
export const cssFiles = (): string[] => [...walk(join(ROOT, "packages/ui/src/tokens")).sort(), ...walk(join(WEB, "src")).sort()];

function specificity(sel: string): [number, number, number] {
  const s = sel.replace(/::?[\w-]+(\([^)]*\))?/g, (m) => (/^::/.test(m) ? " x" : m.startsWith(":not") || m.startsWith(":is") || m.startsWith(":where") ? "" : ".p"));
  return [(s.match(/#[\w-]+/g) ?? []).length, (s.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length, (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length];
}

interface VarDecl { name: string; value: string; media: string[]; order: number }
let cache: { rules: Rule[]; vars: VarDecl[]; files: string[] } | null = null;
export function loadCss() {
  if (cache) return cache;
  const rules: Rule[] = []; const vars: VarDecl[] = []; let order = 0;
  const files = cssFiles();
  for (const file of files) {
    const base = basename(file).replace(/\.module\.css$|\.css$/, "");
    const isModule = file.endsWith(".module.css");
    const root = postcss.parse(readFileSync(file, "utf8"));
    root.walkRules((rule) => {
      const media: string[] = []; let p = rule.parent;
      while (p && p.type !== "root") { if (p.type === "atrule" && (p as any).name === "media") media.push((p as any).params); p = p.parent as any; }
      const decls = rule.nodes.filter((n) => n.type === "decl").map((n: any) => ({ prop: n.prop.toLowerCase(), value: n.value.trim(), important: !!n.important }));
      if (rule.selector.startsWith("@") || (rule.parent as any)?.name === "keyframes") return;
      for (const raw of rule.selectors) {
        const selector = isModule ? raw.replace(/\.([A-Za-z_][\w-]*)/g, (_m, c) => `.${base}__${c}`) : raw;
        if (selector === ":root" || selector === "html") for (const d of decls) if (d.prop.startsWith("--")) vars.push({ name: d.prop, value: d.value, media, order: order });
        rules.push({ file: base, selector, media, decls, order: order++, spec: specificity(selector) });
      }
    });
  }
  cache = { rules, vars, files };
  return cache;
}

function mediaOk(media: string[], width: number): boolean {
  return media.every((m) => {
    // The 44 px target is a touch target, so (pointer: coarse) rules are evaluated as applying.
    if (/\(pointer:\s*coarse\)|\(hover:\s*none\)/.test(m)) return true;
    if (/prefers-|forced-colors|print|hover|pointer/.test(m)) return false; // other preference queries: base state only
    const min = /min-width:\s*(\d+(?:\.\d+)?)(px|em|rem)/.exec(m); const max = /max-width:\s*(\d+(?:\.\d+)?)(px|em|rem)/.exec(m);
    const px = (v: string, u: string) => Number(v) * (u === "px" ? 1 : 16);
    return (!min || width >= px(min[1]!, min[2]!)) && (!max || width <= px(max[1]!, max[2]!));
  });
}
const PSEUDO_STATE = /:(hover|focus|focus-visible|focus-within|active|visited|target)\b|::/;

export function resolveVars(value: string, width = 1280, depth = 0): string {
  const { vars } = loadCss();
  if (depth > 8) return value;
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_m, name, fb) => {
    const hits = vars.filter((v) => v.name === name && mediaOk(v.media, width));
    const v = hits.length ? hits[hits.length - 1]!.value : undefined; // later declaration wins; media overrides come later in tokens.css
    return v === undefined ? (fb ?? `UNRESOLVED(${name})`) : resolveVars(v, width, depth + 1);
  });
}

/** Declarations that apply to `el` in its base state at `width`, winning by importance, specificity, order. */
export function cascade(el: Element, width: number): Map<string, string> {
  const { rules } = loadCss();
  const hits: { d: Decl; rule: Rule }[] = [];
  for (const r of rules) {
    if (PSEUDO_STATE.test(r.selector) || !mediaOk(r.media, width)) continue;
    let ok = false; try { ok = el.matches(r.selector); } catch { ok = false; }
    if (ok) for (const d of r.decls) hits.push({ d, rule: r });
  }
  hits.sort((a, b) => Number(a.d.important) - Number(b.d.important) || a.rule.spec[0] - b.rule.spec[0] || a.rule.spec[1] - b.rule.spec[1] || a.rule.spec[2] - b.rule.spec[2] || a.rule.order - b.rule.order);
  const out = new Map<string, string>();
  for (const { d } of hits) out.set(d.prop, resolveVars(d.value, width));
  return out;
}

// ---------------------------------------------------------------- units and colours
export function px(value: string | undefined, fontSize = 16): number | null {
  if (!value) return null; const v = value.trim();
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(v); if (!m) return null;
  return m[2] === "px" ? Number(m[1]) : m[2] === "rem" || m[2] === "em" ? Number(m[1]) * (m[2] === "rem" ? 16 : fontSize) : v === "0" ? 0 : null;
}
export function shorthandBox(value: string | undefined): [number, number, number, number] | null {
  if (!value) return null; const p = value.trim().split(/\s+/).map((x) => px(x)); if (p.some((x) => x === null) || p.length === 0 || p.length > 4) return null;
  const [a, b = a, c = a, d = b] = p as number[]; return [a!, b!, c!, d!];
}
export type RGB = [number, number, number];
export function parseColor(v: string | undefined): RGB | "transparent" | null {
  if (!v) return null; const s = v.trim().toLowerCase();
  if (s === "transparent") return "transparent";
  if (s === "white") return [255, 255, 255]; if (s === "black") return [0, 0, 0];
  let m = /^#([0-9a-f]{3})$/.exec(s); if (m) return [...m[1]!].map((c) => parseInt(c + c, 16)) as RGB;
  m = /^#([0-9a-f]{6})$/.exec(s); if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as RGB;
  return null;
}
const lin = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
export const luminance = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export const contrast = (a: RGB, b: RGB) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };
/** First colour literal inside a shorthand such as `1px solid #7B8490`. */
export function colorIn(value: string | undefined): RGB | "transparent" | null {
  if (!value) return null; for (const tok of value.split(/\s+(?![^(]*\))/)) { const c = parseColor(tok); if (c) return c; } return null;
}

export function backgroundOf(el: Element, width: number): RGB | { unknown: string } {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = cascade(e, width);
    const raw = c.get("background-color") ?? (c.get("background") && !/gradient|url/.test(c.get("background")!) ? c.get("background") : undefined);
    if (c.get("background-image") && /gradient|url/.test(c.get("background-image")!)) return { unknown: `image on ${e.tagName.toLowerCase()}` };
    if (raw && /^(none|inherit|initial|unset)$/i.test(raw.trim())) continue; // no background of its own
    if (raw) { const col = colorIn(raw); if (col === "transparent" || col === null) { if (col === null) return { unknown: `background "${raw}"` }; continue; } return col; }
  }
  const body = cascade(document.body, width).get("background-color") ?? cascade(document.documentElement, width).get("background-color");
  const col = colorIn(body); return col && col !== "transparent" ? col : [255, 255, 255];
}
export function colorOf(el: Element, width: number): RGB | { unknown: string } {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const v = cascade(e, width).get("color");
    if (v && /^(inherit|currentcolor|unset)$/i.test(v)) continue; // takes the parent's colour
    if (v) { const c = parseColor(v); return c && c !== "transparent" ? c : { unknown: `color "${v}"` }; }
  }
  const body = parseColor(cascade(document.body, width).get("color")); return body && body !== "transparent" ? body : [0, 0, 0];
}

/** font-size and line-height inherit: walk up until a rule declares them. Unitless line-height multiplies the element's own size. */
function inheritedType(el: Element, width: number): { fs: number; lh: number | null } {
  let fs: number | null = null; let lhRaw: string | undefined;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = cascade(e, width);
    if (fs === null) { const v = px(c.get("font-size"), 16); if (v !== null) fs = v; }
    if (lhRaw === undefined && c.get("line-height")) lhRaw = c.get("line-height");
    if (fs !== null && lhRaw !== undefined) break;
  }
  const size = fs ?? 16;
  const lh = lhRaw ? (/^\d*\.?\d+$/.test(lhRaw) ? Number(lhRaw) * size : px(lhRaw, size)) : null;
  return { fs: size, lh };
}

/** Rendered height of a control from its declared styles. null = cannot be determined. */
export function declaredSize(el: Element, width: number): { h: number | null; w: number | null; how: string } {
  const c = cascade(el, width);
  const height = px(c.get("height")); const minH = px(c.get("min-height"));
  const minW = px(c.get("min-width")); const w = px(c.get("width"));
  const pad = shorthandBox(c.get("padding")); const pt = px(c.get("padding-top")) ?? pad?.[0] ?? 0; const pb = px(c.get("padding-bottom")) ?? pad?.[2] ?? 0;
  const { lh } = inheritedType(el, width);
  let h: number | null = null; let how = "";
  if (height !== null || minH !== null) { h = Math.max(height ?? 0, minH ?? 0); how = `declared ${height !== null ? "height " + height : ""}${minH !== null ? " min-height " + minH : ""}`.trim(); }
  else if (lh !== null) { h = lh + pt + pb; how = `estimated from line-height ${lh} + padding ${pt + pb}`; }
  return { h, w: Math.max(w ?? 0, minW ?? 0) || null, how: how || "no height, min-height or line-height resolvable" };
}
