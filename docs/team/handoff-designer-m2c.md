# Handoff — Designer, M2c
## T-018 v3 — Overview density, desktop chat console, tighter mobile cards (founder round 3)

**Status: code written in apps/web only. NOT built, NOT run, NOT committed.**

This Designer session still has no shell, terminal or network tool. It can only
read and write workspace files. None of these were done:

| Requested step | Done? |
|---|---|
| `git checkout -b feat/designer/overview-v3` | No |
| `curl` the font URL and check `font/ttf` | No |
| `pnpm run build` | No. No output to report. |
| Read Vite pane w1:p5 | No |
| Commit | No |

Retrying doesn't help: no network error happened, because the tool to make the request doesn't exist in this session.

## 1. Changed files (all in apps/web)

| Path | Change |
|---|---|
| `src/fonts.css` | Comment updated: Regular + Bold TTF and OFL.txt are committed. Only Regular is declared (no pixel text uses bold). No `src` change; your ttf-only `@font-face` is kept. |
| `public/fonts/silkscreen/README.md` | Rewritten to match reality: files present, added by the Orchestrator from `google/fonts`, why Courier showed before. Notes that the source commit and SHA-256 are still unrecorded. |
| `src/tokens.css` | New app-level density overrides of shared tokens, desktop and ≤767px (see §2). `packages/ui` untouched this round. |
| `components/overview/OverviewScreen.module.css` | Section gap, content padding, card grid gap and lower-grid gap reduced. Mobile grid padding for the smaller shadow. Width/overflow rules unchanged. |
| `components/server-card/ServerCard.module.css` | Padding and gaps from the new tokens. Icon size set in CSS (48 px desktop). New ≤767px block: 12 px padding, 8 px gaps, 32 px icon, 16 px pixel name, 13 px meta/finding/check rows, 4 px shadow, 16 px radius, action stays 44 px tall. |
| `components/server-card/PixelServerIcon.tsx`, `ServerCard.tsx` | Icon accepts `className` so CSS can size it (48 → 32 px on mobile, both integer multiples of the 16-px grid). |
| `components/overview/AttentionColumn.module.css`, `RecentActivity.module.css` | Row padding 16 → 8 px. Heading margin 16 → 8 px. Inner gaps 4 → 2 px. "View all activity" is now a 44 px-tall tap target. |
| `components/overview/ChatBar.tsx/.module.css` | Desktop: label, scope chip and note on one header row above a 5-row `<textarea>` console, max 600 px, send button 44×44. Mobile: textarea forced to 44 px (single line, as approved in round 2). |

## 2. Spacing and line-height values (before → after)

| Item | Desktop | ≤767px |
|---|---|---|
| Body line-height | 24 px (1.5) → 1.375 (22 px) | same |
| Compact line-height | 20 px (1.43) → 1.35 | same |
| Page title (pixel) | 32/40 → 24/28 (≈1.17) | 24/32 → 24/28 |
| Server name (pixel) | 24/32 → 24/28 (≈1.17) | 24/32 → 16/18 (≈1.13) |
| Section title | 24/30 → 20/24 (1.2) | 22/28 → 18/22 |
| Section gap | 48 → 32 | 24 → 16 |
| Card grid gap | 32 → 24 | 24 → 12 |
| Card padding | 24 → 16 | 24 → 12 |
| Card inner gap | 16 → 12 | 16 → 8 |
| List row padding | 16 → 8 | 16 → 8 |
| Content top padding | 40 → 24 | 24 → 12 |

Tap targets ≥ 44 px kept: card action, nav items, account button, send button, mobile chat input, "View all activity".

Pixel-face sizes remain multiples of 8 px (24, 16) for crisp glyph edges.

## 3. Anchoring (unchanged on purpose)

The founder confirmed the round 2 fix: no wobble. I didn't touch the nav wrap, `minmax(0, …)` tracks, `min-width: 0` rules, `overflow-wrap`, `dvh`, safe-area padding or the `overflow-x: clip` backstop. A grep of `apps/web/src` finds no `100vw`. The only `100vh` is the existing fallback line directly before `100dvh`. New elements also follow the rules: the textarea has `min-width: 0`, and the header row wraps.

## 4. Contrast

No new color pairs. New elements reuse pairs from M2b: Ink on Lilac (scope chip) is 8.65, Ink on Tangerine (send) is 5.82, Muted ink on white (note, placeholder) is 6.39. Smaller text (13 px meta) uses Muted ink at 6.39, above the 4.5 needed for normal text.

## 5. Not verified

- **Font serving.** Run `curl -sI http://localhost:5173/fonts/silkscreen/Silkscreen-Regular.ttf` and expect `200` with `Content-Type: font/ttf`. I didn't run it.
- **Font rendering in a browser.** Whether Silkscreen replaces Courier, and whether it looks crisp at 24 and 16 px on the Xiaomi 14T's fractional pixel ratio. Unverified by me.
- **Build and Vite pane output.**
- **Visual density:** whether the reduction is "about a third" to the eye, and whether 16 px pixel names read well on mobile.
- **Desktop console height.** About 126 px, from 5 × 22 px plus padding. Calculated, not measured.
- **Mobile textarea** at 44 px: should show one line and scroll internally. Not checked on Android Chrome.
- **No horizontal overflow at 390 and 320 px after these changes.** Recheck that `document.documentElement.scrollWidth === innerWidth`.

## 6. To close

