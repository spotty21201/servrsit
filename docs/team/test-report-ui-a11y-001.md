# Test Report: accessibility and keyboard pass on the login screens (T-065) and plan/operation screens (T-060)

**Tester:** Kiro Tester  
**Date:** 2026-11-18 as stamped by Merauke's clock, which runs about 7 h fast. Durations and counts are unaffected.  
**Branch:** `feat/tester/ui-a11y`, which merges `feat/designer/t065` at `bff8ba8`. That branch already contains T-060 (plan and operation screens), T-063 (controller clock) and Coder's owner auth `2bfaa34`.  
**Spec:** UX Spec "Accessibility" section (Target WCAG 2.2 AA, lines 449-461), UX §7.1 (sign-in), UX Form field, Button and Disclosure component rows, WCAG 2.2 success criteria as named per check.  
**Product source changed:** none. Tests, one standalone tool folder and evidence only.

## Result: PARTIAL

No Critical or High finding. **12 defects: 2 Medium, 10 Low.** Nothing blocks sign-in, approval or reading a result. Two Level A/AA problems need fixing before this is called WCAG 2.2 AA: the page title never changes (D-U1) and one text colour is too light (D-U9).

"Partial" because a person still has to do three things I cannot: a real screen reader, a real phone, and a look at the screenshots. See §3 and §8.

| Part | Status |
|---|---|
| axe-core on every state, in jsdom (39 states) | **Done.** 0 violations in 38 states; 2 in the opened transcript (D-U7). |
| Same checks in a **real Chromium**, contrast on (55 page runs, 11 states × 5 widths) | **Done.** Only violation: the one low-contrast colour (D-U9). |
| Keyboard: every tab stop reached and measured in the browser (270 stops) | **Done.** No trap, no hidden focus, one order mismatch (D-U12). |
| Focus indicator, target size, contrast, reflow | **Done**, partly from CSS and partly measured in the browser. |
| Screen reader, real touch device, 200 % zoom, forced-colors rendering | **NOT RUN** (§3). |
| 401 sweep on owner-auth after **T-066** | **PENDING.** T-066 is `todo`. Baseline on today's code is green (§6). |

## 1. How I did it, and why you can trust a clean result

No browser was available in my first attempt (9 system libraries missing, no sudo). I used four layers and checked each against known-bad input.

| Layer | What it is | Check that it can fail |
|---|---|---|
| **A. jsdom + axe-core 4.14.1** | The **real** `App` rendered from `apps/web/src` against a scripted fake API, driven like a person (typing, clicking). 39 states: sign-in (10), setup (6), overview (3), plan (9), operation (11). | `control.test.mts`: known-bad markup (missing alt, label, button name, link name, orphaned `<li>`) is reported. |
| **B. CSS analysis** | A small cascade engine over the **real** stylesheets and tokens (specificity, source order, media queries, `var()`), applied to the rendered DOM. 3,060 text pairs, 609 control measurements. | It independently found the one real low-contrast pair, and its Ink-on-Tangerine ratio (5.82) matches the UX Spec's own "5.8:1". |
| **C. Real Chromium 159** | `tests/e2e/a11y/browser/browser-check.mjs`. Serves the built `dist/` through request interception (no server started), mocks every `/api` call, walks Tab through each state at 1280, 1024, 768, 390 and 320 px. Axe with colour contrast **on**. | It confirmed the contrast number (3.78 against my 3.79) and the sign-out focus loss that jsdom predicted. |
| **D. Source scan** | No click handler on a non-interactive element, no positive `tabIndex`, no `autoFocus`, no `<a>` without `href`, no `<img>` without `alt`. | Pattern checks; 0 hits. |

**Pinned tooling, product untouched.** `axe-core 4.14.1`, `jsdom 31.0.1`, `postcss 8.5.33` are exact versions in `tests/e2e/a11y/package.json` with its own lockfile. It is deliberately **not** in the pnpm workspace, so no product manifest or lockfile changed. Install: `cd tests/e2e/a11y && pnpm install --ignore-workspace --frozen-lockfile`. The browser pass uses Designer's `playwright-core` (`/tmp/pw`) and extracted system libraries (`/tmp/libs`); I only read and ran them, and installed nothing system-wide.

