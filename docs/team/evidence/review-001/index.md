# Founder review pack 001

Screenshots of every screen and key state, each at **1440×900** (desktop) and **390×844** (phone). Taken in a real browser from the designer worktree (`feat/designer/t067`) on 2026-11-18.

## Read this first

- **Nothing here is a real server of yours.** Every server, plan, operation, finding, activity record and baseline in these images is invented sample data, and each of those screens carries the `[FIXTURE DATA]` banner (or an invented "Fixture …" name) in the image. The sign-in, setup and recovery-code screens are the real screens running against a throw-away test copy of the API; the account, the codes and the QR key in them were created for the test and mean nothing.
- **No image shows live data.** The live screens (Overview, server detail, plan and operation pages on the founder's real servers) are not included because they would show real server names and facts. Where an image says "fixture", the screen itself is real but its data is synthetic.
- The yellow "Clock not checked" banner appears on most images because the test API runs in fixture mode, which does not check its own clock. Image 06 shows the red-flag version of the same banner, when ServrSit's clock is wrong.
- Long pages are shown whole. Pages taller than 3000 px are cut at 3000 px and the line says so.

## Images

Format: `file`: what it shows. Data: ...

- `01-sign-in-1440.png`: Sign-in: username and password, with the first-time setup link. Data: live UI on a local test API (no real servers, no real data).
- `02-setup-account-1440.png`: First-run setup, step 1: setup token, username, password with strength hint (filled in). Data: live UI on a local test API (no real servers, no real data).
- `03-setup-authenticator-1440.png`: First-run setup, step 2: QR code drawn in the browser, the key as text, code confirmation. Data: live UI on a local test API (no real servers, no real data).
- `04-recovery-codes-1440.png`: First-run setup, step 3: the ten recovery codes, shown once (sample codes from the test account). Data: live UI on a local test API (no real servers, no real data).
- `05-overview-1440.png`: Overview with four sample servers: cards, needs-attention list, recent activity, Ask bar. Data: [FIXTURE] (the test API runs in fixture mode: servers A to D are invented).
- `06-overview-clock-untrusted-1440.png`: Overview while ServrSit's own clock is wrong: persistent banner, ages marked with ≈, approvals paused. Data: [FIXTURE] (the clock state is injected into sample data).
- `07-overview-empty-1440.png`: Overview with no servers: "Let's meet your first server." and one action. Data: [FIXTURE].
- `08-overview-compact-20-1440.png`: Overview with 20 servers in the compact list, sorted by what needs attention. Data: [FIXTURE] (20 invented servers).
- `09-server-detail-1440.png`: Server detail: status, findings, resources, Care (pending updates, reboot) and read-only Settings. Data: [FIXTURE] (invented server shown through the real page; its data is synthetic).
- `10-connect-1-meet-1440.png`: Connect a server, step 1: name, address, port, user, role, production (Not sure selected, with its note). Data: [FIXTURE].
- `11-connect-2-verify-1440.png`: Connect a server, step 2: the owner's fingerprint matches what ServrSit sees; the independent-source confirmation is ticked. Data: [FIXTURE].
- `12-connect-3-access-1440.png`: Connect a server, step 3: inspect-only access and the public key line to add (no private key or password field). Data: [FIXTURE].
- `13-connect-4-first-check-1440.png`: Connect a server, step 4: first check finished partly (one step not available), schedule choice, Add button. Data: [FIXTURE].
- `14-plan-writes-off-1440.png`: Plan review for a real host with changes switched off: clear blocked state, no approve button. Data: [FIXTURE].
- `15-plan-production-1440.png`: Plan review for a production server: two unticked acknowledgements and a disabled, specific approve button. Data: [FIXTURE].
- `16-plan-expired-1440.png`: Plan review after the 15-minute expiry: reason shown, Refresh plan offered, no approve button. Data: [FIXTURE].
- `17-operation-running-1440.png`: Operation running: vertical steps with times, 'Stop after this safe step' (disabled, with reason), no percentage. Data: [FIXTURE].
- `18-operation-succeeded-reboot-1440.png`: Operation completed and verified, with a reboot still needed: receipt of changed, verified, still needed, could not verify. Data: [FIXTURE].
- `19-operation-partial-1440.png`: Operation partly succeeded: changed and unverified packages separated. Data: [FIXTURE].
- `20-operation-unknown-1440.png`: Operation outcome unknown: 'Result not yet confirmed', Recheck outcome, conflicting changes unavailable. Data: [FIXTURE].
- `21-findings-1440.png`: Findings: new, acknowledged, snoozed, resolved and 'previously detected, not rechecked', with Acknowledge and Snooze. Data: [FIXTURE].
- `22-activity-1440.png`: Activity: filters, search, records by day, and the export panel. Data: [FIXTURE].
- `23-baselines-compare-1440.png`: Baseline comparison: Matches, Missing, Conflict, Different by design, Mark intentional. Data: [FIXTURE].
- `24-settings-1440.png`: Settings: schedules, AI and data, server access with Disconnect. Data: [FIXTURE].

- `01-sign-in-390.png`: Sign-in: username and password, with the first-time setup link. Data: live UI on a local test API (no real servers, no real data).
- `02-setup-account-390.png`: First-run setup, step 1: setup token, username, password with strength hint (filled in). Data: live UI on a local test API (no real servers, no real data).
- `03-setup-authenticator-390.png`: First-run setup, step 2: QR code drawn in the browser, the key as text, code confirmation. Data: live UI on a local test API (no real servers, no real data).
- `04-recovery-codes-390.png`: First-run setup, step 3: the ten recovery codes, shown once (sample codes from the test account). Data: live UI on a local test API (no real servers, no real data).
- `05-overview-390.png`: Overview with four sample servers: cards, needs-attention list, recent activity, Ask bar. Data: [FIXTURE] (the test API runs in fixture mode: servers A to D are invented).
- `06-overview-clock-untrusted-390.png`: Overview while ServrSit's own clock is wrong: persistent banner, ages marked with ≈, approvals paused. Data: [FIXTURE] (the clock state is injected into sample data).
- `07-overview-empty-390.png`: Overview with no servers: "Let's meet your first server." and one action. Data: [FIXTURE].
- `08-overview-compact-20-390.png`: Overview with 20 servers in the compact list, sorted by what needs attention (page is 5476px tall; the image shows the first 3000px). Data: [FIXTURE] (20 invented servers).
- `09-server-detail-390.png`: Server detail: status, findings, resources, Care (pending updates, reboot) and read-only Settings. Data: [FIXTURE] (invented server shown through the real page; its data is synthetic).
- `10-connect-1-meet-390.png`: Connect a server, step 1: name, address, port, user, role, production (Not sure selected, with its note). Data: [FIXTURE].
- `11-connect-2-verify-390.png`: Connect a server, step 2: the owner's fingerprint matches what ServrSit sees; the independent-source confirmation is ticked. Data: [FIXTURE].
- `12-connect-3-access-390.png`: Connect a server, step 3: inspect-only access and the public key line to add (no private key or password field). Data: [FIXTURE].
- `13-connect-4-first-check-390.png`: Connect a server, step 4: first check finished partly (one step not available), schedule choice, Add button. Data: [FIXTURE].
- `14-plan-writes-off-390.png`: Plan review for a real host with changes switched off: clear blocked state, no approve button. Data: [FIXTURE].
- `15-plan-production-390.png`: Plan review for a production server: two unticked acknowledgements and a disabled, specific approve button. Data: [FIXTURE].
- `16-plan-expired-390.png`: Plan review after the 15-minute expiry: reason shown, Refresh plan offered, no approve button. Data: [FIXTURE].
- `17-operation-running-390.png`: Operation running: vertical steps with times, 'Stop after this safe step' (disabled, with reason), no percentage. Data: [FIXTURE].
- `18-operation-succeeded-reboot-390.png`: Operation completed and verified, with a reboot still needed: receipt of changed, verified, still needed, could not verify. Data: [FIXTURE].
- `19-operation-partial-390.png`: Operation partly succeeded: changed and unverified packages separated. Data: [FIXTURE].
- `20-operation-unknown-390.png`: Operation outcome unknown: 'Result not yet confirmed', Recheck outcome, conflicting changes unavailable. Data: [FIXTURE].
- `21-findings-390.png`: Findings: new, acknowledged, snoozed, resolved and 'previously detected, not rechecked', with Acknowledge and Snooze. Data: [FIXTURE].
- `22-activity-390.png`: Activity: filters, search, records by day, and the export panel. Data: [FIXTURE].
- `23-baselines-compare-390.png`: Baseline comparison: Matches, Missing, Conflict, Different by design, Mark intentional. Data: [FIXTURE].
- `24-settings-390.png`: Settings: schedules, AI and data, server access with Disconnect (page is 3065px tall; the image shows the first 3000px). Data: [FIXTURE].

## Things to look at

1. Does the Overview (05 to 08) tell you what needs attention without a headline? The old headline is gone by your decision.
2. Plan review (14 to 16): can you tell the target, the scope, the risk and what approving permits? Is the blocked state for real hosts clear?
3. Operation pages (17 to 20): is the difference between "completed and verified", "some work completed" and "result not yet confirmed" obvious?
4. Mobile (the 390 images): anything clipped, too small to tap, or too dense?

Not covered here: live data, screen-reader behaviour, a real phone. See `docs/team/handoff-designer-*.md` for what was checked in each task.