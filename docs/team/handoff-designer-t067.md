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

---

# Addendum 3: T-080 part 1, servers client (branch `feat/designer/t080`)
- The Connect flow now uses **Coder's real client** `apps/web/src/api/servers.ts` (not edited). `api/stubs/servers.ts` is gone. The in-memory model of the contract moved to `fixtures/serversFixture.ts` (same `ServersClient` interface, plus no-op `updateServer`/`disconnect`) and drives the preview at **`/fixtures/connect`** (shows the [FIXTURE DATA] banner; `?state=error` still works). `/servers/new` no longer shows a fixture banner and, after activation, links to the new server's page.
- `registrationError()` handles the client's new codes: TIMEOUT, CSRF_INVALID, UNAUTHENTICATED. A lost or unreadable answer on a state-changing call no longer says "Nothing was changed": it says the step may or may not have happened and to reload (the draft is resumed from the stored id).
- Checked against the real API on my own instance (:3005, own registry and auth databases): the screen's `POST /api/servers/drafts` carried the session CSRF header and the API's answer ("That address is not allowed. This private address is outside every route enrolled for ServrSit.") is shown. The later steps need a reachable SSH host, so they are covered by the fixture flow and Coder's client tests, not run against a real host.
- Tests: 182 web tests pass, build ok. Findings, Activity, Baselines and Settings keep their stubs until T-076 to T-079 land.

# Addendum 4: test-report-ui-a11y-002 fixes (branch `feat/designer/t080`)
| Defect | Fix | Commit |
|---|---|---|
| D-U16 (Medium) focus hidden under the sticky top nav at 768/1024 px | `html { scroll-padding-top: banner height + nav height + 8px }` (tokens.css); the Overview publishes the sticky nav's height as `--nav-h` (0 when the nav is not sticky). Reproduced before (7 hidden stops at 1024×768) and probed after at 768, 1024 and 390 px on the Overview cards and list, Activity and Settings: none hidden. | `D-U16` |
| D-U10 decision: stretched hit area | Server-name links are real 44 px boxes (inline padding on the clamped name, so the approved density is unchanged; 156×49 for a two-line name), plus the stretched `::after` over the whole card; the compact list and activity titles do the same. Article/heading semantics and the separate action button are unchanged: a click on blank card space opens the server, the action button goes to its own target. Audited every non-prose link on 8 screens at 1440 and 390: all at least 44 px. | `D-U10` |
| D-U14 `aria-label` on a span | Empty values: `aria-hidden` dash plus visually hidden "No value." | `D-U14` |
| D-U15 "Server not found" without `<h1>` | Already closed by the T-075 fix (page-level failures render their title as `<h1>`); verified in Chromium: h1 "Server not found". Evidence only. | `D-U15` |
Evidence: `docs/team/evidence/a11y-fixes/` (results and two screenshots). Not run: the Tester's own suite against this branch.

## Addendum 5: T-080 part 2 (findings and activity on Coder's real clients)

**Changed**
- `FindingsScreen` uses `api/findings.ts` (T-076). `ActivityScreen` uses `api/activity.ts` (T-077). Neither Coder file was edited.
- Stubs moved to `src/fixtures/findingsFixture.ts` and `activityFixture.ts`. They now implement the real client interfaces, including `pause`/`resume`/`scheduler` and `download`. Used only by the new routes `/fixtures/findings` and `/fixtures/activity`, which carry the `[FIXTURE DATA]` banner and the scheduler preview control.
- Findings: the banner shows when the API says `mode: "fixture"`. The external-alerts line is the API's own `externalAlerts.reason`. New scheduler line with Pause checks (when running) and Resume checks (when paused). A failed refresh after an action keeps the old list under a "may be out of date" notice.
- Activity: list loads with `limit: 1000`, shows a notice when `truncated`. Rows tagged "Simulated" when the API says so. Export download goes through `client.download` (a button, not a link), with EXPIRED / NOT_FOUND / TOO_LARGE wording and an "Available until" time on each export.
- Error wording: a lost or unreadable answer (NETWORK, TIMEOUT, INVALID_RESPONSE) never says "Nothing was changed". After a lost export answer the Recent exports list is reloaded.
- Baselines and settings stubs unchanged (T-078, T-079).