**Run it:**
```
cd apps/web && pnpm exec tsx --test ../../tests/e2e/a11y/*.test.mts        # layers A, B, D
pnpm --filter @servrsit/web build
LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu node tests/e2e/a11y/browser/browser-check.mjs   # layer C
```

## 2. Results

**Automated suite:** 119 tests, **105 pass, 14 `todo`, 0 fail.** Each `todo` asserts the required behaviour and fails today. It is a defect from §4 and becomes a guard when fixed. Whole repo `pnpm test`: **516 pass, 0 fail.** Web product tests: 101 of 101. Typecheck of the new files: 0 errors.

### Against the UX Spec's accessibility list

| Requirement | Result | Evidence |
|---|---|---|
| Text contrast 4.5:1 (3:1 large) | **FAIL, 1 pair** (D-U9). Everything else passes. | 3,060 pairs, 10 unresolved (text on a gradient); thinnest passing pair 5.82:1. Browser axe: same single pair. |
| Control boundaries 3:1 | PASS | 52 inputs, lowest 3.79:1. |
| Focus colour visible on every surface | PASS | `#5141C6` is 6.07 to 7.19:1 on all four surfaces used. |
| Visible 2 px focus ring with offset | **PASS** | Global rule is 2 px with offset. **270 of 270** real tab stops show an indicator: 250 the 2 px ring, 5 the same ring on the container (Ask ServrSit console), 15 a highlight plus 3 px underline (server-name link, documented in the CSS). 4 rules remove an outline; each puts one back. |
| Focus not hidden under sticky controls | **PASS** | 0 of 270 tab stops overlap a sticky or fixed element (the fixture banner, clock banner and approval panel are sticky). |
| Complete keyboard use | **PASS** | Every control reached by Tab; the walk always ends by cycling, so no trap. Every form has a real submit button. Sign-in completes using only form controls. |
| Logical headings, landmarks, labels | **PASS** | 39 of 39 states: exactly one `<h1>`, one `<main>`, `lang="en"`, no skipped level, every enabled control named, accessible name contains the visible text. |
| **Skip navigation** | **FAIL** (D-U2) | No skip link in any state; first Tab stop is a nav link. |
| **Descriptive page titles** | **FAIL** (D-U1) | 55 of 55 browser pages are titled "ServrSit — Overview". |
| Associated error | **FAIL** (D-U3) | Alerts exist but are not tied to the field. |
| State changes announced | PASS | Errors in `role="alert"` (absent before submit); "Submitting approval" in a polite status; critical clock banner in `role="alert"`. No ticking countdown in any live region. |
| 44 px targets | **PARTIAL** (D-U10) | 417 of 609 measurements are 44 px or more; the rest are text-height links (§4). WCAG 2.5.8 AA is **met**. |
| Reflow at 320 px | **PASS** | 0 px horizontal overflow in all 11 states at 390 and 320 px in the browser. |
| Respect reduced motion | **PASS (by mechanism)** | No keyframe animation; all durations are tokens that collapse to 1 ms under `prefers-reduced-motion`. Not rendered with emulation. |
| No auto dark mode (Stage A) | PASS | No `prefers-color-scheme` anywhere. |
| Forced-colors / high contrast | **FAIL** (D-U11) | No rule exists. Effect not rendered. |
| Dialogs restore focus | n/a | The app has no dialog yet. |
| Fixture data labelled in text | PASS | `[FIXTURE DATA]` text on every fixture plan, operation, overview and clock page. |
| Status not by colour alone | PASS | Server status is text ("All checks passed", "Unreachable from ServrSit", "Check overdue"); steps have a text status. |

### What works well (all measured)

- **Sign-in and setup:** real `<label>`s, no placeholder-only fields, correct `autocomplete` tokens (`username`, `current-password`, `new-password`, `one-time-code`), nothing takes focus on load, focus moves to the new step's heading on each step change, pasting and password managers allowed.
- **QR code:** `role="img"` with a name, plus the key as text, a Copy button and an "Open in authenticator app" link. **Recovery codes:** a labelled list of 10, Copy all, Download, and Continue stays disabled until the owner ticks "I saved these".
- **Lockout:** names when to retry, and the form is disabled until then.
- **Plan and operation:** production acknowledgements are real checkboxes with names; transcript region is keyboard-focusable and named, with `aria-live="off"`.
- **Clock banner (new):** `role="alert"` when critical, `role="status"` otherwise, icons hidden from assistive technology, text states the effect ("Approvals are paused").

