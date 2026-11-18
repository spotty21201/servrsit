# Founder review pack 002

Screenshots of every screen and key state at **1440×900** (desktop) and **390×844** (phone), taken in a real browser from the designer worktree (`feat/designer/t080`, which includes everything on `integration/next` up to T-079) on 2026-11-18. Replaces pack 001.

## Read this first

- **Nothing here is a real server of yours.** The test API ran in fixture mode with a throw-away database. Its servers, findings, activity and the account, recovery codes and QR key in the sign-in images were created for the test and mean nothing. Screens carry the `[FIXTURE DATA]` banner or an invented "Fixture …" name.
- **What changed since pack 001:** the sign-in flow is complete (images 01 to 09: first-run setup, sign out, wrong password, code step, wrong code, recovery code). Findings, Activity, Baselines, Settings, Connect, Plan review and Operation now run on the real API clients. The "real screen" images show what the API actually answers in fixture mode, including refusals. Each real screen is paired with a fixture state where the real API cannot show it.
- **Real screens in fixture mode** (marked "real screen" below): Findings (29), Activity (31), Baselines (33), Settings (36) and Connect (15). The API refuses some things in this mode and the screen shows the refusal: the address is outside every enrolled route (15), the server cannot be read (33), checks cannot be paused ("Fixture mode: no checks run"). The Baselines list (33) names Timika, Nabire, Sentani and Merauke because the fixture-mode API lists them; nothing was read from them.
- **Plan review and Operation pages (20 to 28, 38 to 41) now use the real care client for real ids.** The images show the `/plans/fixture-…` and `/operations/fixture-…` states, because a real server cannot produce them yet (changes are switched off on every real host). A plan or operation created by the real API opens on the same pages (checked in a browser for packages, restart, reboot and directory plans). The plan pages now cover four kinds of change, each its own approval: packages (20 to 22), directories (23, 24), a service restart (38) and a reboot (39). Production plans show the two confirmations with their exact fixed text.
- The yellow "Clock not checked" banner appears on most images because fixture mode does not check ServrSit's own clock. Image 11 shows the warning version, when the clock is wrong.
- At 1440 the Overview fits the window; its lists scroll inside labelled regions. Other long pages are shown whole. Pages taller than 3000 px are cut at 3000 px and the line says so.
- Activity (31) has no mode of its own in the API, so its fixture label comes from `/api/fleet`. Its server filter shows "Removed server" for the fixture findings; that is the API's text and is reported to Coder.

## Images, desktop (1440)

