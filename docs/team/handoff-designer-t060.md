# Handoff: Designer T-060 (branch feat/designer/t060)

Plan review (UX-07, `/plans/:id`) and Operation detail (UX-08, `/operations/:id`), built against the real API shapes.

## 1. Changed files
- `apps/web/src/care/`: `PlanScreen.tsx`, `OperationScreen.tsx`, `CareShell.tsx`, `care.module.css` (screens, shared styles); `planViewModel.ts`, `operationViewModel.ts`, `approval.ts` (pure logic); `fixtures.ts` ([FIXTURE DATA] plans, operations, fixture client). Tests beside each logic file.
- `apps/web/src/lib/router.ts` (+test): path router, no new dependency. `lib/time.ts`: added `formatTimeSeconds`, `formatUntil`.
- `apps/web/src/App.tsx`: routes `/plans/:id`, `/operations/:id`; everything else is the Overview.
- **Stub for Coder:** `apps/web/src/api/stubs/care.ts` (+test). A typed `CareClient` (getPlan, createPlan, revisePlan, approvePlan with `/api/csrf`, getOperation). Result objects, never throws, body text never copied. Types are mirrored by hand from `apps/api/src/routes/care.ts` because web does not depend on `@servrsit/domain`. No existing `src/api` file was edited. Coder may replace it; the screens use only the `CareClient` interface.

## 2. What the screens do
**Plan review.** Title "Update packages on {server}", Production label, version, target name and server ID, Scope (package names, no restarts/reboot/removals), Impact, Preconditions (each Met / Blocked / You confirm / Not checked), Verification and "What this cannot establish", expiry as absolute owner-zone time plus relative, versions and digest under "Technical details". Label is specific: "Approve update on {server}".
- Production: two unchecked acknowledgements (recovery route, interruption risk). The button stays disabled until both are ticked, with visible helper text. Sent as `["production-impact","recovery-route","interruption-risk"]`, so the approval record holds both specific confirmations plus the token the API requires.
- **Writes off** (`WRITES_DISABLED`): fixed sentence "Changes are switched off for this server until testing on a disposable server is complete." No approve button, no checkboxes, "Refresh plan" offered. Verified in browser: 0 approve buttons, 0 checkboxes.
- Blocked (other blockers), expired, and changed (`PLAN_CHANGED` etc.) show the specific reason and "Refresh plan", no approve button. Refresh shows version N→M with added/removed/changed packages; acknowledgements reset.
- Duplicate guard: "Submitting approval" → if the response is lost, "Checking whether this started" (re-sends the **same** idempotency key, up to 3 times) → "Couldn't confirm whether this started" with only "Check again". No fresh-approval path. Key is per plan version.

**Operation detail.** All 8 states with UX §11 labels ("Working on {server}" etc.), plain explanation, vertical step list (Approved, Send, Install, Check installed versions, Result recorded) with real times to the second in the owner zone and a text status per step, receipt (What changed / What was verified / Still needed / Could not verify), collapsed dark read-only transcript with "Jump to latest" when scrolled up. No percentages. "Stop after this safe step" with the not-an-undo explanation. Polls every 3 s while unresolved. Verified install with reboot needed reads "Completed and verified. Reboot still needed."

Fixtures: `/plans/fixture-plan-{ready,production,lost,changed,expired,busy,writes-off}` and `/operations/fixture-op-{queued,running,running-stop,verifying,succeeded,succeeded-reboot,partial,failed,cancelled,unknown}`. Names are "Fixture …", the banner is always shown for them.

## 3. Checks run (real output)
- `pnpm --filter @servrsit/web test`: 78 pass, 0 fail (was 48). `typecheck` clean. `build` ok.
- Browser (Chromium headless, Playwright): all 17 fixture pages at 1280px and 390px: `scrollWidth == clientWidth` on every one (no horizontal overflow), no console errors. Fonts render (Geist, Silkscreen).
- Flow script against the fixtures: writes-off 0 approve buttons; production starts with 0 ticked, button disabled, enabled only after both ticks; nothing focused on load; "Submitting approval" appears and it navigates to `/operations/fixture-op-queued`; lost-response shows "Checking whether this started" then reaches the same operation; changed → no approve, Refresh plan → "updated from version 1 to 2" + approve returns; expired → no approve, refresh gives a new plan; running shows exactly one "Stop after this safe step" and no percentages; transcript opens with 5 lines and no overflow at 390px.
- Real API: the plan JSON captured from `POST /api/plans` on Nabire is a unit test (`api/stubs/care.test.ts`): it passes the guard and renders as writes-disabled with no approval.
- Preview server on 5174 closed (connection refused now).

## 4. Gaps and requests
- **Live capture not done.** The API on :3001 restarted repeatedly while I tested and its plan store is in memory, so plans vanished (404/500 via the proxy). The live path is covered by the captured-shape unit test only, not by a screenshot.
- **API drift:** a later response from :3001 showed `production: false` for Nabire and a message text different from the earlier one, and the contract may have gained fields (I saw `excludedPackages` in one truncated response). The guard ignores extra fields; the writes-off sentence is fixed text in the UI, not the API's.
- **Missing endpoints (UI is honest about it):** stop request, cancel before start, reconcile/recheck (button just re-reads). Stop is shown disabled with "not connected to the API yet".
- **Address:** the plan has no address, only server ID and name. UX §10.1 asks for address/identity.
- **Reboot-required:** not in any event payload yet. The UI reads an optional `rebootRequired: true` in an event payload (fixture only).
- **Two acknowledgements:** the API requires only `production-impact`. Recommend the contract name the two specific tokens.
- **Transcript:** shows ServrSit's recorded events, not remote command output (not captured).
- No entry point creates a plan from the Overview yet (e.g. a button on a server card).
- Plan screen "Ready to review" badge uses the progress icon (spinner glyph); consider a neutral icon.
- Time zone for these pages is loaded with one extra `/api/fleet` call; Coder may prefer sharing it.

## 5. Next
Orchestrator: merge `feat/designer/t060`. Coder: stop/cancel/recheck endpoints, address in plan, two ack tokens, reboot-required event, then swap the stub for the real client.
