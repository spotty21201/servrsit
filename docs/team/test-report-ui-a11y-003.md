# Test Report: accessibility re-run on the merged release candidate

**Tester:** Kiro Tester  
**Code tested:** `integration/next` head **`a505603`** (includes Designer `t080`, T-077 to T-082), merged into `feat/tester/next`. Product source not changed.  
**Method:** the same as `test-report-ui-a11y-001/002`: jsdom with axe-core 4.14.1 over 59 states, CSS analysis of the real stylesheets, and real headless Chromium at 1280, 1024, 768, 390 and 320 px with axe (contrast on), measured targets, a Tab walk and the focus-obscured probe. Plus a new hit-area probe that asks the browser what a click at 25 points of each server card opens.

## Result: PASS. D-U10, D-U14, D-U15 and D-U16 are closed. One new Low (D-U17).

| Check | Result |
|---|---|
| jsdom suite (159 tests) | **143 pass, 0 fail, 16 `todo`** (see 2 for what the open `todo`s mean) |
| Real Chromium, 20 states × 5 widths | **100 runs, 789 tab stops: 0 axe violations, 0 px overflow, 0 stops without a focus indicator, 0 obscured, 0 targets under 44 px at 390/320 px** |
| Page titles | descriptive, 18 distinct over 20 states (two states share a screen) |
| Browser sign-in walkthrough (from `test-report-next-001` §7) | 9/9 at `a9b461c` |

## 1. The four defects you asked about

| Defect | Status | Evidence |
|---|---|---|
| **D-U10** links under the 44 px goal | **Closed** | Fixed by `2a14579` (brand, breadcrumb) and `eff41ed` (server-name links: 44 px boxes with a stretched hit area). Brand and breadcrumb no longer appear in any size check. For the server cards, the browser shows that **21 to 23 of 25 points of every card open it** at 1280, 1024 and 390 px; the rest land on the card's own action ("View server", "Check connection"), as designed. No control is under 44 px at touch widths. |
| **D-U14** `aria-label` on a role-less span ("no value") | **Closed** | ST-20 passes on every state. |
| **D-U15** "Server not found" page had no `<h1>` | **Closed** | ST-01b passes; real-browser axe no longer reports `page-has-heading-one`. |
| **D-U16** focus hidden under the sticky navigation at 768/1024 px | **Closed** | Focus-obscured probe: **0** focused stops covered at 1024 and 768 px (was 2 and 1). |

## 2. Why some `todo` tests still "fail" although the defects are closed

**CSS-01b and CSS-02** (the static target-size checks) still list the server-name links at 17 px. That is a **limit of my static CSS engine**, not of the product. It cannot resolve the component-scoped `--link-pad` variable, and it cannot see the stretched `::after` hit area. The real-browser measurement in section 1 replaces it. I will move these two checks to the browser pass rather than keep a static estimate that the fix has outgrown. The remaining `todo` markers belong to defects closed earlier, whose guards now pass (listed in `test-report-ui-a11y-002`).

## 3. New

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| **D-U17** | Low | **A focused or hovered server card lifts about 14 px and slides under the view bar's box** (the "Cards / Compact list / Sort by" row) on the first row at 1280 px. The name stays fully visible with its highlight and underline (screenshot), so WCAG 2.4.11 passes. But while lifted, the top strip of about 12 px of the card belongs to the view bar, so a click there does nothing. Measured: view bar 185 to 233 px, card top 233 at rest and 219 lifted. Suggest giving the grid a top margin at least the lift height, or not lifting on focus. | `docs/team/evidence/a11y-003/d-u17-focus-lift-1280.png`, `tests/e2e/a11y/browser/hit-area-probe.mjs` |

## 4. Not run (unchanged)

Screen reader, real touch device, 200 % zoom, forced-colors rendering, Firefox and Safari.

## 5. Files

```
tests/e2e/a11y/browser/hit-area-probe.mjs        new: what a click on each card opens
docs/team/evidence/a11y-003/d-u17-focus-lift-1280.png
```
