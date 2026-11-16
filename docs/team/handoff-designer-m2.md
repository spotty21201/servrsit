# Handoff — Designer, Milestone M2
## T-018 — High-fidelity overview screen (fixture)

**Status: code written, NOT built, NOT run. Do not mark T-018 done.**

The Designer session had no command-execution tool. These were not run:
`pnpm install`, `pnpm run build`, `pnpm run dev`, `git checkout -b feat/designer/overview-screen`.
Work is on whatever branch is currently checked out. The Orchestrator or Coder must create the branch and run the checks below.

## 1. Changed files

| Path | What / why |
|---|---|
| `apps/web/package.json` | Scripts and deps: React 19.1.0, Vite 6.3.5, plugin-react 4.5.2, TypeScript 5.8.3, workspace deps on `@servrsit/ui` and `@servrsit/contracts`. No CSS framework. Versions are my selections and have NOT been checked against the registry or current releases. The brief said React 18; I used 19 to match the React 19.3.1 already in the lockfile for `packages/ui`. Confirm or change. |
| `apps/web/tsconfig.json`, `vite.config.ts`, `index.html` | Strict TS, bundler resolution. Vite aliases `@servrsit/ui` to its source because `packages/ui` has no `dist/`. |
| `apps/web/src/vite-env.d.ts` | Types for `*.module.css` imports. |
| `apps/web/src/tokens.css` | Imports `packages/ui/src/tokens/index.css` by relative path, plus a minimal reset and global focus ring. |
| `apps/web/src/main.tsx`, `App.tsx` | Entry; renders `OverviewScreen` with `overviewFixture.data`, `isFixture={true}`. |
| `apps/web/src/fixtures/overview.ts` | `FixtureData<OverviewFixture>` via `asFixture`. Timika (fresh), Nabire (attention, 7 updates), Sentani (unreachable, stale), 2 findings, 1 succeeded operation. Dates 2026-11-15. |
| `components/FixtureBanner/` | Non-dismissable sticky `[FIXTURE DATA]` banner. |
| `components/StatusBadge/` | Icon + text badge for the five semantic states. |
| `components/server-card/` | `<article>` with heading link, SVG emblem (Lilac/Citron/Tangerine, identity only), production label, badge, finding, freshness, one action link. |
| `components/overview/` | `OverviewScreen`, `Briefing`, `AskBar` (disabled placeholder), `AttentionColumn`, `RecentActivity`, plus CSS modules. |
| `packages/ui/package.json` | Added a `source` export condition. |

## 2. Checks run

None executed. Only static review by reading: relative imports use `.js` extensions; type-only imports use `import type`; no hex colors in `apps/web` CSS (tokens only). That is not a substitute for a build.

## 3. Required before T-018 can close

1. Create `feat/designer/overview-screen` from main.
2. `pnpm install` at the workspace root, which will change `pnpm-lock.yaml` (Coder owns it).
3. `pnpm -F @servrsit/web typecheck`, `build`, then `dev`.
4. View at 1440×900 and 390×844. The acceptance criteria are unverified, including no horizontal overflow and the 2-column roster.

## 4. Known gaps and likely risks

- `@servrsit/contracts` is imported as a type only; it resolves through `dist/`, which exists today but is gitignored.
- `packages/ui` `exports` has both `source` and `import` conditions. I wasn't able to test how Vite resolves it, so the alias in `vite.config.ts` is the real path.
- Fonts are not placed, so system fallbacks render (see `packages/ui/src/fonts/README.md`).
- Roster grid is `repeat(2, minmax(280px, 1fr))` beside a 320px attention column. At 1024–1199px the layout switches to one column. Not visually checked.
- Mobile suggestions scroll horizontally. UX Spec §5.3 says to avoid horizontal card carousels. These are chips, not cards, but this deserves review.
- Fixed during this session: the nav wordmark was rotated vertical text, which goes against UX Spec §4.3. It is now horizontal. A hardcoded "Operational" service indicator had no data source and was removed. The top line now shows only the workspace name until a real availability source exists.
- The ask bar is disabled, which lowers its contrast. Disabled controls are exempt from WCAG contrast, but a reviewer should confirm it is clearly a placeholder.
- No semantic check for UX Spec §8.1: "Two things need a look" is hardcoded fixture text, not computed.

## 5. Next task

T-024 (Tester) needs T-018–T-022. T-019 onward (server detail) can start once T-018 builds.