- `01-sign-in-first-run-1440.png`: Signed out: sign-in with the first-time setup link. Data: live UI on a local test API (no real servers, no real data).
- `02-setup-account-1440.png`: First-run setup, step 1: setup token, username, password with strength hint (filled in). Data: live UI on a local test API (no real servers, no real data).
- `03-setup-authenticator-1440.png`: First-run setup, step 2: QR code drawn in the browser, the key as text, code confirmation. Data: live UI on a local test API (no real servers, no real data).
- `04-recovery-codes-1440.png`: First-run setup, step 3: the ten recovery codes, shown once (sample codes from the test account). Data: live UI on a local test API (no real servers, no real data).
- `05-signed-out-1440.png`: After Sign out: the sign-in screen with the signed-out notice. Data: live UI on a local test API (no real servers, no real data).
- `06-sign-in-wrong-password-1440.png`: Sign-in with a wrong password: one message for every kind of mismatch, no hint which part was wrong. Data: live UI on a local test API (no real servers, no real data).
- `07-sign-in-code-1440.png`: Sign-in, second step: the 6-digit authenticator code (there is no skip). Data: live UI on a local test API (no real servers, no real data).
- `08-sign-in-wrong-code-1440.png`: Sign-in with a wrong authenticator code: refused with a plain message. Data: live UI on a local test API (no real servers, no real data).
- `09-sign-in-recovery-1440.png`: Sign-in with a recovery code instead of the authenticator. Data: live UI on a local test API (no real servers, no real data).
- `10-overview-1440.png`: Overview with four sample servers: cards, needs-attention list, recent activity, Ask bar. Data: [FIXTURE] (the test API runs in fixture mode: servers A to D are invented).
- `11-overview-clock-untrusted-1440.png`: Overview while ServrSit's own clock is wrong: persistent banner, ages marked with ≈, approvals paused. Data: [FIXTURE] (the clock state is injected into sample data).
- `12-overview-empty-1440.png`: Overview with no servers: "Let's meet your first server." and one action. Data: [FIXTURE].
- `13-overview-compact-20-1440.png`: Overview with 20 servers in the compact list, sorted by what needs attention. Data: [FIXTURE] (20 invented servers).
- `14-server-detail-1440.png`: Server detail: status, findings, resources, Care (pending updates, reboot) and read-only Settings. Data: [FIXTURE] (invented server shown through the real page; its data is synthetic).
- `15-connect-real-rejected-1440.png`: Connect a server on the real flow: the API refuses a private address outside every enrolled route, and the screen shows its reason. Data: live UI on the local test API; the address is made up and nothing was connected.
- `16-connect-1-meet-1440.png`: Connect a server (fixture walk-through), step 1: name, address, port, user, role, production (Not sure selected, with its note). Data: [FIXTURE].
- `17-connect-2-verify-1440.png`: Connect a server, step 2: the owner's fingerprint matches what ServrSit sees; the independent-source confirmation is ticked. Data: [FIXTURE].
- `18-connect-3-access-1440.png`: Connect a server, step 3: inspect-only access and the public key line to add (no private key or password field). Data: [FIXTURE].
- `19-connect-4-first-check-1440.png`: Connect a server, step 4: first check finished partly (one step not available), schedule choice, Add button. Data: [FIXTURE].
- `20-plan-writes-off-1440.png`: Plan review for a real host with changes switched off: clear blocked state, no approve button. Data: [FIXTURE].
- `21-plan-production-1440.png`: Plan review for a production server: two unticked acknowledgements and a disabled, specific approve button. Data: [FIXTURE].
- `22-plan-expired-1440.png`: Plan review after the 15-minute expiry: reason shown, Refresh plan offered, no approve button. Data: [FIXTURE].
- `23-plan-prepare-1440.png`: Plan review for preparing a server (create missing directories): what it creates, what it never touches. Data: [FIXTURE].
- `24-plan-prepare-blocked-1440.png`: The same preparing plan on a real host: blocked because changes are switched off. Data: [FIXTURE].
- `25-operation-running-1440.png`: Operation running: vertical steps with times, 'Stop after this safe step' (disabled, with reason), no percentage. Data: [FIXTURE].
- `26-operation-succeeded-reboot-1440.png`: Operation completed and verified, with a reboot still needed: receipt of changed, verified, still needed, could not verify. Data: [FIXTURE].
- `27-operation-partial-1440.png`: Operation partly succeeded: changed and unverified packages separated. Data: [FIXTURE].
- `28-operation-unknown-1440.png`: Operation outcome unknown: 'Result not yet confirmed', Recheck outcome, conflicting changes unavailable. Data: [FIXTURE].
- `29-findings-real-1440.png`: Findings, real screen: the API's findings with the scheduler unavailable in fixture mode (never an all-clear). Data: real screen on the local test API in fixture mode: the [FIXTURE DATA] banner is the API's own answer.
- `30-findings-fixture-paused-1440.png`: Findings (fixture): new, acknowledged, snoozed, resolved and 'previously detected, not rechecked'; checks paused with Resume checks. Data: [FIXTURE].
- `31-activity-real-1440.png`: Activity, real screen: records the API wrote, filters, search, export panel. Data: real screen on the local test API in fixture mode: the [FIXTURE DATA] banner is the API's own answer.
- `32-activity-fixture-export-1440.png`: Activity (fixture): all result types including a simulated record, with a finished export, its expiry and download button. Data: [FIXTURE].
- `33-baselines-real-1440.png`: Baselines, real screen: choosing a reference; in fixture mode the API refuses to read a server and the screen says so. Data: real screen on the local test API in fixture mode: the [FIXTURE DATA] banner is the API's own answer.
- `34-baselines-fixture-compare-1440.png`: Baseline comparison (fixture): Matches, Missing, Conflict, Different by design, Mark intentional. Data: [FIXTURE].
- `35-baselines-fixture-setup-1440.png`: Baselines (fixture), step 4: the plan creates missing directories only; missing packages are listed as not included. Data: [FIXTURE].
- `36-settings-real-1440.png`: Settings, real screen: schedule, AI (not configured, so it stays off), retention, server access. Data: real screen on the local test API in fixture mode: the [FIXTURE DATA] banner is the API's own answer.
- `37-settings-fixture-blocked-1440.png`: Settings (fixture): Disconnect is blocked while an operation on the server is unfinished; only Close is offered. Data: [FIXTURE].
- `38-plan-restart-1440.png`: Plan review for restarting one service: names the unit, says it is not a reboot, verified by a new start time. Data: [FIXTURE].
- `39-plan-reboot-production-1440.png`: Plan review for rebooting a production server: its own approval, the two exact confirmations, the whole-machine impact. Data: [FIXTURE].
- `40-operation-reboot-running-1440.png`: Operation: a reboot in progress. ServrSit waits for the server to answer again and does not call silence a failure. Data: [FIXTURE].
- `41-operation-directories-partial-1440.png`: Operation: directory creation partly verified, each path listed with its owner and mode. Data: [FIXTURE].

