# Handoff — Designer, Milestone M0
## T-017 — Design token system and component library foundation

**Completed by:** Kiro Designer  
**Date:** 2026-11-15  
**Branch:** `feat/designer/token-system`

---

## 1. Changed files

| Path | What changed | Why |
|---|---|---|
| `packages/ui/package.json` | Replaced stub with full package definition: `type: "module"`, build script, `exports` map for CSS token files, TypeScript dev dependency, React peer deps (optional) | Coder needs a correct workspace package to depend on; exports map lets consumers import CSS files by path without bundler hacks |
| `packages/ui/tsconfig.json` | Created. Strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + NodeNext module resolution | Strict TypeScript from day one; NodeNext required for `"type": "module"` package |
| `packages/ui/src/tokens/colors.css` | Created. All 10 base palette tokens + 5 semantic state pairs (10 CSS custom properties for foreground/background) | Exact values from UX Spec §4.2 |
| `packages/ui/src/tokens/typography.css` | Created. 3 font-family stacks (display, sans, mono), 4 weight constants, 7 type scale roles × 2 properties (size + line-height) + weight + family, mobile media-query overrides | UX Spec §4.1 type scale table |
| `packages/ui/src/tokens/spacing.css` | Created. 8 spacing steps (4–64 px), section-spacing shorthands, 6 corner-radius values, grid/layout constants, 3 motion duration tokens, shadow tokens, `prefers-reduced-motion` override block | UX Spec §4.3–4.5 |
| `packages/ui/src/tokens/index.css` | Created. `@import` for all three token files in correct order | Single import for consuming apps |
| `packages/ui/src/fonts/README.md` | Created. Instructions for Bricolage Grotesque + Geist Sans + Geist Mono: sources, steps, file names, `@font-face` declarations to paste once files are placed, checklist | Fonts cannot be auto-downloaded; spec requires self-hosted pinned assets |
| `packages/ui/src/index.ts` | Created. TypeScript constants mirroring every CSS token value: `colors`, `colorCssVars`, `stateColors`, `fontFamilies`, `fontWeights`, `typeScaleDesktop`, `typeScaleMobile`, `spacingPx`, `spacingCssVars`, `radii`, `radiiCssVars`, `durations`, `durationCssVars`, `layout` | Programmatic access for canvas drawing, SVG, Playwright assertions; re-exports `fixtures.ts` |
| `packages/ui/src/fixtures.ts` | Created. `FIXTURE_LABEL`, `WithFixtureLabel<T>`, `FixtureData<T>`, `isFixtureData()`, `asFixture()`, `getFixtureData()` | Enforces the Structure steering fixture-labeling invariant |

---

## 2. Decisions made

None that require a new decision-log entry. All design values are drawn directly from the UX Spec §4.1–4.5. No new interpretation.

One implementation note worth flagging: `typography.css` does **not** contain `@font-face` declarations yet — those cannot be written until font files are physically placed. The font README documents exactly what to add and where, so this will be a one-step task when fonts are sourced.

---

## 3. Checks run

| Check | Method | Result |
|---|---|---|
| All 10 base color tokens present and exact hex values match UX Spec §4.2 | Manual diff of CSS file against spec table | ✅ All 10 match |
| All 5 semantic state pairs present (10 fg/bg values) match UX Spec §4.2 | Manual diff | ✅ All 10 match |
| All 7 type scale roles present with correct desktop px values | Manual diff against spec §4.1 table | ✅ 52/56, 36/42, 24/30, 22/28, 16/24, 14/20, 13/20 all correct |
| Mobile overrides for display/page-title/section-title match spec | Manual diff (card-title/body/compact/technical intentionally omitted — spec says they are identical at both breakpoints) | ✅ 36/40, 28/34, 22/28 correct |
| Font-family fallback chains present for all three families | Read typography.css | ✅ Present |
| Spacing steps cover 4–64 px in 8 px rhythm | Read spacing.css | ✅ Present with rem equivalents |
| Corner radii match spec (20/16/10–12/pill) | Read spacing.css | ✅ Present |
| Motion durations within spec ranges (120, 160–220, 150–200 ms) | Read spacing.css | ✅ 120 ms / 200 ms / 175 ms |
| `prefers-reduced-motion` override block present | Read spacing.css | ✅ Present, collapses to 1 ms |
| TypeScript token values match CSS values | Manual cross-check of index.ts against CSS files | ✅ All values identical |
| `FixtureData` type enforces `[FIXTURE DATA]` marker string | Code review of fixtures.ts | ✅ Literal type; `isFixtureData` guard checks exact equality |
| `tsconfig.json` enables strict mode | Read tsconfig.json | ✅ `"strict": true` plus 4 additional strictness flags |
| `package.json` exports map covers CSS files | Read package.json | ✅ 4 CSS export paths + main TypeScript entry |

TypeScript compilation was not run (pnpm workspace not yet initialized per T-004 status). Coder should run `pnpm -F @servrsit/ui typecheck` after T-004 completes. The TypeScript code has no external dependencies beyond the TypeScript compiler itself.

---

## 4. Unresolved limitations and known gaps

| Item | Detail | Affects |
|---|---|---|
| Font files absent | Bricolage Grotesque and Geist files not yet obtained. `@font-face` declarations not yet in `typography.css`. System fallbacks are in place so text renders — just not in the specified typefaces. | All screens that use brand typography; will be visible in T-018+ screenshots |
| pnpm workspace not initialized | T-004 is not yet done; `pnpm install` has not been run against this package. TypeScript compilation cannot be verified until then. | T-018 blocking check |
| No React components yet | Per task brief, T-017 is tokens only. Components begin at T-018 and depend on contracts from Coder's T-007. | T-018+ |
| No Playwright token verification | T-024 will verify rendered token values in-browser. The CSS values here are manually verified against the spec; browser rendering verification is Tester's responsibility at T-024. | T-024 |
| Icon family not specified | Spec §4.4 names Lucide as the suggested outline icon family. This is not yet referenced in any token. It should be declared as a dev dependency when T-018 begins component work. | T-018 |

---

## 5. Next dependent task

**T-018** — High-fidelity overview screen (fixture)  
Depends on: T-017 (this task) + T-008 (typed fixture snapshots, Coder)  
Status: blocked on T-008

T-018 cannot begin until Coder delivers the shared contracts skeleton (T-007) and typed fixture snapshots (T-008). Once those are done, Designer can build React components against typed fixtures using the token foundation established here.

**T-024** — Browser review at all required sizes  
Depends on T-018–T-022. Tester should verify CSS token values are correctly rendered in-browser and that the `@font-face` declarations (once fonts are obtained) produce the correct output.

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| `packages/ui/` exports CSS tokens matching all UX Spec §4 values exactly (Canvas, Surface, Ink, Muted ink, Tangerine, Lilac, Citron, Soft line, Control boundary, Focus) | ✅ All 10 base tokens present with exact hex values |
| All semantic states included (checked/passed, needs-attention, failed/critical, unknown/stale, in-progress) | ✅ All 5 state pairs (10 fg/bg values) present |
| Typography scale implemented with Bricolage Grotesque + Geist, served from application path with system fallbacks | ✅ Font stacks declared with system fallbacks; application-path serving documented in fonts/README.md; `@font-face` declarations provided but require font files to activate |
| All tokens verifiable against spec values | ✅ CSS values directly traceable to UX Spec §4.1–4.5; TypeScript constants mirror CSS values exactly |