## 3. Not run, and why

| Not run | Why | Who |
|---|---|---|
| **Screen reader** (VoiceOver, NVDA, TalkBack): announcement order, whether the sign-out notice or alerts are actually spoken | No screen reader here. Everything above is markup and ARIA, which is necessary but not sufficient. | A person; the owner's phone for VoiceOver/TalkBack. |
| **Real touch device**, and tap accuracy on the 20 px links | Emulated touch only (`pointer: coarse`). | A person. |
| **200 % zoom, text-spacing override** | I used 320 px width as the proxy (the UX Spec treats them as equivalent). | A person. |
| **Forced-colors and reduced-motion rendering** | I read the CSS; I did not render with emulation. | Quick follow-up once D-U11 is decided. |
| **Colour contrast on 4 items axe could not decide** (select on a gradient, active nav label, completed-step text on a pseudo-element) | Browser axe says "could not determine". By tokens they are large margins, but I did not look at a screenshot. | A person with the 38 Designer screenshots. |
| **Firefox and Safari** | Chromium only. | |
| **Focus staying put during background polling** (UX: "Do not move focus unexpectedly when background checks finish") | The poll is 30 s; I did not wait through one in the browser. Source has no focus calls outside the sign-in step change. | Next pass. |
| **Designer's 38 screenshots** | I did not review them visually, only measured. | |

## 4. Defects

Severity: Medium = fails a WCAG 2.2 A/AA criterion for real users. Low = deviates from the UX Spec or a best practice and has a workaround or limited effect.

| ID | Sev | Finding | Where | Evidence |
|---|---|---|---|---|
| **D-U1** | **Medium** | **Every screen has the same page title, "ServrSit — Overview"**, including sign-in, setup, plan and operation. Nothing sets `document.title`. WCAG 2.4.2 (Level A). The UX Spec asks for descriptive titles and that route changes announce the new title. Browser history, tab bars and screen readers all show "Overview". | `apps/web/index.html:8`; no assignment anywhere in `apps/web/src` | ST-05; 55 of 55 browser pages. |
| **D-U9** | **Medium** | **"Waiting" and "Not started" step status uses the control-boundary grey `#7B8490` as text: 3.78:1 on white, needs 4.5:1.** WCAG 1.4.3 (AA). 14 px bold, so not "large". The UX Spec reserves that colour for control edges. Suggest Muted ink `#56606C` (5.8:1) or the Unknown foreground `#4D5663`. | `apps/web/src/care/care.module.css:264` (`.sPending`) | CSS-04b; real-browser axe `color-contrast`, `op-running` at all 5 widths. |
| D-U2 | Low | **No skip link.** The `#main-content` target exists on sign-in and care pages (`AuthFrame.tsx:11`, `CareShell.tsx:32`) but nothing links to it, and the Overview `<main>` (`OverviewScreen.tsx:93`) has no id. UX Spec requires skip navigation. WCAG 2.4.1 is arguably met by the landmarks, so Low. | | ST-06; first Tab stop on every page is a nav link. |
| D-U3 | Low | **Error text is not tied to its field.** Sign-in inputs carry `aria-invalid` but no `aria-describedby`, and the alert has no id. On the setup-token refusal no field is marked. The alert is spoken once, but the field does not carry the explanation afterwards. UX "Form field: associated error". | `SignInScreen.tsx:112,117,133,150`; `SetupScreen.tsx:132,171`; `AuthFrame.tsx` `Notice` | ST-08, 7 states. |
| D-U4 | Low | **Disabled primary buttons give no reason.** Continue, Sign in, Sign in with recovery code, Continue to authenticator, Confirm and create account, Continue to ServrSit. The plan approval button does explain itself, so this is inconsistent. A disabled button is also skipped by Tab, so a keyboard user cannot find it or read why. UX Button row: "disabled reason available nearby". | `SignInScreen.tsx`, `SetupScreen.tsx` | ST-10, 6 states. |
| D-U5 | Low | **After Sign out, keyboard focus falls to `<body>`.** The old page is removed and the sign-in screen only moves focus on a step change. A keyboard user restarts from the top; the "You're signed out" notice is a status node inserted with the page, which readers often skip. | `AuthGate.tsx` `signOut`; `SignInScreen.tsx:42-43` | ST-12; **confirmed in real Chromium** (`active: body`). |
| D-U6 | Low | **Show/Hide password changes its name and sets `aria-pressed`.** Pressed, it reads "Hide, pressed", which sounds like the opposite. Keep one name ("Show password") with `aria-pressed`, or change the name and drop `aria-pressed`. | `SignInScreen.tsx:118`; `SetupScreen.tsx:139` | ST-15. |
| D-U7 | Low | **`<ul role="log">` leaves its `<li>` children without a list.** axe: `aria-allowed-role` (minor), `listitem` (serious), when the transcript is open. Use a `div role="log"` around the list, or drop the role. | `OperationScreen.tsx:97` | ST-19; axe jsdom `op-running-transcript-open`. |
| D-U8 | Low | **`aria-label` on a `<p>`** (the brand text): not a permitted ARIA use, and the label equals the text. On all 16 sign-in and setup states. Remove it. | `AuthFrame.tsx:12` | ST-20; axe "incomplete" `aria-prohibited-attr`. |
| D-U10 | Low | **Some links are shorter than the 44 px product goal.** Brand link **88×20**; breadcrumb "Overview" **61×18**; server-name links **118×20 on mobile** (177×31 desktop; no stretched hit area, unlike the activity rows); production acknowledgement row **692×39 at 768 px**. All pass WCAG 2.5.8 AA through the spacing exception (checked on the measured boxes in 55 runs), so this is a UX-Spec gap, not an AA failure. The Ask scope select is 28 px with a mouse and 44 px on touch by design; that is correct. | `care.module.css:31`; `ServerCard.module.css:137`; breadcrumb in `CareShell.tsx` | CSS-01b, CSS-02; browser measurements. |
| D-U11 | Low | **No forced-colors rules at all**, though the UX Spec asks for them. Focus uses `outline`, which Windows high contrast keeps. Things that rely on background colour alone (the password strength meter, notice backgrounds) may vanish. Not rendered here. | all stylesheets | CSS-10. |
| D-U12 | Low | **Tab order does not match the visual order in the Overview navigation.** The visual order (CSS `order`) is wordmark, **account/Sign out**, nav links, but the DOM and Tab order is wordmark, nav links, Sign out. In the browser: `Settings (y=163) -> Sign out (y=119)` at 1024, 768, 390 and 320 px. WCAG 1.3.2 and 2.4.3 (Level A). Effect is one control reached later than it looks. | `OverviewScreen.module.css` `.wordmark/.navAccount/.navList` `order: 1/2/3`; DOM in `OverviewScreen.tsx:52-82` | CSS-12 (768 to 1199 px by CSS); browser (all four narrower widths). |

