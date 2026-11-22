# ServrSit — UI/UX handoff for Monty (current working app)

Prepared by Kiro Orchestrator, 22 Nov 2026. Describes the app **as it runs today** on branch `integration/live-v1` (= `main`). Where the running app, the source and the earlier specs differ, the difference is stated and the verified behaviour named.

**Evidence labels used below**

| Label | Meaning |
|---|---|
| **Verified (live)** | Used by the founder in the running app on his real servers, or checked by Orchestrator against the running app. |
| **Verified (browser, fixture)** | Exercised by the Tester or Designer in a real browser against a fixture-mode copy of the app. |
| **Present in source** | Built and unit-tested, not yet exercised end to end in a browser. |
| **Fixture data** | Screen or state only reachable with sample data today. |
| **Planned** | Specified, not built. |

All screenshots use fixture data from a throwaway copy of the app. No live servers, accounts or credentials appear in them.

---

## 1. Where the project stands

### Product in one paragraph

ServrSit is a caretaker for a small fleet (2–20) of Ubuntu servers, for an owner who needs servers but does not want to administer them. Its loop is **inspect → explain → propose → approve → execute → verify**. It runs read-only checks over SSH, shows each server's condition with honest freshness, answers questions in a chat surface grounded in those checks, turns maintenance into a reviewable plan, applies only an approved plan through a small restricted helper on the server, and verifies the result independently.

### What a user can do today

| Capability | Status |
|---|---|
| Sign in with password + authenticator app (first-run enrolment with a setup token, recovery codes) | Verified (live) |
| See four real servers on the Overview with live check data, freshness, findings and recent activity | Verified (live) |
| Ask the assistant about the fleet; answers are fact-checked against the data and can never change anything | Verified (live) |
| Open a server's detail page: status, care (pending updates, reboot), read-only settings | Verified (live) |
| Connect a new server (4-step flow incl. owner-verified host fingerprint and an issued SSH key line) | Verified (live), done for Sentani |
| Review a package-update plan, approve it, watch the operation, read the receipt | Verified (live), Sentani only, once (12 packages, succeeded and independently verified) |
| Findings (acknowledge, snooze), Activity (filters, search, export), Baselines, Settings | Present in source + Verified (browser, fixture); real APIs exist; not yet used by the founder |
| Service restart, reboot, directory preparation | Present in source (API + helper), **refused** in the app for now |
| Changes on Nabire, Timika, Merauke | Blocked by design (writes enabled for Sentani only) |

### Repository state at pause

- **Repo:** github.com/spotty21201/servrsit (private). Default branch `main` = `integration/live-v1`.
- **Commit at pause:** see the commit that adds this file (`git log -1 docs/team/handoff-monty.md`). All five working copies were clean at pause; nothing uncommitted.
- **Running locally (Merauke):** web on `http://100.104.220.8:5173` (Vite dev, Tailscale-only), API on `127.0.0.1:3001`. Dev processes; they do not restart after a reboot.

### What each agent was doing when paused

| Agent | Last work | Stopped at |
|---|---|---|
| Coder | T-094: receipt gaps (reboot evidence, "services that may need a restart", services restarted by the package itself) | Contract only, WIP commit `ba169a6` on `feat/coder/t094-receipts`; not merged |
| Designer | T-093 Review-updates button (merged); then this handoff's screenshots | Docs-only branch `feat/designer/handoff-monty` |
| Tester | Sentani end-to-end tests of the write path | Final; reports on `feat/tester/sentani` |

### Next intended task and open decisions

- **Next intended:** the Server Sitter theme (this spec), then T-094 receipt improvements.
- **Open product/design decisions:** see section 5 "Unresolved decisions". The largest: one navigation shell for every screen; how the theme's character speaks (the voice rule is "plain by default, light cheek only in routine good news" — ADR-015); whether chat may hand the user a plan card (FR-07 gap).

---

## 2. What the user sees and does

### Screens and routes

Routing is a small custom router (`apps/web/src/lib/router.ts`). **Every route is behind sign-in** (`AuthGate` in `apps/web/src/App.tsx`), including the `/fixtures/*` sample routes.

