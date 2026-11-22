# UI/UX handoff screenshots for Monty

App as it is on `integration/live-v1`, captured on 2026-11-18 from branch `feat/designer/handoff-monty`. No code was changed; this folder is the only addition.

## How these were made

- A real headless Chromium, PNG, at 1440x900 (desktop) and 390x844 (phone). Pages taller than the viewport are saved whole (up to 3000 px tall); the line for each image says when that happened. Overview at 1440 and the Ask-bar images are exactly the viewport.
- My own copies of the app: the API from this worktree on 127.0.0.1:3005 in fixture mode (`SERVRSIT_FLEET_MODE=fixture`, `AI_PROVIDER=none`, throwaway databases under the worktree), and Vite on 127.0.0.1:5175 proxied to it. Nothing touched the founder's :3001 or :5173, his account, any live server or any credential. No third-party AI was called: the assistant answer is the deterministic one.
- A throwaway test owner was enrolled on the throwaway database. The setup, authenticator-key and recovery-code screens were not captured.
- Every image is **fixture data**: either the local API's invented servers (Fixture A to D) or the built-in sample screens under `/fixtures/…` and `/plans/fixture-…`, `/operations/fixture-…`. Fixture pages carry the `[FIXTURE DATA]` banner in the image. Because the API runs in fixture mode, almost every signed-in page also shows the yellow "Clock not checked" banner; images 28 and 29 show the clock-wrong variant.
- Server names shown are invented ("Fixture A"…). Nothing here is the founder's Sentani, Nabire or Timika.

## Images

Format: file | route | viewport | state shown | data source

