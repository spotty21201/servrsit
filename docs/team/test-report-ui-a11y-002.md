# Test Report: accessibility and keyboard pass on T-067, T-068, T-070, T-071, T-073, T-074 (and T-075); T-072 re-check

**Tester:** Kiro Tester  
**Code tested:** `feat/designer/t067` pinned at **`8062beb`** (the branch head when I started; it also contains T-072 and T-075), checked out in my own throwaway worktree, which is now removed. Designer's worktree was not touched, and its uncommitted edits are not included.  
**Method:** the same as `test-report-ui-a11y-001.md`: the real `App` in jsdom with axe-core 4.14.1, CSS analysis over the real stylesheets, and a real headless Chromium pass (axe with contrast on, measured targets, a real Tab walk at 1280, 1024, 768, 390 and 320 px). All data is `[FIXTURE DATA]`: each new screen uses its own built-in fixture client, and `/api/fleet` comes from my scripted fake API.

## Result: PARTIAL. 11 of 12 earlier defects are closed; 3 new defects (1 Medium, 2 Low); D-U10 still open.

| Check | Result |
|---|---|
| jsdom suite, now **59 states** (39 earlier + 20 new) | **159 tests: 143 pass, 0 fail, 16 `todo`** (axe 60, structure 25, CSS 73, control 1) |
| axe in jsdom, 59 states | 0 violations (axe control check passes) |
| **Real Chromium**, 20 states × 5 widths | **101 runs, 940 tab stops**. One axe violation type, `page-has-heading-one` on the "Server not found" page (D-U15). 0 px horizontal overflow everywhere. |
| Contrast | 4,746 text/background pairs, lowest **5.4:1**, 24 unresolved (text on gradients) |
| Focus indicator | Present on every real tab stop, plus the two below, which my checks first got wrong |
| Page titles | Distinct and descriptive on all 20 browser states, with the step for flows ("Connect a server: step 1 of 4, Meet the server · ServrSit") |

## 1. T-072: were D-U1 to D-U12 closed? (each earlier `todo` test now passes, so it is a guard)

| Defect | Status | Evidence |
|---|---|---|
| D-U1 same page title everywhere (Medium) | **Closed** | ST-05; 18 distinct titles over 20 browser states (two states share a screen) |
| D-U2 no skip link | **Closed** | ST-06; first Tab stop is "Skip to main content", `z-index` 1000, visible above the sticky banners |
| D-U3 errors not tied to fields | **Closed** | ST-08 |
| D-U4 disabled buttons give no reason | **Closed** | ST-10. Disabled actions now stay focusable with `aria-disabled` and a visible reason. |
| D-U5 focus lost after sign-out | **Closed** | ST-12; in Chromium focus lands on the sign-in heading, and the page announces "Signed out, sign in" |
| D-U6 Show/Hide toggle name and state | **Closed** | ST-15 |
| D-U7 `<ul role=log>` | **Closed** | ST-19; axe "known violation is gone" passes |
| D-U8 `aria-label` on the brand `<p>` | **Closed** | Attribute removed from `AuthFrame.tsx`. Its guard ST-20 still fails, now for D-U14 (new). |
| D-U9 "Waiting" text 3.78:1 (Medium) | **Closed** | CSS-04b; lowest pair anywhere is now 5.4:1 |
| **D-U10** links under the 44 px goal | **Still open** | Server-name links 104–106×20 on mobile, brand and breadcrumb links unchanged. WCAG 2.5.8 AA is still met through the spacing exception. |
| D-U11 no forced-colors rules | **Closed** | CSS-10 (rules exist; not rendered in forced-colors mode) |
| D-U12 nav Tab order ≠ visual order | **Closed** | CSS-12 at all widths |
| D-U13 raw `CLOCK_UNTRUSTED` shown | **Closed** | ST-24: every auth error code has its own wording |

## 2. New defects

