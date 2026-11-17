# Handoff — Designer, M2b
## T-018 v2 — Overview redesign per founder feedback (ADR-011 rounds 1–2)

**Status: code written. NOT built, NOT run, NOT committed. Do not mark done.**

This Designer session has no shell, terminal, or network tool. It can only read
and write workspace files. None of these were done:

| Requested step | Done? |
|---|---|
| `git checkout -b feat/designer/overview-v2` | No. Files are on whatever branch is checked out. |
| `pnpm run build` in apps/web | No. No output exists to report. |
| Read Vite pane w1:p5 for errors | No. |
| Download pixel font + license | No. No font file exists anywhere in the workspace (searched `.woff2`, `.ttf`, `silkscreen`, `pixelify`). |
| Commit | No. |

## 1. Changed files

| Path | Change |
|---|---|
| `packages/ui/src/tokens/colors.css` | Added `--color-page: #FFFFFF`. Canvas marked retired. |
| `packages/ui/src/tokens/typography.css` | Added `--font-pixel` (Silkscreen, monospace fallback). Page title is pixel 32/40 (mobile 24/32), card title (server names) is pixel 24/32, both weight 400. The display fallback no longer uses Arial Black. |
| `packages/ui/src/tokens/themes.css` | Created and then **deleted** in this session (the three-variant brief was replaced). Never committed. |
| `packages/ui/src/index.ts` | TS mirror updated: `colors.page`, `fontFamilies.pixel`, pageTitle/cardTitle sizes, family and weight. |
| `apps/web/index.html` | `width=device-width, initial-scale=1, viewport-fit=cover`; theme-color. Removed the link to a non-existent favicon. |
| `apps/web/src/fonts.css` (new) | Self-hosted `@font-face` for Silkscreen from `/fonts/silkscreen/`, `font-display: swap`. |
| `apps/web/public/fonts/silkscreen/README.md` (new) | Where to get the file and `OFL.txt`, the checksum step, and usage rules. |
| `apps/web/src/tokens.css` | White page. `--banner-h`. `.pixel-text` rendering class. `overflow-x: clip` on body as a backstop. Removed `overflow-y: scroll`. |
| `apps/web/src/main.tsx` | Imports `fonts.css`. |
| `apps/web/src/fixtures/overview.ts` | Removed briefing fields. Sentani finding is now "Disk at 71% · 6 services running"; the card labels it Historical. |
| `components/overview/Briefing.*`, `AskBar.*` | **Deleted.** |
| `components/overview/ChatBar.*` (new) | Visible "Ask ServrSit" label, scope chip, single-line bar, max 560 px, normal document flow. Placeholder, disabled. |
| `components/overview/OverviewScreen.*` | New order: page title → cards → attention + recent activity → chat bar. Pixel nav icons, three-color pixel band, mobile nav fix. |
| `components/server-card/PixelServerIcon.tsx` (new) | 16×16 rack server, `shapeRendering="crispEdges"`, rendered at 48 px (exact 3×). Identity fill only; LEDs are white, never green or red. |
| `components/server-card/ServerCard.*` | Same anatomy (article, heading link, badge, finding, last check, one action). Pixel name, Ink border, identity-colored hard offset shadow, dashed border plus a "Historical" chip when not fresh. |
| `components/StatusBadge/StatusBadge.module.css` | Border in the state color (second cue) and allowed to wrap. |
| `components/overview/AttentionColumn.*`, `RecentActivity.module.css` | `aside` → `section`. Pixel marker headings. `min-width: 0` and `overflow-wrap` fixes. |
| `components/FixtureBanner/*` | Fixed 36 px, single line, sticky. Explanation moved from `aria-label` on a span to sr-only text. |

## 2. Decisions

- **Pixel font: Silkscreen** (SIL OFL 1.1). It is drawn on an 8 px grid and is narrower than Press Start 2P, so names fit 280 px cards. Used for the page title ("Your servers"), server names and the wordmark only. I placed it at 8 px multiples: 32, 24 and 16 px. The source location in the README (`google/fonts`, `ofl/silkscreen/`) is from memory and unchecked.
- **Fonts are absent.** Until the file is placed, titles render in the monospace fallback, which won't look pixelated. Geist and Bricolage are also absent, so system sans renders. Nothing was faked.
- **An h1 is kept** ("Your servers", pixel 32 px) for document structure. It isn't a briefing statement and makes no fleet-state claim.
- **"Surprise me" choices:** white page, Ink 2 px outlines, identity-colored hard offset shadows on cards, a Tangerine/Lilac/Citron pixel band under the banner, pixel square markers on section headings, a Lilac scope chip, and a Tangerine send button and card action. Health colors appear only in badges, the Historical chip and the attention or activity icons.
- **Attention and recent activity sit side by side at ≥1200 px** (attention first in DOM and reading order) and stack below that. If the founder wants them strictly stacked at desktop too, change `.lowerGrid` to one column.
- **The chat bar is not fixed or sticky.** It's the last item in the document, which avoids covering content or the keyboard. The document end reserves `env(safe-area-inset-bottom)`.
- Next-check time is no longer shown (it lived in the removed briefing block). The fixture field remains.

## 3. Mobile drift: root cause (derived from the CSS, not observed on a device)

**Main cause: the ≤1199 px top navigation was one non-wrapping flex row wider than the viewport.**
I estimated each part's minimum width from the v1 CSS (rounded, from font-size and padding, not measured):

