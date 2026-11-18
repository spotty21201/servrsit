# Handoff: Designer T-052 (branch feat/designer/t052)

## 1. Changed files
- `apps/web/src/lib/time.ts` (new): the single time-formatting module. Fixed locale en-GB, 24 h, owner zone. Functions: `resolveTimeZone` (default `Asia/Jakarta`), `zoneLabel` (WIB/WITA/WIT/UTC, else Intl short name), `formatClock`, `formatRelative`, `formatClockWithAge`, `parseIso`.
- `apps/web/src/lib/time.test.ts` (new): 7 tests.
- `apps/web/src/components/overview/fleetViewModel.ts`: removed the browser-zone `clockText`/`relativeText`; every time goes through `lib/time`. `OverviewVM.timeZone` added from `/api/fleet` `ownerTimeZone`.
- `apps/web/src/components/overview/fleetViewModel.test.ts` (new): zone, role/production and voice tests.
- `apps/web/src/components/overview/ChatBar.tsx`, `OverviewScreen.tsx`: evidence times use the owner zone (new `timeZone` prop).
- `apps/web/public/fonts/geist/`: 6 woff2 files, `OFL.txt`, `README.md`.
- `apps/web/src/fonts.css`: 6 `@font-face` rules, `font-display: swap`.

## 2. Decisions
- Standalone times carry a zone label and age: "Updated 15:09 WIB (1 min ago)". Next check: "15:15 WIB". Card "Observed 10 min ago" stays relative-only to keep density; "fresh until 15:30 WIB" carries the label.
- Fonts: Geist and Geist Mono static woff2, 400/500/600 only (the weights the CSS uses). Source: vercel/geist-font release v1.9.2, zip sha256 `15f066d58dcb99fb10014a49913009fdaf41e464cfb8851a44b44e593c95d3d8`. Family names match the existing `--font-sans` / `--font-mono` tokens, so no token change.
- Voice: one cheeky line, "No pending updates. Nothing to babysit.", only for status `fresh` with no warning/critical finding and 0 pending. Unreachable/stale cards keep the plain "No pending updates" (with the Historical chip).
- Role and "Production" text label were already rendered on the card from `role`/`production` (no change needed). Absent role shows "No role set".

## 3. Checks run
- `TZ=America/New_York pnpm --filter @servrsit/web test`: 48 pass, 0 fail (process zone differs from owner zone, so browser-zone use would fail the tests).
- `pnpm --filter @servrsit/web typecheck`: clean. `pnpm --filter @servrsit/web build`: ok; built CSS has 7 `@font-face` (6 Geist + Silkscreen), 8 files in `dist/fonts/geist`.
- Vite on 127.0.0.1:5174 (pane closed afterwards; port now refuses connections):
  ```
  Geist-Regular 200 font/woff2 45188B       GeistMono-Regular 200 font/woff2 50476B
  Geist-Medium 200 font/woff2 46444B        GeistMono-Medium 200 font/woff2 51512B
  Geist-SemiBold 200 font/woff2 46420B      GeistMono-SemiBold 200 font/woff2 51568B
  silkscreen 200 font/ttf 32220             OFL.txt 200 text/plain 4384
  ```
  Each woff2 starts with the `wOF2` magic bytes. The download succeeded; no placeholder `@font-face` exists.
- Live API on :3001 returned `ownerTimeZone: Asia/Jakarta`.
- No `100vw` added. Existing `100vh` fallback in `OverviewScreen.module.css` is unchanged (approved earlier, paired with dvh).

## 4. Gaps
- **Not verified in a browser.** Headless Chromium here lacks `libatk-1.0` and I did not install system packages. I could not confirm that Geist renders, or re-check mobile overflow, 4-column grid or 3-line chat after the font swap. Geist's metrics differ from the old fallback, so the founder should check Xiaomi 14T for horizontal drift.
- **Live API data conflicts with ADR-015** (Coder/Orchestrator, not Designer files): `/api/fleet` currently returns `role: null` for Timika, Nabire and Sentani, and `production: true` for all three. Merauke has role "Dev host", production false. So Timika's card shows "No role set" plus "Production", and Nabire and Sentani also show "Production" though ADR-015 says they are non-production. The UI shows exactly what the API sends. Fix is in the API host config.
- No server detail page exists yet, so there is no "server header" to update. When it is built it should reuse `role`/`isProduction` from `ServerCardVM`.
- Evidence times in the chat panel use the browser clock for "age" (the answer's moment), zone from the API.
- Commit note: parts 2 and 3 (fonts, voice line and its test) are in one commit.

## 5. Next
Orchestrator: merge `feat/designer/t052`, fix host config for roles/production, then founder check on mobile.