| Route | Screen (source) | Purpose | Main components | Primary actions → destination | Status |
|---|---|---|---|---|---|
| `/` or `/overview` | Overview (`components/overview/OverviewScreen.tsx`) | Fleet at a glance, no page scroll on desktop | Left nav rail, "Your servers" title + counts, server cards (4-col grid ≥1280 px) or compact list, Needs attention list, Recent activity list, Ask ServrSit chat bar | View server → `/servers/:id`; Connect a server → `/servers/new`; card action (Check connection / Verify host key / Fix access) → server page or settings; finding row → server page; Ask → answer panel in place | Verified (live) |
| `/servers/:id` (`#server-status`, `#server-care`, `#server-settings`) | Server detail (`servers/ServerDetailScreen.tsx`) | One server in depth | Name row with pixel icon, role, production label, access level; "On this page" jump links; Status (findings, coverage, metrics), Care (pending updates, origins, held back, reboot, baseline link, recent operations), Settings (read-only) | Review updates → creates a plan → `/plans/:id`; Compare with a baseline → `/baselines` | Verified (live) |
| `/servers/new` | Connect a server (`connect/ConnectScreen.tsx`) | Add a server | 4-step stepper: Meet the server → Set up access → Verify identity → First check | Continue / Back; I added the key. Continue; on success → the new server's page | Verified (live) |
| `/plans/:id` | Plan review (`care/PlanScreen.tsx`) | The single review-and-approve surface | Target header with chips (Production, status), Scope, Impact, Preconditions, Verification + "What this cannot establish", Approval panel (expiry, acknowledgements, specific approve button), Technical details | Approve update on {server} → `/operations/:id`; Refresh plan (when expired/changed) | Verified (live) |
| `/operations/:id` | Operation detail (`care/OperationScreen.tsx`) | Follow and record one operation | State headline, vertical step list with real times, Receipt (What changed / What was verified / Still needed / Could not verify), dark read-only Transcript | Stop after this safe step; Recheck outcome (when unknown) | Verified (live) for succeeded; other states fixture |
| `/findings` | Findings (`findings/FindingsScreen.tsx`) | All findings, scheduler status | Finding rows with state, first/last observed, evidence; scheduler notice | Acknowledge; Snooze 1 h / 1 day / 1 week | Verified (browser, fixture) |
| `/activity` | Activity (`activity/ActivityScreen.tsx`) | History of checks and operations | Filters (server, result, period, type), search, list, export | Open record; Export → persistent download | Verified (browser, fixture) |
| `/baselines` | Baselines (`baselines/BaselineScreen.tsx`) | Compare servers to an owner baseline, prepare a server | Choose reference → select conventions → compare → review plan; states Matches / Missing / Different by design / Conflict / Not checked | Save baseline; Mark intentional; Review setup plan → plan (blocked for real hosts) | Verified (browser, fixture) |
| `/settings` | Settings (`settings/SettingsScreen.tsx`) | Owner-level settings | Jump links: Schedules, AI and data, Access; disconnect flow | Save schedule, pause checks, AI on/off, disconnect a server | Verified (browser, fixture) |
| Sign-in / setup (no route; shown by `AuthGate`) | `auth/SignInScreen.tsx`, `auth/SetupScreen.tsx` | Authentication | Password step, code step, recovery-code link; first-run: setup token → password → authenticator QR → recovery codes | Sign in; Use a recovery code | Verified (live) |
| `/fixtures/overview`, `/fixtures/connect`, `/fixtures/findings`, `/fixtures/activity`, `/fixtures/baselines`, `/fixtures/settings`, `/fixtures/clock`, and plan/operation ids starting `fixture-` | Sample-data versions | Design and test states the live data cannot produce | Same screens, `[FIXTURE DATA]` banner | — | Fixture data |

**Navigation.** Only the Overview has the left rail (Overview, Activity, Settings, Sign out). Every other screen uses `care/CareShell.tsx`: a top bar with the pixel "ServrSit" wordmark (links to Overview), a breadcrumb, and Sign out. **Findings and Baselines are not in any navigation**; they are reached from in-page links (Needs attention, server detail).

### Key flows

**A. First connection** — Verified (live) on Sentani, including two real failures that the flow did not explain well (T-085, T-086).

1. Overview empty state: "Let's meet your first server." + "Connect a supported Ubuntu server to check its condition and review care tasks." → **Connect a server**.
2. *Meet the server*: name, address, port (22), user, purpose, "Is it production?" (yes / no / not sure; not sure is treated as production).
3. *Set up access*: choose **Inspect only** ("Read facts about the machine: load, memory, storage, services, pending updates. Changes nothing.") — "Enable approved maintenance (not available yet)" is shown disabled. ServrSit generates a dedicated key and shows one line to append ("Add ServrSit's public key on the server", "Copy the line", "I added the key. Continue").
4. *Verify identity*: shows the host fingerprint; the owner must confirm it matches a value obtained independently ("I got my fingerprint from the server's own console or another independent source, not from this page."); mismatch shows "Does not match. Do not continue."
5. *First check*: step list ("Checking… no percentage is shown because the time left is not known."), then the server appears on the Overview.