| ID | Sev | Where | Finding | Evidence |
|---|---|---|---|---|
| **D-U16** | **Medium** | Overview (`/fixtures/overview`, T-075 stress fixture) at **768 and 1024 px** | **Keyboard focus is hidden under the sticky top navigation.** Tabbing down the server list, the focused server-name link ends up under the nav, and 3 of 3 sample points of its box hit a nav item: "Fixture 02" and "Fixture 06" at 1024 px, "Fixture 05" at 768 px. WCAG 2.4.11 Focus Not Obscured (Minimum), Level AA. 1280 px and phones are fine. Clicking is unaffected: each link receives its own click. Likely fix: `scroll-padding-top` equal to the sticky nav's height. | `tests/e2e/a11y/browser/focus-obscured-probe.mjs` |
| D-U15 | Low | T-067 server detail, unknown id (`/servers/<id not in fleet>`) | **The "Server not found" page has no `<h1>`.** The title says "Server not found · ServrSit" but there is no heading for screen-reader navigation. Real-browser axe `page-has-heading-one` at all 5 widths. | ST-01b (`todo`) |
| D-U14 | Low | T-067 server detail | **`<span aria-label="no value">—</span>`** for empty values. `aria-label` on a role-less span is ignored by most screen readers, so "—" or nothing is read. Use visually hidden text, or `role="img"` with the label. | ST-20 (`todo`) |

## 3. New screens: what is good (measured)

- **T-068 connect flow**: real labels, hints tied to fields, errors tied to fields after an empty submit, a step indicator, and the page title carries the step. Walked through 4 steps in jsdom.
- **T-073 baselines**: radio groups in a `fieldset` with a `legend`; the "Review a setup plan" action is unavailable with a stated reason until the comparison runs.
- **T-070 findings, T-071 activity, T-074 settings**: no violations; the empty search state of activity is announced; the settings time field shows the 2 px ring when focused by keyboard.
- No horizontal overflow on any new screen at 320 or 390 px.

## 4. My own errors this round (caught before reporting)

1. **Five apparent failures were my checks, not the product.** ST-09 and ST-17 still expected the `disabled` property; T-072 deliberately moved to focusable `aria-disabled`. They now accept either and also press the button to prove it does nothing. CSS-07 did not recognise the `background` shorthand, a `:has()` row outline, or the standard unfocusable-`main` skip target. The browser "obscured focus" check ignored `z-index`, which flagged the skip link wrongly; it now asks the browser which element is on top. A time field reported "no indicator" was confirmed to show the ring when probed directly.
2. **The `scrollIntoView` gap.** jsdom has none; the settings section crashed until I stubbed it. The browser pass covers the real behaviour.
3. **A careless process kill.** While debugging a hang I ran `pkill -f "tsx --test"`, which matches any process with that text. It killed my own shell. I then listed processes without killing anything: Designer's dev servers and the long-running watchers were untouched. I cannot rule out that it ended someone else's test run at that moment. I now stop only PIDs I started.
4. The jsdom axe file hangs after all its tests finish (something keeps the event loop open; results are complete). Not investigated.

## 5. Not run

Screen reader, real touch device, 200 % zoom, forced-colors rendering, Firefox and Safari: same as report 001.

## 6. Recommendations

1. Fix **D-U16** (one CSS line, `scroll-padding-top`), then D-U15 and D-U14 (small markup fixes).
2. D-U10 still needs a decision: stretched hit areas for server-name links, as the activity rows have.
3. A person still needs to do the screen-reader pass.

## 7. Files

```
tests/e2e/a11y/support/states2.mts               20 new states (T-067..T-075), added only when the screens exist
tests/e2e/a11y/support/states.mts, env.mts, api.mts   wiring, scrollIntoView stub, call log
tests/e2e/a11y/structure.test.mts, css.test.mts  aria-disabled accepted (and pressed), ST-01b, D-U14 guard, CSS-07 replacements
tests/e2e/a11y/browser/browser-check.mjs         new routes; WEB_ROOT; z-index-aware obscured-focus metric
tests/e2e/a11y/browser/focus-obscured-probe.mjs  reproduces D-U16
docs/team/evidence/a11y-002/*.json               browser and jsdom results
```