## Images, phone (390)

- `01-sign-in-first-run-390.png`: Signed out: sign-in with the first-time setup link. Data: live UI on a local test API (no real servers, no real data).
- `02-setup-account-390.png`: First-run setup, step 1: setup token, username, password with strength hint (filled in). Data: live UI on a local test API (no real servers, no real data).
- `03-setup-authenticator-390.png`: First-run setup, step 2: QR code drawn in the browser, the key as text, code confirmation. Data: live UI on a local test API (no real servers, no real data).
- `04-recovery-codes-390.png`: First-run setup, step 3: the ten recovery codes, shown once (sample codes from the test account). Data: live UI on a local test API (no real servers, no real data).
- `05-signed-out-390.png`: After Sign out: the sign-in screen with the signed-out notice. Data: live UI on a local test API (no real servers, no real data).
- `06-sign-in-wrong-password-390.png`: Sign-in with a wrong password: one message for every kind of mismatch, no hint which part was wrong. Data: live UI on a local test API (no real servers, no real data).
- `07-sign-in-code-390.png`: Sign-in, second step: the 6-digit authenticator code (there is no skip). Data: live UI on a local test API (no real servers, no real data).
- `08-sign-in-wrong-code-390.png`: Sign-in with a wrong authenticator code: refused with a plain message. Data: live UI on a local test API (no real servers, no real data).
- `09-sign-in-recovery-390.png`: Sign-in with a recovery code instead of the authenticator. Data: live UI on a local test API (no real servers, no real data).
- `10-overview-390.png`: Overview with four sample servers: cards, needs-attention list, recent activity, Ask bar. Data: [FIXTURE] (the test API runs in fixture mode: servers A to D are invented).
- `11-overview-clock-untrusted-390.png`: Overview while ServrSit's own clock is wrong: persistent banner, ages marked with ≈, approvals paused. Data: [FIXTURE] (the clock state is injected into sample data).
- `12-overview-empty-390.png`: Overview with no servers: "Let's meet your first server." and one action. Data: [FIXTURE].
- `13-overview-compact-20-390.png`: Overview with 20 servers in the compact list, sorted by what needs attention (page is 5524px tall; the image shows the first 3000px). Data: [FIXTURE] (20 invented servers).
- `14-server-detail-390.png`: Server detail: status, findings, resources, Care (pending updates, reboot) and read-only Settings. Data: [FIXTURE] (invented server shown through the real page; its data is synthetic).
- `15-connect-real-rejected-390.png`: Connect a server on the real flow: the API refuses a private address outside every enrolled route, and the screen shows its reason. Data: live UI on the local test API; the address is made up and nothing was connected.
- `16-connect-1-meet-390.png`: Connect a server (fixture walk-through), step 1: name, address, port, user, role, production (Not sure selected, with its note). Data: [FIXTURE].
- `17-connect-2-verify-390.png`: Connect a server, step 2: the owner's fingerprint matches what ServrSit sees; the independent-source confirmation is ticked. Data: [FIXTURE].
- `18-connect-3-access-390.png`: Connect a server, step 3: inspect-only access and the public key line to add (no private key or password field). Data: [FIXTURE].
- `19-connect-4-first-check-390.png`: Connect a server, step 4: first check finished partly (one step not available), schedule choice, Add button. Data: [FIXTURE].
- `20-plan-writes-off-390.png`: Plan review for a real host with changes switched off: clear blocked state, no approve button. Data: [FIXTURE].
- `21-plan-production-390.png`: Plan review for a production server: two unticked acknowledgements and a disabled, specific approve button. Data: [FIXTURE].
- `22-plan-expired-390.png`: Plan review after the 15-minute expiry: reason shown, Refresh plan offered, no approve button. Data: [FIXTURE].
- `23-plan-prepare-390.png`: Plan review for preparing a server (create missing directories): what it creates, what it never touches. Data: [FIXTURE].
- `24-plan-prepare-blocked-390.png`: The same preparing plan on a real host: blocked because changes are switched off. Data: [FIXTURE].
- `25-operation-running-390.png`: Operation running: vertical steps with times, 'Stop after this safe step' (disabled, with reason), no percentage. Data: [FIXTURE].
- `26-operation-succeeded-reboot-390.png`: Operation completed and verified, with a reboot still needed: receipt of changed, verified, still needed, could not verify. Data: [FIXTURE].
- `27-operation-partial-390.png`: Operation partly succeeded: changed and unverified packages separated. Data: [FIXTURE].
- `28-operation-unknown-390.png`: Operation outcome unknown: 'Result not yet confirmed', Recheck outcome, conflicting changes unavailable. Data: [FIXTURE].
- `29-findings-real-390.png`: Findings, real screen: the API's findings with the scheduler unavailable in fixture mode (never an all-clear). Data: real screen on the local test API in fixture mode: the [FIXTURE DATA] banner is the API's own answer.
- `30-findings-fixture-paused-390.png`: Findings (fixture): new, acknowledged, snoozed, resolved and 'previously detected, not rechecked'; checks paused with Resume checks. Data: [FIXTURE].
- `31-activity-real-390.png`: Activity, real screen: records the API wrote, filters, search, export panel. Data: real screen on the local test API in fixture mode: the [FIXTURE DATA] banner is the API's own answer.
- `32-activity-fixture-export-390.png`: Activity (fixture): all result types including a simulated record, with a finished export, its expiry and download button. Data: [FIXTURE].
- `33-baselines-real-390.png`: Baselines, real screen: choosing a reference; in fixture mode the API refuses to read a server and the screen says so. Data: real screen on the local test API in fixture mode: the [FIXTURE DATA] banner is the API's own answer.
- `34-baselines-fixture-compare-390.png`: Baseline comparison (fixture): Matches, Missing, Conflict, Different by design, Mark intentional. Data: [FIXTURE].
- `35-baselines-fixture-setup-390.png`: Baselines (fixture), step 4: the plan creates missing directories only; missing packages are listed as not included. Data: [FIXTURE].
- `36-settings-real-390.png`: Settings, real screen: schedule, AI (not configured, so it stays off), retention, server access (page is 3387px tall; the image shows the first 3000px). Data: real screen on the local test API in fixture mode: the [FIXTURE DATA] banner is the API's own answer.
- `37-settings-fixture-blocked-390.png`: Settings (fixture): Disconnect is blocked while an operation on the server is unfinished; only Close is offered (page is 3913px tall; the image shows the first 3000px). Data: [FIXTURE].
- `38-plan-restart-390.png`: Plan review for restarting one service: names the unit, says it is not a reboot, verified by a new start time. Data: [FIXTURE].
- `39-plan-reboot-production-390.png`: Plan review for rebooting a production server: its own approval, the two exact confirmations, the whole-machine impact. Data: [FIXTURE].
- `40-operation-reboot-running-390.png`: Operation: a reboot in progress. ServrSit waits for the server to answer again and does not call silence a failure. Data: [FIXTURE].
- `41-operation-directories-partial-390.png`: Operation: directory creation partly verified, each path listed with its owner and mode. Data: [FIXTURE].

## Things to look at

1. Sign-in (01 to 09): is each failure message clear without telling an attacker which part was wrong? Is the recovery-code route easy to find?
2. Overview (10 to 13): does it tell you what needs attention without a headline? Does the compact list (13) hold up at 20 servers?
3. Real versus fixture pairs (29/30, 31/32, 33 to 35, 36/37): do the refusals read as honest, and does the fixture banner make it obvious which is which?
4. Plan review (20 to 24, 38, 39): can you tell the target, scope, risk and what approving permits? Is the blocked state for real hosts clear? Images 23 and 24 show a plan that creates directories only and leaves existing paths alone. Images 38 and 39 are the restart and reboot plans: is it obvious that a reboot is the whole machine and a separate approval?
5. Operations (25 to 28, 40, 41): is a reboot in progress (40) clear that silence from the server is not failure? Does the directories receipt (41) say which path did not match?
6. Mobile (390 images): anything clipped, too small to tap or too dense?

Not covered: live data, screen-reader behaviour, a real phone. Checks per task are in `docs/team/handoff-designer-*.md`.