Friction seen live: a generic "That address is not allowed…" when the Tailscale range was not enabled, and "Could not complete" when Tailscale SSH intercepted the login. Both needed Orchestrator diagnosis.

**B. Daily monitoring** — Verified (live).

Overview loads cached data and polls every 30 s; relative ages tick every 30 s. Each card shows: pixel server icon (identity colour), name, role, data-source badge (LIVE / FIXTURE / none), one status badge, the most useful finding or result, "Observed … ago · fresh until …", one action button. Needs attention lists open findings; Recent activity lists operations. A failed latest check shows alongside the last success, marked "Historical".

**C. Investigating a finding** — Verified (live) for reading; acknowledge/snooze Verified (browser, fixture).

Finding row on Overview → server detail Status section (finding, evidence, times) or `/findings`. Acknowledge records "seen" (not resolved); Snooze delays it; "Previously detected, not rechecked" appears when the server could not be rechecked. The assistant can explain a finding; its answer lists the servers and observation times it used.

**D. Maintenance: plan → approve → operation → receipt** — Verified (live) once on Sentani (12 packages).

Server detail → Care → **Review updates** ("Opens a plan to review. Nothing is changed until you approve one.") → plan page → **Approve update on Sentani** ("Submitting approval", then "Checking whether this started" if the reply is lost) → operation page: steps *Approved by you → Send to Sentani → Install packages → Check installed versions → Result recorded*, state **Completed and verified**, receipt, 12-event transcript. Two bugs were found and fixed in this flow during the founder's first run: the button was hard-wired disabled, and approval failed silently over plain HTTP (crypto.randomUUID).

**E. Asking the assistant** — Verified (live).

The Ask ServrSit bar (bottom of Overview; 3 lines; scope chip "All servers") answers in a panel above it, labelled AI or Deterministic, with "Based on" evidence and a fixed notice ("AI-generated explanation of the latest checks. It is not evidence and cannot change or approve anything."). Change requests ("yes, update Nabire") get a fixed non-AI reply that changes go through a reviewed plan. Pasted secrets are refused without being sent.

### Mobile

- Breakpoints (from `apps/web/src/**/*.css`): ≤ 479 px, ≤ 767 px (phone), 768–1023 px (tablet), ≥ 1024 px, ≥ 1200 px with height ≥ 620 px (desktop no-scroll layout).
- Phone: single column; cards smaller (16 px pixel names); Needs attention and Recent activity stack below the cards; the rail becomes a top row; chat bar stays at the bottom in document flow (respects the safe area); page is anchored (no horizontal drift — fixed after founder testing on a Xiaomi 14T, Verified (live)).
- Plan review and operation pages stack their columns; the approve panel follows the content.

### Meaningful states

