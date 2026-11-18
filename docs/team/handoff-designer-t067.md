# Handoff: Designer T-067 and T-068 (branch feat/designer/t067)

## T-067 Server detail (UX-05, `/servers/:id`), live `/api/fleet` data
**Files:** `apps/web/src/servers/` (`ServerDetailScreen.tsx`, `serverDetailViewModel.ts` + test, `servers.module.css`), `lib/router.ts` (+test: `/servers/:id`, `/servers/:id/settings|verify`, `/servers/new`), `App.tsx`, `components/overview/fleetViewModel.ts` (exports `toServerCard` so card and detail agree). Commit `0f10168`.

**What it shows**
- Name row: pixel icon (identity colour), pixel name, role, Production label, access chip ("Read-only · SSH"), status badge, freshness, coverage ("16 of 16 checks ran"), plus "ServrSit can look at this server. It cannot change anything on it yet." Latest-failure, historical-data, refresh-failed and host-key notices appear when relevant.
- **Status:** findings first (sorted critical, needs attention, advisory); "No findings from the 16 of 16 checks that ran" (never a bare all-clear); checks passed with each unavailable check and its reason; resources with units and the sample time (CPU load on N CPUs, memory used/total/available, swap, per-mount space and inodes with a text figure and a bar); system (platform, architecture, uptime, boot id first 8, server clock skew note, failed services, important services each "No failure reported" or "Failed").
- **Care:** pending updates; package-information age with a caveat when the server's clock was corrected or unverified; Ubuntu and "from other sources" counted separately with the outside packages listed (named, with origin) and a note they're left out of plans by default; held back; reboot (flag value or reason); baseline and recent operations as em dashes with a reason; **Review updates disabled** with "Changes are switched off for this server until testing on a disposable server is complete."
- **Settings (read-only):** name, role, classification, address, key in use, access, important services. Address and key show an em dash with "The API does not send/say … yet". The key line will only ever read "dedicated ServrSit key" or "owner key" once the API provides it; no path is shown and a test asserts none appears.
- Empty data is "—" plus the reason, never zero. When there is no observation, Status/Care collapse to one explanation instead of repeating it per row. ServrSit's untrusted clock marks ages with ≈.
- Links: cards already link to `/servers/:id` (name and action buttons); status actions `/verify` and `/settings` land on the same page.

## T-068 Connect a server (UX-03, `/servers/new`)
**Files:** `apps/web/src/connect/` (`ConnectScreen.tsx`, `connectLogic.ts` + test), `apps/web/src/api/stubs/servers.ts` ([FIXTURE] stub, **Coder please replace**; proposed endpoints are listed at the top of the file), `OverviewScreen` ("Connect a server" link).
1. **Meet the server:** name, address, port (default 22), SSH user, purpose, Production / Non-production / Not sure. Not sure is treated as production with a stated reason; the name never decides it. Validation refuses schemes, `user@`, shell characters, leading dashes, paths, loopback, unspecified, link-local (incl. 169.254.169.254), multicast and localhost names; allows private/CGNAT; ports 22 or 1024–65535. A duplicate address+port opens the existing record. An unreachable private address says "ServrSit cannot reach this private address yet" with route guidance and "Check again".
2. **Set up access:** Inspect only (default). "Enable approved maintenance" and "Allow package-list refresh" are shown as not available yet. Server-console steps and the `restrict,from="…" ssh-ed25519 …` line with Copy. Network path and SSH authentication are explained as separate. **No private key or password field exists** (checked: 0 password/file inputs).
3. **Verify identity:** the owner enters the fingerprint from the server's own console first (`ssh-keygen -lf …`); only then ServrSit fetches and shows what it sees and compares. Mismatch blocks with "Do not continue". Match still needs the "I got this from an independent source" checkbox. There is deliberately no Copy button on the displayed fingerprint.
4. **First check:** explicit "Run the first check", step list with text states (Done / In progress / Not available), no percentages, partial result ("Partly checked: 4 of 5 checks ran", usable results kept), schedule choice, and a "[FIXTURE] Nothing was saved" notice. The whole flow shows [FIXTURE DATA].
Back works on every step and clears later-step state (entered fingerprint, trust, check). Draft: whitelist of non-secret fields in localStorage; never resumes past step 2; never restores maintenance.

## Checks run (real output)
- `pnpm --filter @servrsit/web test`: **121 pass, 0 fail** (was 101). `typecheck` clean, `build` ok.
- Browser (Playwright) against my own API on 127.0.0.1:3005 and preview on 127.0.0.1:5174, signed in through the real setup flow. Detail pages used synthetic servers injected into the `/api/fleet` response (labelled fixture in the files). Both panes closed; ports refuse connections now. Never used :3001 for tests (one read-only GET of its response shape before building).
- Detail: 3 servers x desktop/390px, no horizontal overflow, Review updates disabled on all, unknown id → "Server not found".
- Connect flow x desktop/390px: errors shown for empty form; 169.254.169.254 refused; unreachable and duplicate paths; draft saved with only whitelisted fields; no secret inputs; mismatch and unticked ack keep Trust disabled; fingerprint cleared after Back; first check runs to "Partly checked"; no `%` text; Overview shows the Connect link. No overflow on any screen.
- Screenshots: `docs/team/evidence/t067/` (22 PNGs).

