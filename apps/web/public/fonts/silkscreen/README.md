# Silkscreen font

**Status: present.** Added by the Orchestrator (round 3) from the Google Fonts
repository (`google/fonts`, `ofl/silkscreen/`):

| File | Purpose |
|---|---|
| `Silkscreen-Regular.ttf` | Declared in `apps/web/src/fonts.css`, used by `--font-pixel` |
| `Silkscreen-Bold.ttf` | Committed, not declared (no pixel text uses bold) |
| `OFL.txt` | SIL Open Font License 1.1, unmodified. Keep it with the fonts. |

Served by Vite at `/fonts/silkscreen/<file>`.

Before this, only this README existed, so browsers fell back to monospace
(Courier on the founder's phone).

Not yet recorded: the source commit hash and SHA-256 of each file. Add them
here or in `docs/decisions/decision-log.md`.

## Why Silkscreen

- Drawn on an 8 px grid, so it renders crisp at 8/16/24/32 px.
- Narrower than Press Start 2P, so server names fit the cards.
- SIL OFL 1.1 permits self-hosting and redistribution with the license.

## Usage rules

- `--font-pixel` only for page titles, server names and the wordmark.
- Keep sizes at multiples of 8 px (page title 24 px; server names 24 px desktop, 16 px mobile; wordmark 16 px).
- Never for body text, buttons, data or timestamps.
- Optional later: convert to woff2 for smaller transfer; add a `src` line above the ttf one in `fonts.css`.