- `01-sign-in-first-run-1440x900.png` | route `/ (signed out, no owner yet)` | 1440x900 | Sign-in screen with the first-time setup link | data: real screen, no data
- `02-sign-in-first-run-390x844.png` | route `/ (signed out, no owner yet)` | 390x844 | Sign-in screen with the first-time setup link | data: real screen, no data
- `03-overview-1440x900.png` | route `/` | 1440x900 | Overview, normal fixture fleet: four server cards (fresh, partly checked, unreachable, host key not verified), Needs attention, Recent activity, Ask bar | data: fixture (the local API in fixture mode: invented servers A to D)
- `04-overview-390x844.png` | route `/` | 390x844 | Overview on a phone, same fleet Whole page shown (2043px tall). | data: fixture (the local API in fixture mode: invented servers A to D)
- `05-server-detail-fresh-1440x900.png` | route `/servers/00000000-0000-4000-8000-0000000000a1` | 1440x900 | Server detail, Fixture A (status: fresh) Whole page shown (1120px tall). | data: fixture (the local API in fixture mode: invented servers A to D)
- `06-server-detail-fresh-390x844.png` | route `/servers/00000000-0000-4000-8000-0000000000a1` | 390x844 | Server detail on a phone, Fixture A Whole page shown (2239px tall). | data: fixture (the local API in fixture mode: invented servers A to D)
- `07-server-detail-partial-1440x900.png` | route `/servers/00000000-0000-4000-8000-0000000000b2` | 1440x900 | Server detail, Fixture B (status: partial), with findings Whole page shown (1075px tall). | data: fixture (the local API in fixture mode: invented servers A to D)
- `08-server-detail-unreachable-1440x900.png` | route `/servers/00000000-0000-4000-8000-0000000000c3` | 1440x900 | Server detail, Fixture C (status: unreachable), last check failed, figures are historical Whole page shown (1305px tall). | data: fixture (the local API in fixture mode: invented servers A to D)
- `09-server-detail-host-key-1440x900.png` | route `/servers/00000000-0000-4000-8000-0000000000d4` | 1440x900 | Server detail, Fixture D (status: unverified-host), host key not verified, never contacted Whole page shown (1094px tall). | data: fixture (the local API in fixture mode: invented servers A to D)
- `10-findings-1440x900.png` | route `/findings` | 1440x900 | Findings page on the local API in fixture mode (findings from the invented servers; scheduler shown as unavailable, never as an all-clear) Whole page shown (1157px tall). | data: fixture (the local API in fixture mode: invented servers A to D)
- `11-findings-all-states-1440x900.png` | route `/fixtures/findings` | 1440x900 | Findings with every state: new, acknowledged, snoozed, resolved, previously detected not rechecked Whole page shown (1512px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `12-findings-all-states-390x844.png` | route `/fixtures/findings` | 390x844 | Findings on a phone, every state Whole page shown (2212px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `13-plan-ready-1440x900.png` | route `/plans/fixture-plan-ready` | 1440x900 | Plan review, ready to approve (non-production) Whole page shown (1004px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `14-plan-ready-390x844.png` | route `/plans/fixture-plan-ready` | 390x844 | Plan review, ready to approve (non-production) Whole page shown (1520px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `15-plan-production-1440x900.png` | route `/plans/fixture-plan-production` | 1440x900 | Plan review, production server: two unticked confirmations and a disabled approve button Whole page shown (1044px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `16-plan-blocked-writes-off-1440x900.png` | route `/plans/fixture-plan-writes-off` | 1440x900 | Plan review, blocked: changes switched off for this server, no approve control Whole page shown (979px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `17-plan-expired-1440x900.png` | route `/plans/fixture-plan-expired` | 1440x900 | Plan review, expired: reason shown, Refresh plan offered Whole page shown (1004px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `18-operation-running-1440x900.png` | route `/operations/fixture-op-running` | 1440x900 | Operation running: steps with times, stop request, no percentage | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `19-operation-succeeded-receipt-1440x900.png` | route `/operations/fixture-op-succeeded` | 1440x900 | Operation completed and verified, with the receipt (changed, verified, still needed, could not verify) | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `20-operation-outcome-unknown-1440x900.png` | route `/operations/fixture-op-unknown` | 1440x900 | Operation outcome unknown: result not yet confirmed, Recheck outcome Whole page shown (937px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `21-assistant-answer-1440x900.png` | route `/` | 1440x900 | Ask bar with the answer panel open (deterministic answer, no AI provider: AI_PROVIDER=none) | data: fixture (the local API in fixture mode: invented servers A to D)
- `22-assistant-answer-390x844.png` | route `/` | 390x844 | Ask bar with the answer panel open on a phone | data: fixture (the local API in fixture mode: invented servers A to D)
- `23-state-empty-fleet-1440x900.png` | route `/fixtures/overview?n=0` | 1440x900 | Overview with no servers: invitation to meet the first server | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `24-state-empty-fleet-390x844.png` | route `/fixtures/overview?n=0` | 390x844 | Empty fleet on a phone Whole page shown (884px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `25-state-compact-list-20-1440x900.png` | route `/fixtures/overview?n=20` | 1440x900 | Overview with 20 servers in the compact list, sorted by what needs attention (mix of fresh, stale, partial, unreachable) | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `26-state-cards-20-1440x900.png` | route `/fixtures/overview?n=20` | 1440x900 | Overview with 20 servers as cards (stale, partial, unreachable, host key states in one view) | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `27-state-api-down-1440x900.png` | route `/fixtures/overview?n=4&state=error` | 1440x900 | Overview when the API cannot be reached (nothing shown as healthy) | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `28-state-clock-untrusted-1440x900.png` | route `/ (clock state injected into the fixture /api/fleet answer)` | 1440x900 | Overview while ServrSit's own clock is wrong: persistent banner, ages marked with an approximation sign, approvals paused | data: fixture (the local API in fixture mode: invented servers A to D); the clock state is injected into the response
- `29-state-clock-untrusted-390x844.png` | route `/ (clock state injected into the fixture /api/fleet answer)` | 390x844 | Clock-untrusted banner on a phone | data: fixture (the local API in fixture mode: invented servers A to D); the clock state is injected into the response
- `30-connect-1-meet-1440x900.png` | route `/fixtures/connect` | 1440x900 | Connect a server, step 1 (Meet the server): name, address, port, user, role, production Whole page shown (1082px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `31-connect-1-meet-390x844.png` | route `/fixtures/connect` | 390x844 | Connect a server, step 1 on a phone Whole page shown (1392px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `32-connect-2-host-key-1440x900.png` | route `/fixtures/connect` | 1440x900 | Connect a server, step 2 (Verify identity): the host key fingerprint ServrSit sees, ready for the owner to compare with an independent source | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `33-connect-2-host-key-390x844.png` | route `/fixtures/connect` | 390x844 | Connect a server, step 2 on a phone Whole page shown (1124px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `34-connect-2-host-key-compared-1440x900.png` | route `/fixtures/connect` | 1440x900 | Connect a server, step 2 after the owner typed the fingerprint: what ServrSit sees is shown and matches; independent-source confirmation ticked; Trust this host key enabled (the fingerprint is a made-up sample) Whole page shown (1008px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `35-connect-2-host-key-compared-390x844.png` | route `/fixtures/connect` | 390x844 | Connect a server, step 2 compared, on a phone Whole page shown (1338px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `36-activity-1440x900.png` | route `/fixtures/activity` | 1440x900 | Activity: filters, records by day, export panel Whole page shown (1875px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `37-baselines-start-1440x900.png` | route `/fixtures/baselines` | 1440x900 | Baselines, step 1: choose a reference server | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `38-settings-1440x900.png` | route `/fixtures/settings` | 1440x900 | Settings: schedules, AI and data, server access Whole page shown (2228px tall). | data: fixture (built-in sample client, [FIXTURE DATA] banner on the page)
- `39-sign-in-1440x900.png` | route `/ (signed out, owner exists)` | 1440x900 | Sign-in after Sign out: signed-out notice, username and password | data: real screen, no data
- `40-sign-in-390x844.png` | route `/ (signed out, owner exists)` | 390x844 | Sign-in on a phone | data: real screen, no data
- `41-sign-in-wrong-password-1440x900.png` | route `/ (signed out, owner exists)` | 1440x900 | Sign-in after a wrong password: one message for any mismatch | data: real screen, no data

## What is not captured, and why

- **Authenticator key and recovery-code screens, and the first-run account setup form**: deliberately left out (they show secrets, even if throwaway).
- **Real approval and operation flow on a real server**: no real server accepts changes in fixture mode, so plans and operations are the built-in sample states (images 13 to 20). They are the same screens the real API feeds; they are not a recording of a live approval. Approving, a lost-response retry and a plan "changed" refresh exist (`/plans/fixture-plan-lost`, `/plans/fixture-plan-changed`) but are not in this set.
- **Findings on the real page** (image 10) come from the invented servers and show the scheduler as unavailable, because fixture mode runs no checks. The richer state set is image 11 and 12 (sample data).
- **Stale** servers: the app shows stale and partial data as "Historical", dashed borders and an expired freshness line (see Fixture C in image 3 and the 20-server views). There is no separate "stale" fixture beyond that.
- **Loading** states are not included (they are brief). Image 27 shows the API-down state instead.
- **Connect flow steps 3 and 4** (access key line, first check) and the real, non-sample Connect form are not included. Step 1 and the host-key step are. The fingerprint in the compared image is a made-up sample.
- **Keyboard focus rings and hover states**: not photographed; the pages are static screenshots.
- **Dark mode**: none exists in Stage A (light only).
- **Assistant with a live AI model**: not captured by design (`AI_PROVIDER=none`). The panel shows the "Deterministic" label.
- **A real phone and screen readers**: not tested here; the 390x844 images are a desktop browser at phone width.
