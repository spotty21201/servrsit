# Unattended run 001: summary for Spotty

Authorization: ADR-016 (development only; no writes on real servers, no spending). Dates below use Merauke's clock, which is about 7 h fast.

## Where things are

| Branch | What it is | State |
|---|---|---|
| `integration/live-v1` | Your running app at http://100.104.220.8:5173/ | Live data from all four servers, chat with fact check, owner context, Geist fonts, time zone, plan/operation screens, clock self-check. No login yet. |
| `integration/next` | Release candidate with everything below | 752 automated tests pass (0 fail), web build passes; Tester verdict PASS (one Low a11y item open). Not yet running for you (ADR-018). |

## Delivered in this run (all verified by Tester unless noted)

- **AI quality:** owner context (your server roles, voice), deterministic fact check of every number the AI states, secret detector hardened, cut-off replies never shown as complete. Live check: correct per-server update counts passed the fact check.
- **Merauke's clock problem found:** Merauke is ~7 h fast and not synchronized. ServrSit now detects this itself, blames the right machine, marks ages as uncertain and pauses approvals. **Fix needs you** (founder-actions.md item 1).
- **Login with MFA:** password + mandatory authenticator code, recovery codes, setup token, lockout/rate-limit hardening, every API route protected. Browser sign-in walkthrough 9/9.
- **Screens:** server detail, connect-a-server (4 steps), plan review, operation detail, findings, activity/export, baselines, settings, sign-in/enrolment, empty overview, compact 20-server list, clock banner. Accessibility: two full passes, all Medium findings closed.
- **APIs behind the screens:** server registration (dedicated key per server, host-key confirmation, no-sudo-elevation privilege check), findings (acknowledge/snooze/resolve with evidence), activity + export without secrets, baselines, settings, care loop (plans, approvals, stop request, reconcile, canonical identity, production acknowledgements, restart/reboot/directories).
- **Target helper (build only):** the small restricted program that would run approved changes on a server. Core safety mechanics pass 51 unit tests; Tester found 5 robustness defects (T-084, in progress). **Never installed anywhere.**

## Still locked, by design

- `writesEnabled=false` on Sentani, Nabire, Timika and Merauke; it cannot be changed from the app. Unlocking needs the disposable test server and your explicit approval of specific work.
- No AWS resources; CDK definition and runbook only.

## What happens when you are back

1. Fix Merauke's clock (founder-actions.md item 1).
2. I merge `integration/next` into your running app and you enrol (setup token from the API console, authenticator app, save recovery codes).
3. Review the screens: http://100.104.220.8:5173/review-002/index.html
4. When ready: provide the disposable Ubuntu server so update/restart/reboot can be proven, and decide on hosting.

## Reports

Tester: `/projects/servrsit-tester/docs/team/test-report-*.md` (live-001, care-loop-001/002, ai-auth-001, ui-a11y-001/002/003, registration-001, next-001, helper-001). Coder: `docs/team/handoff-coder-run-summary.md` on `integration/next`. Decisions: ADR-016 to ADR-019 (+ Coder's ADR-017, ADR-020) in `docs/decisions/decision-log.md`.