| State | How it looks today | Status |
|---|---|---|
| Empty fleet | "Let's meet your first server." + one action; attention: "No server is connected, so nothing has been checked yet." | Fixture data |
| Fresh and clear | Badge "All checks passed"; attention: "Nothing needs attention in the checks that ran." (no fleet-wide "all clear") | Verified (live) |
| Stale | Badge "Check overdue"; ages marked | Fixture data |
| Partial | Badge "Partially checked", with which checks were unavailable | Fixture data |
| Unreachable | Badge "Unreachable from ServrSit", last success shown as "Historical", action "Check connection" | Fixture data |
| Host key | "Host key not verified" (never contacted) / "Host key changed" (blocks everything) | Verified (live) for not verified; changed is fixture |
| Clock untrusted | Persistent banner "ServrSit can't confirm its own clock is right" with the reason; ages marked uncertain; approvals paused ("Approvals are paused") | Verified (browser, fixture). The live app detected the real incident in its API, but this banner was merged after the clock was fixed |
| Writes switched off | Plan shows "Changes are switched off" with a lock and no approve button | Verified by the Tester through the real API for Nabire/Timika/Merauke (own instance, not the founder's screen) |
| Pending approval | Plan "Ready to review", expiry in owner time zone + relative (format "Valid until HH:MM WIB (in N min)") | Verified (live) |
| Expired / changed plan | Approval disabled, reason, "Refresh plan" | Fixture data |
| Running | "Working on {server}", current step, no invented percentage | Verified (live) |
| Outcome unknown | "Result not yet confirmed"; conflicting changes blocked; "Recheck outcome" | Fixture data (proven at helper level on Sentani) |
| API unreachable | "Couldn't load your servers." / "Couldn't refresh." with last data kept | Present in source (the founder saw the whole app down after a reboot, not this message) |

---

## 3. What the interface looks and sounds like today

### Layout

Desktop overview fits one 1440 × 900 window without page scroll: rail (88 px) | content (max ~1320 px). Order top to bottom: title row ("Your servers", counts, "Connect a server") → 4-column card grid → two columns (Needs attention | Recent activity, each scrolling inside itself) → narrow 3-line chat bar. Density is deliberately tight (founder rounds 3–7): body line-height 1.3, titles ≤ 1.1, 4/8/12 px gaps.

### Tokens and sources

| Area | Source | Values (deliberate unless noted) |
|---|---|---|
| Colour tokens | `packages/ui/src/tokens/colors.css` | `--color-page #FFFFFF` (founder: white), `--color-surface #FFFFFF`, `--color-ink #1D2532`, `--color-muted-ink #56606C`, `--color-tangerine #FF7648` (primary action, Ink text), `--color-lilac #C9B8FF`, `--color-citron #D7EF52`, `--color-bubblegum #FFA3D7` (identity accents only), `--color-soft-line #DDDCD6`, `--color-control-boundary #7B8490`, `--color-focus #5141C6`. `--color-canvas #F6F4EE` remains defined but is no longer the page background (provisional leftover). |
| Semantic states | same file | passed `#185C44`/`#DDF5E7`, attention `#794A00`/`#FFF0CE`, failed `#A32F2B`/`#FDE7E5`, unknown `#4D5663`/`#E7EBF0`, progress `#344FA3`/`#E7ECFF` (each pair ≥ 4.5:1). |
| Typography | `packages/ui/src/tokens/typography.css`, `apps/web/src/fonts.css`, overrides in `apps/web/src/tokens.css` | `--font-pixel` **Silkscreen** for page titles and server names (founder choice), `--font-sans` **Geist**, `--font-mono` **Geist Mono**; weights 400/500/600. `--font-display` (Bricolage Grotesque) is still named in the stack but **no Bricolage files ship** (provisional leftover). Pixel sizes kept at 8 px multiples (24 / 16). |
| Spacing, radii, motion | `packages/ui/src/tokens/spacing.css`, density overrides in `apps/web/src/tokens.css` | 8 px rhythm; `--duration-interaction 120ms`, `--duration-panel-open 200ms`, `--duration-state-change 175ms`; all collapse to 1 ms under `prefers-reduced-motion`. Card radius ~20 px, panels 16 px, inputs/buttons 10–12 px. |
| Icons | `components/server-card/PixelServerIcon.tsx`, `components/StatusBadge/StatusBadge.tsx` | Pixel-art server icon, inline SVG, `crispEdges`, colour = identity (never health). Status badges: icon + text. Some screens also use small hand-drawn stroke SVGs. |
| Imagery | — | None beyond the pixel server icons and coloured card offset shadows. No mascot or character exists yet. |
| Motion | as above | Minimal: hover/focus, panel open, status changes. No celebratory animation. |

**Deliberate (founder decisions, ADR-011 and UX feedback rounds 1–7):** white page, pixel titles and server names, pixel server icons, no large briefing headline, cards first and chat at the bottom, 4-column grid, no page scroll on desktop, tight density, 3-line chat bar. **Provisional:** unused Canvas and Bricolage tokens, mixed icon styles, two navigation shells, many screens never reviewed by the founder (findings, activity, baselines, settings, operation states beyond succeeded).

### Voice

Rule (ADR-015): plain English by default; a light cheeky touch only in routine good-news moments; never cheeky about failures, outages, security or client-facing impact. In practice, today's UI copy is almost entirely plain; the cheek mostly appears in AI answers.

Current copy, quoted:

- **Overview:** title "Your servers"; empty "Let's meet your first server." / "Connect a supported Ubuntu server to check its condition and review care tasks."; attention empty "Nothing needs attention in the checks that ran."; errors "Couldn't load your servers." / "Couldn't refresh."; "Refreshing…"; card actions "View server", "Check connection", "Verify host key", "Review host key", "Fix access", "View settings".
- **Card status labels:** "All checks passed", "Needs attention", "Critical issue", "Partially checked", "Check overdue", "Unreachable from ServrSit", "Not checked yet", "Host key not verified", "Host key changed", "Access denied", "Checks switched off", "Configuration rejected".
- **Onboarding:** see flow A quotes; also "ServrSit cannot reach this private address yet", "Reachability here only checks the network path. Signing in is tested separately later."
- **Banners:** "[FIXTURE DATA] Synthetic data only — not connected to any real server"; clock: "ServrSit can't confirm its own clock is right", "ServrSit is not checking its own clock in this mode, so ages and expiry times are not confirmed."
- **Plan:** "Approve update on Sentani"; "Changes are switched off for this server until testing on a disposable server is complete." (now outdated for Sentani — see section 5); "ServrSit's own clock is wrong, so expiry times can't be trusted. Approvals are paused until it is fixed."
- **Operation states:** "Waiting to start", "Working on {server}", "Checking the result", "Completed and verified", "Completed and verified. Reboot still needed.", "Some work completed", "Could not complete", "Cancelled — no work started", "Result not yet confirmed"; controls "Stop after this safe step", "Recheck outcome".
- **Findings:** "New", "Acknowledged", "Snoozed", "Resolved", "Previously detected, not rechecked".
- **Sign-in errors:** "That username and password don't match. Check both and try again."; "That code didn't work. Codes change every 30 seconds, and each can be used once. Check your device's clock, or use a recovery code."; "Too many failed attempts. Try again in … (at …)."
- **Assistant:** label "Ask ServrSit"; placeholder "What needs attention? Explain Nabire's updates…"; hint "Enter to send · Shift+Enter for a new line"; "Sending…"; errors "ServrSit couldn't answer that. Your question is kept; try again." / "ServrSit couldn't be reached. Your question is kept; try again."; answer labels "AI" / "Deterministic", "Based on", "Scope: All servers". Example real answer (live, AI): "Nabire and Sentani have pending updates; Timika and Merauke show none. … ServrSit doesn't refresh package lists itself, so these counts are only as fresh as those times."

---

## 4. Screenshots of the working app

Images: `docs/team/handoff-monty/` (index with route, viewport and state per image: `docs/team/handoff-monty/index.md`). All fixture data, captured in a real browser from a throwaway fixture-mode copy of the app. Open on GitHub: `https://github.com/spotty21201/servrsit/tree/main/docs/team/handoff-monty` (private repository: Monty needs read access, or the founder can forward the images).

| Image | Route | Viewport | State (all fixture data) |
|---|---|---|---|
| [01-sign-in-first-run-1440x900.png](handoff-monty/01-sign-in-first-run-1440x900.png) | `/ (signed out, no owner yet)` | 1440x900 | Sign-in screen with the first-time setup link |
| [02-sign-in-first-run-390x844.png](handoff-monty/02-sign-in-first-run-390x844.png) | `/ (signed out, no owner yet)` | 390x844 | Sign-in screen with the first-time setup link |
| [03-overview-1440x900.png](handoff-monty/03-overview-1440x900.png) | `/` | 1440x900 | Overview, normal fixture fleet: four server cards (fresh, partly checked, unreachable, host key not verified), Needs attention, Recent activity, Ask bar |
| [04-overview-390x844.png](handoff-monty/04-overview-390x844.png) | `/` | 390x844 | Overview on a phone, same fleet Whole page shown (2043px tall). |
| [05-server-detail-fresh-1440x900.png](handoff-monty/05-server-detail-fresh-1440x900.png) | `/servers/00000000-0000-4000-8000-0000000000a1` | 1440x900 | Server detail, Fixture A (status: fresh) Whole page shown (1120px tall). |
| [06-server-detail-fresh-390x844.png](handoff-monty/06-server-detail-fresh-390x844.png) | `/servers/00000000-0000-4000-8000-0000000000a1` | 390x844 | Server detail on a phone, Fixture A Whole page shown (2239px tall). |
| [07-server-detail-partial-1440x900.png](handoff-monty/07-server-detail-partial-1440x900.png) | `/servers/00000000-0000-4000-8000-0000000000b2` | 1440x900 | Server detail, Fixture B (status: partial), with findings Whole page shown (1075px tall). |
| [08-server-detail-unreachable-1440x900.png](handoff-monty/08-server-detail-unreachable-1440x900.png) | `/servers/00000000-0000-4000-8000-0000000000c3` | 1440x900 | Server detail, Fixture C (status: unreachable), last check failed, figures are historical Whole page shown (1305px tall). |
| [09-server-detail-host-key-1440x900.png](handoff-monty/09-server-detail-host-key-1440x900.png) | `/servers/00000000-0000-4000-8000-0000000000d4` | 1440x900 | Server detail, Fixture D (status: unverified-host), host key not verified, never contacted Whole page shown (1094px tall). |
| [10-findings-1440x900.png](handoff-monty/10-findings-1440x900.png) | `/findings` | 1440x900 | Findings page on the local API in fixture mode (findings from the invented servers; scheduler shown as unavailable, never as an all-clear) Whole page shown (1157px tall). |
| [11-findings-all-states-1440x900.png](handoff-monty/11-findings-all-states-1440x900.png) | `/fixtures/findings` | 1440x900 | Findings with every state: new, acknowledged, snoozed, resolved, previously detected not rechecked Whole page shown (1512px tall). |
| [12-findings-all-states-390x844.png](handoff-monty/12-findings-all-states-390x844.png) | `/fixtures/findings` | 390x844 | Findings on a phone, every state Whole page shown (2212px tall). |
| [13-plan-ready-1440x900.png](handoff-monty/13-plan-ready-1440x900.png) | `/plans/fixture-plan-ready` | 1440x900 | Plan review, ready to approve (non-production) Whole page shown (1004px tall). |
| [14-plan-ready-390x844.png](handoff-monty/14-plan-ready-390x844.png) | `/plans/fixture-plan-ready` | 390x844 | Plan review, ready to approve (non-production) Whole page shown (1520px tall). |
| [15-plan-production-1440x900.png](handoff-monty/15-plan-production-1440x900.png) | `/plans/fixture-plan-production` | 1440x900 | Plan review, production server: two unticked confirmations and a disabled approve button Whole page shown (1044px tall). |
| [16-plan-blocked-writes-off-1440x900.png](handoff-monty/16-plan-blocked-writes-off-1440x900.png) | `/plans/fixture-plan-writes-off` | 1440x900 | Plan review, blocked: changes switched off for this server, no approve control Whole page shown (979px tall). |
| [17-plan-expired-1440x900.png](handoff-monty/17-plan-expired-1440x900.png) | `/plans/fixture-plan-expired` | 1440x900 | Plan review, expired: reason shown, Refresh plan offered Whole page shown (1004px tall). |
| [18-operation-running-1440x900.png](handoff-monty/18-operation-running-1440x900.png) | `/operations/fixture-op-running` | 1440x900 | Operation running: steps with times, stop request, no percentage |
| [19-operation-succeeded-receipt-1440x900.png](handoff-monty/19-operation-succeeded-receipt-1440x900.png) | `/operations/fixture-op-succeeded` | 1440x900 | Operation completed and verified, with the receipt (changed, verified, still needed, could not verify) |
| [20-operation-outcome-unknown-1440x900.png](handoff-monty/20-operation-outcome-unknown-1440x900.png) | `/operations/fixture-op-unknown` | 1440x900 | Operation outcome unknown: result not yet confirmed, Recheck outcome Whole page shown (937px tall). |
| [21-assistant-answer-1440x900.png](handoff-monty/21-assistant-answer-1440x900.png) | `/` | 1440x900 | Ask bar with the answer panel open (deterministic answer, no AI provider: AI_PROVIDER=none) |
| [22-assistant-answer-390x844.png](handoff-monty/22-assistant-answer-390x844.png) | `/` | 390x844 | Ask bar with the answer panel open on a phone |
| [23-state-empty-fleet-1440x900.png](handoff-monty/23-state-empty-fleet-1440x900.png) | `/fixtures/overview?n=0` | 1440x900 | Overview with no servers: invitation to meet the first server |
| [24-state-empty-fleet-390x844.png](handoff-monty/24-state-empty-fleet-390x844.png) | `/fixtures/overview?n=0` | 390x844 | Empty fleet on a phone Whole page shown (884px tall). |
| [25-state-compact-list-20-1440x900.png](handoff-monty/25-state-compact-list-20-1440x900.png) | `/fixtures/overview?n=20` | 1440x900 | Overview with 20 servers in the compact list, sorted by what needs attention (mix of fresh, stale, partial, unreachable) |
| [26-state-cards-20-1440x900.png](handoff-monty/26-state-cards-20-1440x900.png) | `/fixtures/overview?n=20` | 1440x900 | Overview with 20 servers as cards (stale, partial, unreachable, host key states in one view) |
| [27-state-api-down-1440x900.png](handoff-monty/27-state-api-down-1440x900.png) | `/fixtures/overview?n=4&state=error` | 1440x900 | Overview when the API cannot be reached (nothing shown as healthy) |
| [28-state-clock-untrusted-1440x900.png](handoff-monty/28-state-clock-untrusted-1440x900.png) | `/ (clock state injected into the fixture /api/fleet answer)` | 1440x900 | Overview while ServrSit's own clock is wrong: persistent banner, ages marked with an approximation sign, approvals paused |
| [29-state-clock-untrusted-390x844.png](handoff-monty/29-state-clock-untrusted-390x844.png) | `/ (clock state injected into the fixture /api/fleet answer)` | 390x844 | Clock-untrusted banner on a phone |
| [30-connect-1-meet-1440x900.png](handoff-monty/30-connect-1-meet-1440x900.png) | `/fixtures/connect` | 1440x900 | Connect a server, step 1 (Meet the server): name, address, port, user, role, production Whole page shown (1082px tall). |
| [31-connect-1-meet-390x844.png](handoff-monty/31-connect-1-meet-390x844.png) | `/fixtures/connect` | 390x844 | Connect a server, step 1 on a phone Whole page shown (1392px tall). |
| [32-connect-2-host-key-1440x900.png](handoff-monty/32-connect-2-host-key-1440x900.png) | `/fixtures/connect` | 1440x900 | Connect a server, step 2 (Verify identity): the host key fingerprint ServrSit sees, ready for the owner to compare with an independent source |
| [33-connect-2-host-key-390x844.png](handoff-monty/33-connect-2-host-key-390x844.png) | `/fixtures/connect` | 390x844 | Connect a server, step 2 on a phone Whole page shown (1124px tall). |
| [34-connect-2-host-key-compared-1440x900.png](handoff-monty/34-connect-2-host-key-compared-1440x900.png) | `/fixtures/connect` | 1440x900 | Connect a server, step 2 after the owner typed the fingerprint: what ServrSit sees is shown and matches; independent-source confirmation ticked; Trust this host key enabled (the fingerprint is a made-up sample) Whole page shown (1008px tall). |
| [35-connect-2-host-key-compared-390x844.png](handoff-monty/35-connect-2-host-key-compared-390x844.png) | `/fixtures/connect` | 390x844 | Connect a server, step 2 compared, on a phone Whole page shown (1338px tall). |
| [36-activity-1440x900.png](handoff-monty/36-activity-1440x900.png) | `/fixtures/activity` | 1440x900 | Activity: filters, records by day, export panel Whole page shown (1875px tall). |
| [37-baselines-start-1440x900.png](handoff-monty/37-baselines-start-1440x900.png) | `/fixtures/baselines` | 1440x900 | Baselines, step 1: choose a reference server |
| [38-settings-1440x900.png](handoff-monty/38-settings-1440x900.png) | `/fixtures/settings` | 1440x900 | Settings: schedules, AI and data, server access Whole page shown (2228px tall). |
| [39-sign-in-1440x900.png](handoff-monty/39-sign-in-1440x900.png) | `/ (signed out, owner exists)` | 1440x900 | Sign-in after Sign out: signed-out notice, username and password |
| [40-sign-in-390x844.png](handoff-monty/40-sign-in-390x844.png) | `/ (signed out, owner exists)` | 390x844 | Sign-in on a phone |
| [41-sign-in-wrong-password-1440x900.png](handoff-monty/41-sign-in-wrong-password-1440x900.png) | `/ (signed out, owner exists)` | 1440x900 | Sign-in after a wrong password: one message for any mismatch |

Not captured, and why: see the end of `docs/team/handoff-monty/index.md` (secret-bearing setup screens left out on purpose; live AI answers, focus/hover states and real-phone rendering not photographed).

---

## 5. Where the theme can go

### Source map

| Area | Files |
|---|---|
| Entry, routes, auth gate | `apps/web/src/main.tsx`, `App.tsx`, `lib/router.ts`, `auth/AuthGate.tsx` |
| Shells | Overview rail: `components/overview/OverviewScreen.tsx` (+ `.module.css`); all other pages: `care/CareShell.tsx` (+ `care/care.module.css`) |
| Theme tokens | `packages/ui/src/tokens/{colors,typography,spacing}.css`, app overrides `apps/web/src/tokens.css`, fonts `apps/web/src/fonts.css` + `apps/web/public/fonts/` |
| Shared components | `components/StatusBadge`, `components/server-card` (ServerCard, PixelServerIcon), `components/FixtureBanner`, `components/ScrollRegion`, `clock/TopBanners.tsx`, `auth/SignOutButton.tsx`, `lib/SkipLink.tsx`, `lib/RouteAnnouncer.tsx` |
| Screen layouts | `components/overview/*`, `servers/ServerDetailScreen.tsx`, `connect/ConnectScreen.tsx`, `care/PlanScreen.tsx`, `care/OperationScreen.tsx`, `findings/*`, `activity/*`, `baselines/*`, `settings/*`, `auth/*` |
| UI copy | Mostly inline in components and in view models: `components/overview/fleetViewModel.ts`, `servers/serverDetailViewModel.ts`, `care/planViewModel.ts`, `care/operationViewModel.ts`, `findings/findingsViewModel.ts`, `auth/copy.ts`, `auth/authText.ts`, `clock/clockBanner.ts`. No central copy file. |
| Product rules the theme must respect | `.kiro/steering/design.md` (incl. founder overrides), `.kiro/steering/execution-security.md`, `docs/product/03_ServerSit - UX Spec.md`, `docs/team/ux-feedback-001.md` |

### Easy to theme centrally

Colour, type, spacing and motion tokens; fonts; card surface, radius and offset shadow; pixel server icon art and identity colours; the brand wordmark; empty-state illustration slots (none exist yet); banner styling; the chat bar's look; routine good-news copy.

### Tied to state, permissions, accessibility or operation safety (change only with care)

- **Status semantics:** five semantic state colour pairs, icon + text on every badge, three separate dimensions (coverage, findings, operation state). Health must never be shown by identity colour or by the character's mood alone.
- **Freshness and uncertainty:** "Historical", "Check overdue", "Previously detected, not rechecked", clock-uncertain ages. A friendly character must not soften these into reassurance.
- **Approval surface:** exact target and Production label always visible; specific approve label ("Approve update on {server}", never "OK"); the two production acknowledgements; expiry; disabled states with reasons; no approval via chat.
- **Operation honesty:** "Completed and verified" only for verified success; outcome-unknown wording; "Stop after this safe step" is not "Undo"; no invented progress percentages.
- **Fixture labelling:** `[FIXTURE DATA]` must stay visible on sample data.
- **Accessibility (WCAG 2.2 AA target, two passes done):** 44 px targets, visible focus (`--color-focus`), skip link, route announcer and per-route titles, contrast ≥ 4.5:1 for text, reduced motion, forced colours, mobile anchoring (no horizontal overflow, no 100vw/100vh).
- **Plain-HTTP origin:** the app is served over plain HTTP on the tailnet; do not rely on browser features that need HTTPS (e.g. `crypto.randomUUID`, clipboard write without fallback).

### Friction and unresolved decisions the spec should address

1. **Two navigation shells** (rail on Overview only; breadcrumb bar elsewhere). Findings and Baselines are unreachable from navigation.
2. **Where the Server Sitter character lives** without crowding a no-scroll overview, and how it behaves in failure, unknown and production states (voice rule above).
3. **Assistant surface:** a 3-line bar at the bottom with an answer panel; no conversation history, no plan card from chat (FR-07 gap), placeholder hard-codes a real server name ("Nabire").
4. **Receipt gaps** (T-094): no reboot evidence, no "services that may need a restart", no "restarted by the package itself" — the spec should design these.
5. **Copy drift:** the writes-off text still says "until testing on a disposable server is complete", which is no longer true for Sentani; Settings says "Read-only for now. Editing is not available yet."; server role cannot be edited in the UI.
6. **Unreviewed screens:** findings, activity, baselines, settings and most operation states have never had founder design review.
7. **Error explanations in connect flow** (T-085, T-086): network not enabled, Tailscale SSH interception.
8. **Leftover tokens** (Canvas, Bricolage) and mixed icon styles.

### Interactions to preserve

No page scroll on desktop overview; cards first, chat at the bottom; one primary action per card; Review updates → plan → approve → operation as one canonical path; "Preparing a plan…" / "Submitting approval" / "Checking whether this started" states and double-submit guards; owner time zone (WIB) with relative ages; the host-fingerprint confirmation step; data-source badges; mobile anchoring; dark read-only transcript.

---

## Read this first

- **Most representative screenshot:** `docs/team/handoff-monty/03-overview-1440x900.png` (desktop overview, fixture fleet).
- **Main source files:** `apps/web/src/components/overview/OverviewScreen.tsx`, `apps/web/src/care/CareShell.tsx`, `apps/web/src/care/PlanScreen.tsx`, `packages/ui/src/tokens/colors.css`, `apps/web/src/tokens.css`, `.kiro/steering/design.md`.
- **Understand before designing:**
  1. **Honesty is the product.** Every state is about what was actually checked and when; the character may make good news friendlier but must never make uncertainty, staleness or failure look fine.
  2. **Approval is sacred and specific.** The plan page and its button are the only way anything changes on a server; the theme can dress it but not shorten, soften or hide it.
  3. **The founder has strong, recorded taste:** white, pixel titles and icons, dense, no scroll, cards first, chat small at the bottom. The theme should build on these, not replace them, unless he decides otherwise.