## Gaps and requests
- **API fields missing for Settings:** address and which key is in use (as "dedicated ServrSit key" / "owner key"). Detail shows em dashes meanwhile.
- **Needed from Coder for T-068:** the endpoints sketched in `api/stubs/servers.ts` (precheck incl. duplicate and reachability, access info, host-key fetch, create, first-check). Real clients must refuse the first check unless the fingerprint was confirmed.
- No operation history or baseline data from the API, so those rows are em dashes.
- Ports: the UI accepts 22 or 1024–65535 (my reading of "unapproved ports"); confirm the approved set.
- Statuses that link to `/servers/:id/verify` have no real verification yet (only inside the new-server flow).
- Last screenshot of the no-data page was regenerated after the final change but my image viewer showed a cached copy; the file size dropped (171 KB → 107 KB) as expected. Re-check it if it matters.
- Fixture banner "Clock not checked" appears in my fixture-mode API; in live mode it follows the real clock state.

## Next
Orchestrator: merge `feat/designer/t067`. Coder: address/key fields in `/api/fleet`, the servers endpoints, then swap the stub.

---

# Addendum 2: contract alignment, T-070, T-071, T-072 (same branch, `feat/designer/t067`)

## T-068 aligned to the T-069 contract (`e2a8631`)
- `api/stubs/servers.ts` now imports every type and schema from `@servrsit/contracts` (`ServerDraft`, `ServerDraftRequest`, `HostKey`, `FirstCheck`, `ActivateResponse`, `ServerRegistrationError`, …). No local copies. It holds the real HTTP client `createServersClient()` (the contract's routes, session CSRF header from `api/auth.ts`, responses parsed with the contract schemas) and `createFixtureServersClient()`, an in-memory model of the contract's state machine and error codes. The screen uses the fixture until the routes exist; switching is one line in `ConnectScreen` (`createFixtureServersClient()` → `createServersClient()`).
- **Step order changed to the contract's:** Meet the server, **Verify identity**, **Set up access**, First check. The contract enforces host key → owner confirms fingerprint → access key (STATE_CONFLICT otherwise), so the dedicated key line can only be shown after the owner has confirmed the fingerprint. **UX Spec §7.3 lists access before identity: Orchestrator, please log the deviation.** The independent-fingerprint-first interaction is kept (owner types theirs, then ServrSit scans and compares, then `host-key/confirm` with the scanned value).
- Form maps to the contract: `purpose` became the optional `role`; classification becomes `production: boolean` (Not sure is sent as production); name, user and role validated with the contract's own regexes (`SERVER_DISPLAY_NAME`, `SSH_USER`, `SERVER_ROLE`, `SSH_FINGERPRINT`). The draft now lives on the server (24 h, no secret); the browser stores only the whitelisted form fields and the draft id (a UUID), and resumes by `GET draft`.
- Contract error codes all have fixed wording; the first-check `failureCode`s too. Activate is refused while `duplicateOf` is set.
- Tests: `stubs/servers.test.ts` checks that every fixture response parses with the contract schemas and that out-of-order calls give the contract's codes.

## T-070 Findings UI (`/findings`) (commit "T-070")
- `api/stubs/findings.ts` ([FIXTURE], provisional local types because no findings-state contract exists; proposed endpoints and rules are in the file header for Coder). `findings/` holds the view model, `FindingsScreen`, `SchedulerNotice`.
- States New / Acknowledged / Snoozed / Resolved / "Previously detected, not rechecked", each with a sentence on what it does not mean ("Acknowledged is not resolved…", "Snoozing only delays notifications. It is not resolved…"). Resolved shows the observation that established recovery. First and last observed times in the owner zone with ages. **Acknowledge** and **Snooze (1 hour / 1 day / 1 week)** are separate controls with separate availability. Stage A statement that external alerts are unavailable.
- Scheduler notices "Checks paused", "Check delayed", "Scheduler unavailable" (never an all-clear). On the **real Overview** only "Check delayed" is shown, derived from the live `nextCheckAt` being more than 2 minutes overdue (tested). Paused and unavailable need the findings API and are previewed on `/findings` with a clearly labelled fixture control.
- Not linked from the live Overview (its data is fixture); open `/findings` directly.

## T-071 Activity page (`/activity`) (commit "T-071")
- `api/stubs/activity.ts` ([FIXTURE], provisional; proposed endpoints in the header). Filters: server, result, period, type (default operations + findings; routine checks one checkbox away). Search matches server name, title and id only (never summaries). Operation results use UX §11 wording. Day groups (Today / Yesterday / date) in the owner zone, ≈ ages when ServrSit's clock is untrusted.
- Export: choose report or JSON, the page states count, date range, time zone and the redaction statement before and after. The result is a **persistent panel** with a Download link plus a "Recent exports" list (kept in sessionStorage in the fixture, so it survives reload; the real API should list exports). Whole-row link hit areas (stretched) for the record titles.

## T-072 accessibility defects D-U1 to D-U12 (commit per group)
| ID | Fix | Commit group |
|---|---|---|
| D-U1 | `lib/pageTitle.ts`: every screen and state sets a descriptive title ("Plan review: Update packages on Nabire · ServrSit", "Sign in: enter your code", "Connect a server: step 2 of 4, Verify identity" …); `RouteAnnouncer` says "Navigated to …" on later changes; loading placeholders are silent. `index.html` title is just "ServrSit". | `9defb25` |
| D-U9 | `.sPending` text uses Muted ink (measured 6.39:1 on white), not the control-boundary grey. | D-U9/10/11 |
| D-U10 | Brand and breadcrumb links 44 px (measured 44); server-name link has a stretched hit area over the card (action button above it); acknowledgement rows min-height 44. | same |
| D-U11 | `forced-colors: active` rules for the password meter, storage bar, stepper, step connectors, tags, primary button, checked rows. Not rendered in forced-colors emulation (see gaps). | same |
| D-U2 | `SkipLink` is the first Tab stop on every page and moves focus to `<main id="main-content" tabIndex=-1>` (verified: first Tab = "Skip to main content", Enter → MAIN). Overview main has the same id. | D-U2/8/12 |
| D-U8 | `aria-label` removed from the brand `<p>`. | same |
| D-U12 | Overview nav: DOM order = visual order (wordmark, account/Sign out, nav list); all `order:` rules removed. The desktop rail now has Sign out directly under the wordmark. Verified Tab order: Sign out, Overview, Activity, Settings. | same |
| D-U3 | Sign-in and setup errors have ids; the fields point to them with `aria-describedby`, and the right field gets `aria-invalid`. | D-U3…7 |
| D-U4 | `ReasonButton`: unusable buttons use `aria-disabled` (stay focusable), ignore the click, and show the reason as text tied by `aria-describedby`. Applied to sign-in (3 steps), setup (3 buttons), plan approval, and the Connect flow's Compare, Trust and Continue. Reasons are pure functions with tests. | same |
| D-U5 | After sign-out or an ended session the heading takes focus. Also fixed a StrictMode quirk that focused the heading on a cold dev load. | same |
| D-U6 | Show/Hide password: constant accessible name "Show password" with `aria-pressed` (visible text "Show" is contained in the name). | same |
| D-U7 | Transcript: `role="log"` on a `div`, the `ul` inside keeps list semantics. | same |

Same fixes applied to the new screens (titles, reasons, 44 px targets, stretched links). Also fixed along the way: a stale `alive` ref in the Connect screen that stopped the first check polling under StrictMode, and the new `CLOCK_UNTRUSTED` auth error wording from T-066.

## Checks run (real output)
- `pnpm --filter @servrsit/web test`: **151 pass, 0 fail** (121 before). `typecheck` clean, `build` ok.
- Browser (Playwright, own API :3005 and preview :5174, both closed afterwards): axe-core 4.14.1 (loaded from the Tester's tool folder, read only) with WCAG 2.0/2.1/2.2 A/AA and best-practice rules, run on 11 states (sign-in, sign-in with error, setup authenticator, Overview, plan, operation, operation with transcript open, findings, activity, connect, clock fixtures): **0 violations in all 11**. Titles verified per route; skip link, Tab order, disabled-reason text, toggle name, error `aria-describedby`, sign-out focus (H1), brand and breadcrumb heights (44), pending-step contrast 6.39 all checked in `docs/team/evidence/t072/browser-check.txt`. No horizontal overflow on any screen at 1280 and 390 px.
- Connect flow end to end in the contract's order (create draft, scan, compare, confirm, access key, first check, activate) at both widths; Findings acknowledge → snooze → scheduler states; Activity search, filter, export, download, reload keeps "Recent exports".
- Screenshots: `docs/team/evidence/t067/` (connect flow), `t071/` (findings, activity), `t072/` (skip link, browser check).

## Gaps
- **Not run (as in the Tester's list):** screen reader, real phone, forced-colors rendering (rules written from the CSS only), reduced-motion emulation, Firefox/Safari. The Tester's own suite (`tests/e2e/a11y`) was not run against this branch; please rerun it, which should turn the 14 `todo` items into guards.
- Findings and Activity run on fixtures until Coder provides contracts and endpoints; `/findings` is not linked from the live Overview.
- D-U10: inline links inside sentences keep their text-height targets (allowed by WCAG 2.5.8; not changed).
- The Overview page title reads "Loading your servers" until the first fleet response arrives, then "Overview".
