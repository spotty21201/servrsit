#!/usr/bin/env node
/**
 * Static check: browser APIs that exist ONLY in a secure context (https or localhost) must not be used unguarded by the web
 * app, because the founder opens it over plain HTTP on a tailnet address (http://100.104.220.8:5173). There,
 * `crypto.randomUUID` is undefined and approval broke (fixed in b615f67).
 *
 *   node scan-secure-context.mjs [webSrcDir]       default /projects/servrsit/apps/web/src
 *   node scan-secure-context.mjs --self-test
 *
 * Exit 0: every hit is reviewed or a known defect (known defects are printed as WARN every run).
 * Exit 1: an unreviewed hit. Exit 2: usage or self-test failure.
 *
 * Limits: a lexical scan. Comments are ignored; strings are skipped. It cannot tell a guarded use from an unguarded one, so every
 * hit needs a person to review it and an allowlist entry with the reason. `getRandomValues` (works over HTTP) is not flagged.
 */
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const PATTERNS = [
  ["randomUUID", /\bcrypto\s*\??\.\s*randomUUID\b/],
  ["subtle", /\bcrypto\s*\??\.\s*subtle\b/],
  ["clipboard", /\bnavigator\s*\??\.\s*clipboard\b/],
  ["serviceWorker", /\bnavigator\s*\??\.\s*serviceWorker\b/],
  ["share", /\bnavigator\s*\??\.\s*(share|canShare)\b/],
  ["credentials", /\bnavigator\s*\??\.\s*credentials\b|\bPublicKeyCredential\b/],
  ["mediaDevices", /\bnavigator\s*\??\.\s*mediaDevices\b/],
  ["geolocation", /\bnavigator\s*\??\.\s*geolocation\b/],
  ["storageManager", /\bnavigator\s*\??\.\s*(storage|locks|wakeLock|usb|bluetooth|hid|serial)\b/],
  ["notification", /\bnew\s+Notification\b|\bNotification\s*\.\s*requestPermission\b/],
  ["filePicker", /\bshow(Open|Save|Directory)(File)?Picker\b/],
  ["cacheStorage", /\bcaches\s*\.\s*(open|match|keys|delete|has)\b/],
  ["sharedArrayBuffer", /\bSharedArrayBuffer\b/],
];

/** Reviewed uses (kind "reviewed") and known defects (kind "known-defect": shown as WARN, never silently passed). */
const ALLOW = [
  { file: "auth/copy.ts", id: "clipboard", kind: "reviewed", reviewed: "2026-11-22", reason: "optional-chained, then a hidden-textarea (execCommand) fallback written for plain-HTTP hosts" },
  { file: "fixtures/activityFixture.ts", id: "randomUUID", kind: "known-defect", ref: "D-W1", reason: "fixture-only route /fixtures/activity: 'Create export' throws on a plain-HTTP origin" },
];

/** Blanks comments and string/template contents but keeps line structure, so line numbers stay right. */
export function blank(src) {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) {
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === q) { q = null; out += c; i++; continue; }
      out += c === "\n" ? "\n" : " "; i++; continue;
    }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && n === "*") { while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; } out += "  "; i += 2; continue; }
    if (c === "'" || c === '"' || c === "`") { q = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) { if (name !== "node_modules" && name !== "__tests__") out.push(...files(p)); }
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.(test|spec)\.[tj]sx?$/.test(name)) out.push(p);
  }
  return out;
}

export function scan(root) {
  const hits = [];
  for (const f of files(root)) {
    const lines = blank(readFileSync(f, "utf8")).split("\n");
    lines.forEach((l, i) => { for (const [id, re] of PATTERNS) if (re.test(l)) hits.push({ file: relative(root, f), line: i + 1, id, text: l.trim().slice(0, 120) }); });
  }
  return hits;
}

function selfTest() {
  const d = mkdtempSync(join(tmpdir(), "scan-selftest-")); mkdirSync(join(d, "a"));
  writeFileSync(join(d, "a/bad.ts"), 'export const k = () => globalThis.crypto.randomUUID();\nconst c = window.navigator?.clipboard?.writeText("x");\n');
  writeFileSync(join(d, "a/ok.ts"), '// crypto.randomUUID is secure-only\n/* navigator.clipboard\n   crypto.subtle */\nconst s = "crypto.randomUUID()";\nconst t = `navigator.share`;\nconst u = "http://x"; const v = crypto.getRandomValues(new Uint8Array(4));\n');
  writeFileSync(join(d, "a/skip.test.ts"), "crypto.randomUUID();\n");
  const h = scan(d);
  const got = h.map((x) => `${x.file}:${x.line}:${x.id}`).sort().join(",");
  const want = "a/bad.ts:1:randomUUID,a/bad.ts:2:clipboard";
  if (got !== want) { console.error(`SELF-TEST FAILED\n  got:  ${got}\n  want: ${want}`); process.exit(2); }
  console.log("self-test ok: flags real uses (incl. optional chaining), ignores comments, strings, templates, getRandomValues and test files");
}

if (process.argv[2] === "--self-test") { selfTest(); process.exit(0); }
const root = process.argv[2] ?? "/projects/servrsit/apps/web/src";
const hits = scan(root);
let bad = 0;
for (const h of hits) {
  const a = ALLOW.find((x) => x.file === h.file && x.id === h.id);
  if (!a) { bad++; console.log(`FAIL  ${h.file}:${h.line}  ${h.id}  ${h.text}`); }
  else if (a.kind === "known-defect") console.log(`WARN  ${h.file}:${h.line}  ${h.id}  known defect ${a.ref}: ${a.reason}`);
  else console.log(`ok    ${h.file}:${h.line}  ${h.id}  reviewed ${a.reviewed}: ${a.reason}`);
}
for (const a of ALLOW) if (!hits.some((h) => h.file === a.file && h.id === a.id)) console.log(`note  allowlist entry no longer matches anything: ${a.file} ${a.id} (remove it)`);
console.log(`${hits.length} secure-context-only use(s) in ${root}: ${bad} unreviewed`);
process.exit(bad === 0 ? 0 : 1);
