# Pause 001 (2026-11-22): where ServrSit stands

## State at pause

- **Running app:** branch `integration/live-v1` (also `main`). Web in Herdr pane `Dev-Server` (Vite on 100.104.220.8:5173), API in pane `API` (port 3001, localhost). Both are dev processes: **they do not restart after a Merauke reboot.** Restart: in `apps/api` run `pnpm run dev`; in `apps/web` run `pnpm exec vite`.
- **Writes:** enabled for **Sentani only** (`apps/api/config/writes.json`, ADR-026), package updates only. Nabire, Timika, Merauke: write-disabled. To switch off: set `writesEnabled` to `false` and restart the API.
- **Helper:** 0.3.0 installed on Sentani only (ADR-022, ADR-024). Nowhere else.
- **Milestone:** first founder-approved update through the app on Sentani succeeded and was verified independently (ADR-027).
- **Secrets (never committed, live only on Merauke):** `apps/api/.env` (AI key: rotate it, it was shared in chat), `apps/api/.data/` (pinned host keys, auth DB, signing key, per-server keys), `~/.ssh/servrsit/`.

## Work in progress (committed, not merged)

| Branch | What | Next step |
|---|---|---|
| `feat/coder/t094-receipts` | WIP T-094 receipt contract (reboot evidence, restartNeeded, services restarted by packages) | Finish, then Designer does the screens |
| `feat/tester/sentani` | All Sentani test reports and harnesses | Reports are final for this round |

## Open items, in suggested order

1. **UI/UX round** (founder's next focus; see docs/team/ux-feedback-001.md for the history).
2. T-094 receipt gaps; T-095 target time-sync finding.
3. Clock fix on Sentani (same as Merauke: `scripts/fix-merauke-clock.sh`).
4. D-T2 (kept owner files before approval), O-T1, D-S1, T-085, T-086, role edit button.
5. Before any second real server (Nabire first): live `.dpkg-dist` case, install T-091 forced-command inspect keys, dedicated key for Nabire, helper install with founder approval.
6. Alpha gaps: auto-start services on Merauke, FR-04 important services, FR-05 security observations and package-list refresh opt-in, FR-07 plan card from chat, FR-21 retention deletion, PRD §12 baseline log.
7. Hosting decision (AWS or other always-on host).

## Reports

Tester: `/projects/servrsit-tester/docs/team/test-report-*.md` (on `feat/tester/*` branches). Decisions: `docs/decisions/decision-log.md` (ADR-001 to ADR-027). Task board: `docs/team/task-board.md`.
