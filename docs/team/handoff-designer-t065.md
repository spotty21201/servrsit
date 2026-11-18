# Handoff: Designer T-065 (branch feat/designer/t065)

Login screens (UX-01, UX Spec §7.1) on Coder's T-053 owner auth, the T-060 polish, and the clock banner (steering).

## 1. Changed files
- `apps/web/src/auth/`: `AuthGate.tsx` (route guard), `SignInScreen.tsx`, `SetupScreen.tsx`, `AuthFrame.tsx`, `QrCode.tsx`, `SignOutButton.tsx`, `session.tsx`, `unauthorized.ts` (401 watcher), `copy.ts`, pure logic `authText.ts` and `qr.ts`, `auth.module.css`, tests for each logic file.
- Uses `apps/web/src/api/auth.ts` unchanged. No stub was needed.
- `apps/web/package.json` + `pnpm-lock.yaml`: new dependency `qrcode-generator` **2.0.4** (exact; MIT; zero dependencies; renders the QR in the browser, no network). Verified from the registry before adding.
- Clock banner: `apps/web/src/clock/` (`clockBanner.ts` + test, `clockTypes.ts`, `ClockContext.tsx`, `TopBanners.tsx`, `FixtureClockPage.tsx`, `clock.module.css`).
- Wiring: `App.tsx` (gate, clock provider, `/fixtures/clock`), `CareShell.tsx`, `OverviewScreen.tsx` (sign-out, `TopBanners`), `PlanScreen.tsx`, `OperationScreen.tsx`, view models (`toOverviewVM`, `toPlanVM`, `toOperationVM` take an uncertain-ages flag), `lib/time.ts` (+tests), `lib/router.ts`, `FixtureBanner.module.css`.
- T-060 polish in `care/care.module.css`: panel padding 12px all round → 8px/12px, tighter gaps, and the empty status line no longer leaves a blank strip at the bottom of the Approval card.
- Evidence: `docs/team/evidence/t065/` (38 PNGs, desktop `-d` and 390px `-m`).

## 2. What was built
**Route guard.** `AuthGate` asks `/api/auth/session` first. Signed-out → sign-in at the **same URL**, so after login the owner is on the page they asked for (checked: `/plans/fixture-plan-ready`). API unreachable → "Can't reach ServrSit", never a guess. A 401 from any data call (fetch watcher) or the 8-hour limit → sign-in with "Your session ended". Signing out unmounts the app, so no data stays in memory.
**Sign-in.** Username + password, then the 6-digit code (`autocomplete=one-time-code`, spaces and dashes accepted) or "Use a recovery code instead". Show/Hide password. Labels, no placeholders, 44px inputs and buttons (measured 44), 16px text. Lockout text gives duration and clock time ("Try again in 30 s (at 10:54 WIB)") and disables the form until then. Wrong username and wrong password give the identical sentence; verified an unknown user gets the same text. Signed-out notice: "You're signed out. Your servers have a sitter either way." (routine good news only).
**First-run setup.** Setup token (hint: printed on the API's stderr), username (default `owner`), password with strength meter + text hint (12-char floor from the contract; pasting and password managers allowed) → QR drawn locally + secret as grouped text + Copy key + "Open in authenticator app" link → confirm code → 10 recovery codes with Copy all, Download .txt (client-side), `beforeunload` guard, and an "I saved these recovery codes" checkbox that gates Continue. The TOTP secret and codes live only in component state, never storage or URL.
**Sign-out** is in each page's top line: Care pages' top bar; on the Overview it replaces the placeholder account button (top row on mobile and tablet, bottom of the rail on desktop).
**Clock banner** (steering). Persistent, not dismissible, below the fixture banner. Untrusted → critical styling, icon + text: "ServrSit's own clock is wrong (about 7 h fast), so ages and expiry times may be off. Approvals are paused until it is fixed." plus the API `reason` as "Why: …" and a note that ages marked ≈ are uncertain. No offset known → "can't confirm its own clock is right" (no invented number). `not-checked` → quieter attention banner, no pause. Untrusted also: relative ages and expiry get a "≈" (Overview cards, attention list, Updated line, plan expiry, plan prepared time, operation updated time), and Plan review shows "Approvals are paused" with no approve button. Banner and fixture banner are one sticky block (from 768px; static on phones), whose measured height is published as `--banner-h`, so the Overview navigation never overlaps it. Review all states at `/fixtures/clock` ([FIXTURE DATA]).

## 3. Checks run (real output)
- `pnpm --filter @servrsit/web test`: **101 pass, 0 fail** (was 78). `typecheck` clean, `build` ok.
- Own preview and API: Vite on 127.0.0.1:5174 with an uncommitted config proxying `/api` to **my own API on 127.0.0.1:3005** (started from this worktree, `SERVRSIT_FLEET_MODE=fixture`, auth DB in `.t065/`, git-excluded). Never touched :3001. Both panes closed; ports refuse connections now.
- Browser run (Playwright, real setup against my API, TOTP computed from the shown secret): guard shows sign-in at the plan URL with no plan content; setup → QR (1 svg) → 10 codes; Continue disabled until the checkbox; clipboard held 10 lines; download `servrsit-recovery-codes.txt`; returned to `/plans/fixture-plan-ready`; sign-out visible on plan and overview; cookie cleared + a data call → "Your session ended"; wrong password and unknown user gave the same text; recovery-code sign-in worked, the reused code was refused; lockout showed "Too many failed attempts. Try again in 30 s (at …)". `scrollWidth == clientWidth` at 1280 and 390 on every screen.
- Clock banner shots use a mocked `/api/fleet` body (`controlPlane.clock` untrusted) because this branch's API doesn't emit it: `30-…` (fixture page), `31-…` (overview), `32-…` (plan, approve buttons: 0), `33-…` (operation, 390px).

## 4. Gaps and requests
- **Merge pending.** `integration/live-v1` conflicts with this branch in Coder's `apps/api/src/server.ts` and `apps/api/src/routes/care.test.ts`; Coder is merging. Until then `packages/contracts` here lacks `controlPlane`, so the clock reads the raw `/api/fleet` body with a **local type** (`clock/clockTypes.ts`). After the merge, swap it for `ControllerClock` from `@servrsit/contracts` and use `useFleet` data instead of the extra once-a-minute `/api/fleet` poll.
- Also after the merge: `apps/web/src/api/fleet.fixtures.ts` needs Coder's `controlPlane` addition (on integration); web tests that parse fleet fixtures may fail until then. I did not edit it.
- I did not edit `packages/contracts` or any `src/api` file.
- Sign-out on desktop sits at the bottom of the left rail, not in a top line; the rail has no top bar. Say if you want it in a thin top bar instead.
- No "setup available?" signal exists (by design, no disclosure), so the sign-in screen always offers "Set up the owner account"; a used or wrong token gets a generic message.
- `sessionStorage`/return-path: not needed since the URL never changes while signed out.
- No re-authentication step before approvals (ADR-017 limit).
- Mobile phones: the clock banner scrolls away with the page (sticky only ≥768px); say if it must stay pinned.
- Playwright needs system libs that are missing here; I extracted them into `/tmp/libs` from apt packages without installing anything system-wide.

## 5. Next
Orchestrator: after Coder's merge, merge `feat/designer/t065`. Designer: swap the local clock type for the contract, re-run the flow against the real `controlPlane`.