**Checks**
- `pnpm typecheck`, `pnpm test` (193 pass, 0 fail), `pnpm build`: clean.
- Browser, my own API (:3005, fixture fleet mode) and preview (:5174): `/findings`, `/activity`, `/fixtures/findings`, `/fixtures/activity`: axe wcag2a/aa/21aa 0 violations, no horizontal scroll, no console errors. Fixture export created and downloaded (`servrsit-activity-202611180805.txt`). Evidence: `docs/team/evidence/t080/`.
- After merging, `@servrsit/store` had to be rebuilt and the API needs `SERVRSIT_FINDINGS_DB`, `SERVRSIT_ACTIVITY_DB`, `SERVRSIT_SETTINGS_DB` paths to start in a sandbox.

**Not verified / gaps for Coder or Orchestrator**
1. In fixture fleet mode the real API reports the scheduler as `unavailable` ("Fixture mode: no checks run"), so Pause/Resume against the real API were not exercised. They are covered by the fixture client and tests only.
2. `GET /api/activity` has no `mode` field. In fixture mode it returns finding records with `serverName: "Removed server"` and `simulated: false`, so the real Activity page shows no fixture label and three identical server names in the filter. Request: add `mode: "live" | "fixture"` to `ActivityResponse` (as `FindingsResponse` has), and resolve names for fixture servers. The UI will show the banner from it once it exists.
3. Activity filters run in the browser over the loaded records (up to 1000). Server-side filters (`type`, `server`, `result`, `from`, `to`, `q`) are not used yet.

Next: T-078 (baselines), T-079 (settings).

## Addendum 6: T-080 part 3 (baselines on the real T-078 client)

**Merge:** `integration/next` merged into `feat/designer/t080` with no conflicts.

**Changed**
- `BaselineScreen` uses `api/baselines.ts` (T-078), no Coder file edited. The stub became `src/fixtures/baselinesFixture.ts`, implements the full real interface, and backs `/fixtures/baselines` (banner always on).
- The `[FIXTURE DATA]` banner also shows on `/baselines` when the API lists a simulated server; those servers carry a "Simulated" tag.
- Step 2 shows the inventory source, its age and the API's own notes ("Not everything could be read"). The comparison shows source and observation time.
- Setup scope follows the contract: only missing directories (`actionable`) are planned. Missing packages appear under "Missing, not included" with the reason that no operation installs packages yet. The old "Ubuntu packages to install" list is gone.
- Name validation uses the contract's `BASELINE_NAME`. A never-observed server reads "Never observed by ServrSit. ServrSit has no facts about this machine yet."
- Error wording from `baselineErrorText`: `STALE_CANDIDATES` tells the owner to read the reference again; lost answers say the step may or may not have happened.

**Checks**
- `pnpm typecheck`, `pnpm test` (199 pass, 0 fail), `pnpm build`: clean.
- Browser on my own API (:3005, fixture fleet) and preview (:5174): real step 1 and the real "could not read the server" answer (503 UNAVAILABLE, "Fixture mode: no server is inspected") display correctly. The full fixture flow (reference, conventions, save, compare, review plan) ran on `/fixtures/baselines`. axe wcag2a/aa/21aa: 0 violations on all four states. Evidence: `docs/team/evidence/t080/baselines-*`.

**Not verified**
- Steps 2 to 4 against the real API: fixture fleet mode refuses inventory (503), so save, compare, mark intentional and setup plan are covered by the fixture client and `api/baselines.test.ts` only.
- A real setup plan opens `/plans/:planId`, but Plan review still runs on the care stub (`api/stubs/care.ts`); there is no real care client in `apps/web/src/api/`. Until Coder provides one, a real plan id will show "not found" there. Please confirm which task adds it.

**Settings (T-079):** `apps/web/src/api/settings.ts` is not on `integration/next` yet, so the settings stub stays.