**Looked like defects and were not.** My Tab-order heuristic flagged 9 of the 55 browser runs. I reviewed every flagged step by hand. The only genuine mismatch is Settings to Sign out (D-U12), which accounts for 4 of those runs (1024, 768, 390, 320 px). The other flags are normal layouts: the left rail followed by the main column, a card grid read card by card, and the approval panel placed after the long plan on the right.

## 5. Evidence

```
docs/team/evidence/a11y/browser-results.json    56 browser runs: axe, sizes, Tab walk, focus indicators, titles, overflow
docs/team/evidence/a11y/jsdom-axe-results.json  axe per state (39), incomplete rules, titles, h1
docs/team/evidence/a11y/css-results.json        controls under 44 px, contrast pairs under their threshold, counts
```

## 6. Auth sweep and T-066

| Suite on current owner-auth (`2bfaa34` plus T-063) | Result |
|---|---|
| `routes-401` (every registered `/api` route, no session) | **7/7 pass** |
| 27 login scenarios (`auth.test`) | **37/37 pass** (27 isolated + 10 on `buildServer`) |
| Extra checks (`auth-extra`) | 17 pass, **5 `todo`** (one each for D-A1, D-A3 and D-A4, two for D-A3b; fail as expected) |
| Tests of the tests | 30/30 |

**T-066 has not landed.** The task board has it `todo`, and `integration/live-v1` holds only its docs. When it lands I will rerun these four suites, remove the `todo` markers, and expect the five to become guards. Command: `cd apps/api && pnpm exec tsx --test ../../tests/e2e/auth/{routes-401,auth,auth-extra,self-check}.test.mts`. A reminder for whoever reruns it after a merge: run `pnpm -r build` first. Three of my suites failed to load until I did (stale `@servrsit/ssh` build), which looked like a regression and was not.

