# Handoff — Tester to Designer (via Orchestrator): D-U17

**From:** Kiro Tester · **To:** Kiro Designer, routed by Kiro Orchestrator · **Date:** 2026-11-18
**Source:** `docs/team/test-report-ui-a11y-003.md` §3 (commit `8146a01`), measured on integration/next `a505603`
**Owner of the fix:** Designer (presentation layer of `apps/web/`: Overview server-card grid and the view bar)
**Requirement links:** UX Spec motion rules (hover/focus response, state change preserves item position); WCAG 2.2 SC 2.4.11 (passes) and pointer target behaviour

## Defect

| ID | Severity | Where | Description |
|---|---|---|---|
| D-U17 | Low | Overview, first row of server cards, desktop 1280 px | A focused or hovered card lifts by about 14 px and slides under the view bar's box (the "Cards / Compact list / Sort by" row). While the card is lifted, its top strip of about 12 px belongs to the view bar, so a click there does nothing. The card name stays fully visible with its highlight and underline, so SC 2.4.11 (focus not obscured) passes. |

**Repro**
1. Open the Overview at a viewport width of 1280 px, in fixture mode.
2. Hover over, or Tab to, a card in the first row.
3. Click within about 12 px of the card's top edge. Nothing happens.

**Measured:** the view bar spans y = 185 to 233 px. The card's top is at 233 px at rest and 219 px when lifted.

**Expected:** the whole visible card is clickable at rest and when lifted, and the card never slides under another element's hit area.

**Evidence**
- `docs/team/evidence/a11y-003/d-u17-focus-lift-1280.png`
- `tests/e2e/a11y/browser/hit-area-probe.mjs` (uses `elementFromPoint` along the card's top edge)

**Possible fixes (Designer's choice):** give the grid a top margin of at least the lift height, or don't lift on focus and hover (for example, use a shadow or outline change instead).

**Re-test:** re-run `hit-area-probe.mjs` at 1280, 1024 and 390 px, plus the a11y browser pass. D-U17 is closed when no point inside a visible card belongs to the view bar.

## Proposed task-board line (for the Orchestrator to add; the Tester does not edit the board)

`| T-0xx | Designer | D-U17: lifted server card slides under the view bar at 1280 px (top ~12 px not clickable) | UX Spec motion rules; WCAG 2.4.11 | todo | evidence: docs/team/evidence/a11y-003/d-u17-focus-lift-1280.png |`

The latest board I can see (`integration/live-v1`, `53d5fa5`) ends at T-084, so the next free ID would be T-085.