- Wordmark: about 90 px
- Three nav items with a 20 px icon, 8 px gap, label and 16 px padding each side: about 120 px each, so about 360 px plus 32 px list padding
- Account: about 60 px
- Nav padding: 32 px

That adds up to roughly 550 px, against a 390 px viewport. Flex items don't shrink below their content, so the document became wider than the screen. On a phone that means horizontal panning, and the page moves and drifts under touch.

Contributing causes, also fixed:

1. `min-height: 100vh` on the shell. Mobile Chrome changes the viewport height as the URL bar shows and hides, which makes the page jump. Now `100dvh`, with a `100vh` fallback.
2. Two sticky elements both at `top: 0` (fixture banner and nav), overlapping and reflowing. The banner now has a fixed 36 px height and the nav sticks at `top: var(--banner-h)`.
3. The old ask-bar input was a flex child without `min-width: 0`. Inputs have an intrinsic width of about 150–200 px, so at 320 px the row could overflow. The old suggestion chips also scrolled horizontally.
4. The viewport meta lacked `viewport-fit=cover`, and nothing respected safe-area insets.

Fixes: the nav wraps on mobile (wordmark and account on row 1, three equal `flex: 1 1 0; min-width: 0` links on row 2). All grid tracks use `minmax(0, …)` or `min(280px, 100%)`. Text containers have `min-width: 0` and `overflow-wrap: anywhere`. Badges can wrap. `overflow-x: clip` on body was added last, as a backstop only. There was no `100vw` in the code.

**Unverified:** I haven't loaded the page on a Xiaomi 14T or any browser. Confirm with DevTools at 390 and 320 px that `document.documentElement.scrollWidth === innerWidth` with the backstop line temporarily removed.

## 4. Contrast ratios (computed by hand, WCAG 2.x relative-luminance formula)

| Pair | Ratio | Requirement |
|---|---|---|
| Ink `#1D2532` on white | 15.41 | text 4.5 ✓ |
| Muted ink `#56606C` on white | 6.39 | text 4.5 ✓ |
| Placeholder (muted) on white | 6.39 | ✓ |
| Control boundary `#7B8490` on white | 3.79 | non-text 3 ✓ |
| Focus `#5141C6` on white | 7.19 | non-text 3 ✓ |
| Ink on Tangerine `#FF7648` (actions, send) | 5.82 | text 4.5 ✓ |
| Ink on Lilac `#C9B8FF` (scope chip, avatar) | 8.65 | ✓ |
| Ink on Citron `#D7EF52` (production label, action hover) | 12.00 | ✓ |
| Tangerine fill vs white | 2.65 | below 3, so buttons carry a 2 px Ink border (15.41) as their boundary |
| Badge pairs: passed `#185C44`/`#DDF5E7` | 6.89 | ✓ |
| attention `#794A00`/`#FFF0CE` | 6.66 | ✓ |
| failed `#A32F2B`/`#FDE7E5` | 5.92 | ✓ |
| unknown `#4D5663`/`#E7EBF0` (badge, Historical chip) | 6.20 | ✓ |
| progress `#344FA3`/`#E7ECFF` (fixture banner) | 6.39 | ✓ |
| State foregrounds on white (icons, badge borders): passed / attention / failed / unknown / progress | 7.91 / 7.52 / 7.00 / 7.43 / 7.52 | non-text 3 ✓ |
| Pixel icon Ink outline on white | 15.41 | ✓ |
| Identity fills vs white: Lilac / Citron / Tangerine | 1.78 / 1.37 / 2.65 | decorative; the icon shape is carried by the Ink outline |

These cover the opaque pairs only. Rendered states (hover, focus over shadows, disabled controls) have not been checked in a browser.

## 5. Not verified (no browser, no shell)

- That it compiles at all (`tsc && vite build`), and that the Vite pane is free of errors.
- Every visual result: composition, spacing, the pixel band, card shadows, how the monospace fallback looks.
- Pixel-font crispness and minimum readable size. Android Chrome ignores `-webkit-font-smoothing`. On a fractional device pixel ratio (the 14T is around 2.6–2.75, unconfirmed), glyph edges may soften even at 8 px multiples.
- That the pixel icon renders crisp at 48 px on fractional DPR screens.
- That the mobile nav fits at 320 px and that drift is gone.
- That sticky banner and nav behave on scroll; that `env(safe-area-*)` takes effect.
- Keyboard focus visibility on the Ink rail and over the card shadows.

## 6. Known gaps

- Only three identity colors exist. A fourth server would repeat one, so a larger identity palette is needed before fleets of 4+.
- The nav offset assumes the fixture banner is present (`--banner-h`). Set it to 0 when live data replaces fixtures.
- UX Spec text still describes the retired briefing. The Orchestrator updates it after founder approval (ADR-011).

## 7. To close

1. `git checkout -b feat/designer/overview-v2`
2. Add `Silkscreen-Regular.ttf` (or `.woff2`) and `OFL.txt` to `apps/web/public/fonts/silkscreen/`, and record the source and SHA-256.
3. `pnpm -F @servrsit/web run build`, and read pane w1:p5.
4. Check 1440×900, 390×844 and 320 px, plus the scrollWidth test above.
5. Commit only `apps/web/**`, `packages/ui/**` and this handoff.

Next task: T-019 (server detail), after founder approval of this mockup.