## 7. My own mistakes in this round

1. **Every state "failed" on the first run.** My axe wrapper returned arrays from jsdom's realm, and `assert.deepEqual([], [])` rejects them. It looked like 38 defects; it was one harness bug. Fixed by copying results into the test's realm, and the positive control now guards against "clean because broken".
2. **My CSS engine skipped the token files and applied the mobile `:root` overrides at every width.** First numbers (510 of 600 controls "unresolved", 0 contrast pairs) were my bug. Fixed before any finding was drawn from them.
3. **I guessed D-U7 "no reduced-motion rules" before reading the tokens.** They collapse all durations to 1 ms and the components use them. I rewrote CSS-08 to test the real mechanism and dropped that defect. The ID was reused for the transcript ARIA issue.
4. **Over-strict checks that I corrected, not the product:** the outline check ignored `:focus-within` and `::after` replacements; ST-04 required a fixture label on the "API down" overview, which correctly shows no data.
5. **jsdom size estimates were wrong in both directions.** It said the scope select (28 px) and the checkbox rows (34 px) were problems; on touch the select is 44 and in the browser the rows are 39 only at one width. It also missed that the nav mismatch reaches 320 px. The browser measurements replace the estimates in D-U10 and D-U12.
6. I merged T-065 once, then found three more Designer commits had arrived (clock banner, new required `controlPlane` field in `/api/fleet`). My mocks were stale and the overview showed "unexpected format". I merged again, updated both mocks, and reran everything.
7. I forgot to rebuild after the first merge, so three auth suites failed to load for a few minutes (§6).

## 8. Recommendations

1. **Fix D-U1 and D-U9 first.** D-U1 is a small hook that sets `document.title` per screen. D-U9 is a one-token change.
2. Batch the Low items into one Designer pass: D-U2 skip link, D-U3/D-U4 describedby and disabled reasons, D-U5 focus on sign-out, D-U6 toggle, D-U7/D-U8 ARIA cleanups, D-U12 nav order (put the account block after the list in the DOM, or order it last).
3. **Decide on D-U10.** Giving the server-name link a stretched hit area, as the activity rows already have, would fix the most visible one. The brand and breadcrumb links need a min-height.
4. **Before calling it AA:** have a person do the §3 screen-reader pass on sign-in, setup and plan approval, on the owner's real phone.
5. Please add `tests/e2e/a11y` to CI once the Orchestrator decides where the tool folder installs. It needs only `pnpm install --ignore-workspace --frozen-lockfile` in that folder.
6. When T-066 lands, I rerun §6.

## 9. Files

```
tests/e2e/a11y/package.json, pnpm-lock.yaml     pinned axe-core, jsdom, postcss (standalone, not in the workspace)
tests/e2e/a11y/support/                          env (jsdom from the real index.html), render, api (fake API), states (39), axe, css (cascade engine), facts, css-hook
tests/e2e/a11y/control.test.mts                  1 positive control for axe
tests/e2e/a11y/axe.test.mts                      39 axe runs + reviewed-incomplete guard + known-violation todo
tests/e2e/a11y/css.test.mts                      15 checks (targets, contrast, boundaries, focus, motion, dark mode, forced colors, reflow, nav order)
tests/e2e/a11y/structure.test.mts                23 checks (landmarks, names, titles, skip link, errors, focus, toggle, QR, codes, transcript, live regions, source scan)
tests/e2e/a11y/browser/browser-check.mjs         real-Chromium pass (manual run; not part of pnpm test)
docs/team/evidence/a11y/*.json                   results
```

---

## Update after T-066 landed

T-066 (`41676cc`) is merged and re-tested: the 401 sweep is **7/7**, the 37 login scenarios pass, and the five former `todo` tests are guards. Full results are in `test-report-ai-auth-001.md` §10.

It adds one finding for this area: **D-U13 (Medium)**. The auth error contract gained `CLOCK_UNTRUSTED`, and the web app has no wording for it, so the web build fails to compile once T-065 and T-066 are merged (D-X1), and a bypassed build would show the owner the raw code. New guard: `ST-24` (`todo`). The a11y suite is now 120 tests: 105 pass, 15 `todo`, 0 fail.