```bash
git checkout -b feat/designer/overview-v3
curl -sI http://localhost:5173/fonts/silkscreen/Silkscreen-Regular.ttf | head -5
pnpm -F @servrsit/web run build 2>&1 | tail -20
herdr pane read w1:p5 --source recent-unwrapped --lines 60
git add apps/web docs/team/handoff-designer-m2c.md
git commit -m "feat(web): overview v3 — density, desktop chat console, compact mobile cards"
```

Next: founder review of v3, then T-019 (server detail).

---

# Round 4 addendum — desktop three-column fit

**Status: code written in apps/web only. NOT built, NOT run, NOT committed.** Same reason as above: no shell or network tool in this session. I couldn't run `pnpm run build`, read pane w1:p5, run `git checkout` or commit.

## What I assumed

"Servers | Needs attention | Recent activity" means **three peer columns in one row** at ≥1024 px. The chat console is **not** a fourth column. It sits below all three, centered, max 640 px. Attention comes before Activity in reading and DOM order. If the founder meant Attention and Activity stacked in one column at desktop, as on tablet, only `grid-template-areas` in the ≥1024 block of `OverviewScreen.module.css` needs to change.

## Changed files (round 4)

| Path | Change |
|---|---|
| `components/ScrollRegion/*` (new) | Column body that scrolls internally at ≥1024 px. When content overflows it gets `role="region"`, `aria-label`, `tabIndex=0` (arrow keys and PageDown scroll it), a thin always-visible scrollbar with a stable gutter, and a Citron "More below ▾" cue that hides at the bottom. When it doesn't overflow (mobile, tablet, short lists) it's a plain div with no dead tab stop. A ResizeObserver tracks size changes from window resizing, font loading and data. `overscroll-behavior: contain` keeps the page still when a column reaches its end. |
| `components/overview/OverviewScreen.tsx` | The "Your servers" h1 moved into the Servers column header, which removes a separate header row. Three columns share one grid. The `lowerGrid` wrapper was removed. |
| `components/overview/OverviewScreen.module.css` | Mobile: flex column (unchanged order). 768–1023: grid `servers | attention / activity`. ≥1024: shell `height: max(100dvh, 40rem)`, a flex chain with `min-height: 0`, columns `minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1fr)`. A 1024–1199 block restores compact padding after the top-nav block. |
| `components/overview/AttentionColumn.*`, `RecentActivity.*` | Lists wrapped in `ScrollRegion`. `className` prop for grid placement. Headings stay visible at desktop, with min-height 28 px so the three header rules line up. Activity uses `aria-labelledby` instead of `aria-label`. "View all activity" stays outside the scroller. |
| `components/overview/ChatBar.module.css` | ≥1024: textarea `height: clamp(4.5rem, 15dvh, 7.875rem)`, which is 72–126 px (3–5 lines), fixed and in flow, max width 640 px. Mobile is unchanged. |

## How the fit works (no fixed pixel heights on content)

The viewport-tall shell holds, from top to bottom: banner (36 px), band (10 px) and the content area, plus the top nav at 1024–1199 px. The content area holds the columns (`flex: 1; min-height: 0`), a 16 px gap and the chat (its own height). Each column holds its header (fixed) and a ScrollRegion that takes the rest. The `40rem` floor means a very short window, or a large default font, falls back to normal page scrolling instead of crushing the columns to nothing.

## Height budget at 1440×900 (calculated, not measured)

- Content after banner, band and padding: about 822 px. Chat ≈ 158 px plus a 16 px gap, so the columns get ≈ 648 px. Column header ≈ 42 px leaves ≈ 606 px for the list.
- Servers column ≈ 624 px wide, which fits **2 cards per row** at the 280 px minimum (2 × 280 + 24 gap + up to 15 px scrollbar gutter + 8 px shadow room). Card height ≈ 234 px, so 2 rows + gap ≈ 500 px, under 606. **With the current fixture, nothing should scroll at 1440×900.**
- At 1280 px wide the Servers column is ≈ 557 px, so 1 card per row and the Servers column scrolls internally. That is by design.
- The fixture has 3 servers, 2 findings and 1 operation, so the internal scrolling and the "More below" cue will not show at 1440×900. To test them, add rows to the fixture or shrink the window height.

## Unchanged

- Mobile ≤767 px: same single-column flow. All new layout rules are inside `min-width: 768px` / `1024px` queries. No new `100vw` or `100vh`; the only `100vh` is the existing fallback line before `100dvh` on the shell's min-height. `dvh` is used only inside `max()` at ≥1024 px.
- Rounds 1–3: white page, pixel titles and names, pixel icons, card anatomy, Historical chip and dashed border for stale or unreachable, density tokens, 44 px tap targets.

## Not verified (no browser)

- Build and Vite pane output.
- That the three columns and the chat actually fit 1440×900 without page scroll (the budget above is arithmetic).
- That 2 cards per row actually fit, which depends on the real scrollbar gutter width on the OS.
- Keyboard: Tab reaches a scrolling column, arrow and PageDown keys scroll it, and the focus ring is visible.
- Screen reader announcement of the region label.
- The "More below" cue appearing and disappearing correctly; wheel and touchpad scrolling not chaining to the page.
- Tablet 768–1023 two-column layout.
- Mobile unchanged: recheck `scrollWidth === innerWidth` at 390 and 320 px.

## To close (round 4)

```bash
git switch feat/designer/overview-v3 2>/dev/null || git checkout -b feat/designer/overview-v3
pnpm -F @servrsit/web run build 2>&1 | tail -20
herdr pane read w1:p5 --source recent-unwrapped --lines 60
git add apps/web docs/team/handoff-designer-m2c.md
git commit -m "feat(web): overview round 4 — desktop three-column viewport fit with internal column scrolling"
```
