# Test Report: release candidate `integration/next` (24cc9b5): T-076 findings and full regression

**Tester:** Kiro Tester  
**Branch:** `feat/tester/next`, from `integration/next` **`24cc9b5`**. It contains T-053/T-066 (owner login), T-054 to T-058 (care gaps), T-069 (registration), T-076 (findings), and the integration fixes `fa28545` and ADR-019. It also carries the newest copy of every one of my suites, which were spread over five tester branches.  
**Spec:** PRD FR-19, FR-20; UX Spec 13.1, 13.2; plus each earlier suite's own sources.  
**Safety:** no real host was contacted, no AI call was metered (budget still 9 of 10), no product file was changed (mutants were temporary and reverted, and `git status` confirms only test files changed).

## Result (first run, 24cc9b5): FAIL as a release candidate, on one blocker (D-N1). **Superseded by section 7: PASS at `a9b461c`.**

| Area | Result |
|---|---|
| **T-076 findings and scheduler** (new, 21 tests) | **20 pass, 0 fail, 1 `todo` (D-X2)** |
| Whole regression, API side | **All green** except the known CL-09a (T-059) |
| Whole repo `pnpm test` | **592 pass, 0 fail** |
| `pnpm -r typecheck` and web build | **0 errors**, build succeeds |
| **Web app on the release candidate** | **Blocker D-N1: there is no way to sign in.** Designer's T-065 login screens are not merged, and every `/api` route needs a session. |

## 1. T-076 findings, from FR-20 and UX 13.1/13.2

**Harness.** The real `buildServer` (live mode, real owner session), the real `FindingTracker`, finding and settings stores, routes and a real `FleetService`. Only the collector is replaced. It builds **real observations with the product's own `buildObservation`** from collector output I control: disk %, a failed unit, a disk check that cannot run, or no connection. The config is synthetic with two fake hosts. The scheduler is driven tick by tick, and a tick runs a pass only while the product's own timer exists, because pause clears that timer. A process guard recorded **0** process, socket or DNS attempts.

| Requirement (source) | Test | Result |
|---|---|---|
| Disk warning at 85 %, critical at 95 %, only when sustained across two successful checks (FR-20 defaults) | FN-01 | **PASS.** One check at 90 % is advisory only; the second makes a warning; 97 % twice escalates the **same** record to critical. |
| Repeated detections update one finding (FR-20, UX 13.1) | FN-02, FN-03 | **PASS.** Ten more detections: one record, same id, first-observed kept, last-observed advanced. Two mounts, two servers and a failed unit stay distinct. |
| **Acknowledgement is not resolution** (FR-20, UX 13.1) | FN-10, FN-26 | **PASS.** Stays open, keeps being updated, keeps its acknowledgement; acknowledging twice is harmless; an acknowledged and snoozed finding still resolves when a check shows recovery. |
| **Snooze changes timing only** (UX 13.1) | FN-11 | **PASS.** `snoozedUntil` is exactly 1 h ahead; a detection inside the hour keeps it snoozed; after the hour it is `new` again on the same record. Only `1h`, `1d` and `1w` are accepted. |
| Resolved findings cannot be acknowledged or snoozed; bad ids are clean 4xx | FN-12 | **PASS** (409 `NOT_ALLOWED`). Very long ids: D-X2. |
| **Resolution needs evidence** (UX 13.1: "states the observation that established recovery") | FN-20 | **PASS.** Resolved only by a fresh successful check that covered the disk; `resolvedAt` equals that check's time; `resolvedBy` names it. |
| **"Previously detected, not rechecked", not "Resolved"** (UX 13.1) | FN-21, FN-22, FN-23 | **PASS.** `not-rechecked`, never resolved, when the server is unreachable, when the disk check itself failed although the server answered, and after 6 h with no check. |
| Not-rechecked, then seen again, then recovered | FN-24 | **PASS.** Back to open on the **same** record, then resolved by a later good check. |
| A recurrence after resolution is a new record; the resolved one keeps its evidence (7-day window) | FN-25 | **PASS.** Hidden after 8 days. |
| Unreachable finding after two failed scheduled checks (FR-20 defaults) | FN-27 | **PASS.** One failure: no finding. Two: one finding. A successful contact resolves it. |
| **Paused monitoring is not an all-clear; resume runs one current check, no backlog** (UX 13.2, FR-19) | FN-30 | **PASS.** Eight missed ticks ran 0 checks and resolved nothing; the status says "paused" with the reason; resume ran **exactly one check per server (2 for 2)**, not 8. |
| Stage A says external alerts are unavailable (FR-20) | FN-31 | **PASS** |
| Session and CSRF on all six routes | FN-32 | **PASS** (401, 403; a refused request changes nothing) |
| No raw server text in summaries; fixture findings never persisted, scheduler "unavailable" in fixture mode | FN-33, FN-34 | **PASS** |

**Mutation checks (temporary, reverted):**

| Mutant | Result |
|---|---|
| Resolve even when the covering check was unavailable | Caught by FN-22 |
| No dedup: every detection makes a new record | Caught by 16 tests |
| Resolve even when the server could not be checked or the data is old | **Survives.** While a server cannot be checked, the fleet snapshot keeps its last findings, so the tracker marks them not-rechecked before it reaches that check. In the states I could produce the check is not reachable, so I do not claim it is guarded. |

**Not covered:**
- Severity *de*-escalation.
- Inode, time-skew, reboot-required and pending-update rules. Only disk, failed unit and unreachable were driven.
- Persistence of the pause across a restart.
- The web findings screen on real data (D-N1).

## 2. Full regression on the release candidate

| Suite | Result | Compared with the last report |
|---|---|---|
| 401 sweep (every registered `/api` route, now including T-069 and T-076) | **7/7** | same |
| Login: scenarios 37, extra 21, T-066 guards 12, self-check 29, TOTP 5 | **all pass** | same |
| **ZT-01 real-host gate** | **13/13** | the 4 T-076 routes were reviewed and added (below) |
| static-config | 3/3 | same |
| Care loop | **41/42** (CL-09a, T-059) | same as `care-loop-002` |
| Care-loop reference model | 28/28 | same |
| Registration | **35 pass, 1 NOT RUN, 3 `todo`** (D-R1, D-R2, D-R3) | same as `registration-001` §6 |
| Registration static, SSH oracle | 2/2, 2/2 | same |
| **AI: fact check** | **58/58** | **was 47/58** |
| AI: coverage probes | **6/6** | **was 0/6** |
| AI: owner context | **21/21** | **was 20/21** (secret-detector blind spots) |
| AI: pipeline | **11/11** | **was 10/11** |
| AI: stored real answers replayed, and the real-call file (replay only) | 10/10, 11/11 | real answers are no longer wrongly discarded |
| Findings (new) | 20 pass, 1 `todo` | new |
| `pnpm test` (all packages) | **592/592** | was 516 |
| `pnpm -r typecheck`, web build | **pass** | web build fixed, because T-065 is not in this branch (see D-N1) |

**T-064 closed my earlier AI findings.** The secret-detector gaps (F1), the false rejections of correct answers (F2) and the coverage gaps (F3) all pass now. Tone and the truncated-reply check (F4, F5) are covered by the pipeline suite.

**ZT-01 review of the T-076 routes:**
- `POST /api/findings/:id/acknowledge` and `/snooze` change a finding record only.
- `POST /api/scheduler/pause` stops background checks.
- `POST /api/scheduler/resume` starts the existing **read-only** checks of the configured servers. On a real installation that means the four real servers, the same collection that already runs.

None of them has a write path. The inventory still fails if any unreviewed mutating route appears.

**My fixture drift, fixed:** the AI suites first failed 79 tests with `Cannot read properties of undefined (reading 'status')`. My synthetic observations predated T-061/T-062 and lacked `host.clock`, `packages.pendingOutsideUbuntu` and `packages.metadataClock`. The product's `buildObservation` always sets them, so this was my fixture, not a product defect.

## 3. Findings

| ID | Severity | Finding |
|---|---|---|
| **D-N1** | **Critical (release blocker)** | **The release-candidate web app cannot sign in, so it shows nothing.** `integration/next` contains the owner-auth API (every `/api` route returns 401 without a session) but none of Designer's web work: not T-065 (sign-in, setup, session states), nor T-060's successors T-067 to T-075. Commits `304ff87`, `bff8ba8` and `8062beb` are not ancestors. Rendered against the real 401 behaviour, the app makes one `GET /api/fleet`, receives 401, and shows "Couldn't load your servers. Not signed in, or not allowed to view the fleet" with only "Try again", and no sign-in form. **Merge `feat/designer/t067` (with T-065) before calling this a candidate**, then re-run the web suites. Also expect D-X1 (the `CLOCK_UNTRUSTED` compile break) to return on that merge unless the T-072 fix travels with it; it did on Designer's branch (ST-24 passes there). |
| D-X2 | Low | **App-wide: a very long path id gets the web framework's internal 400 body, which echoes the URL** (`{"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH","message":"'/api/findings/aaaa…"}`). The same as D-R1 on registration, so one fix in the server's error handler covers both. Guard: FN-12b and SR-53b (`todo`). |
| O-N1 | Observation | The API accepts acknowledging a `not-rechecked` finding (by design, per the handoff); Designer's stub refuses it. One of them should change so the screen and the API agree. |

## 4. T-077 to T-079

T-077 (activity) is committed on `feat/coder/activity` (`e6cfad4`) but is **not in `integration/next`** yet. T-078 and T-079 are not committed. I will test each from FR-18, FR-21 and the UX 14 export rules when it reaches the release candidate, and append the results here.

## 5. Recommendations

1. **Merge Designer's branch into `integration/next`** (D-N1). It is the only blocker in this report. Then re-run the a11y and web suites against the merged candidate.
2. Fix D-X2/D-R1 once, in the error handler, then D-R3 (registration key left on disk).
3. Decide O-N1 with the Designer.

## 6. Files

```
tests/e2e/findings/findings.test.mts            21 tests for T-076 (real tracker, stores, routes, FleetService; guarded)
tests/e2e/care-loop/zt01-real-hosts.test.mts    T-076 routes reviewed into the inventory
tests/e2e/ai-context/support/synthetic.mts      T-061/T-062 observation fields added
tests/e2e/{auth,care-loop,registration,a11y,ai-context}   newest copies gathered onto one branch
docs/team/test-report-next-001.md               this report
```
Run from `apps/api`: `pnpm exec tsx --test --test-timeout=180000 ../../tests/e2e/<suite>/<file>.test.mts`.

---

# 7. Re-run after the Designer merge: `integration/next` at `d06d8ca`, then `a9b461c`

`integration/next` moved twice during this round:
- **`d06d8ca`** adds T-077 (activity and export), T-078 (baselines), T-079 (settings) and **Designer's `feat/designer/t080` (login screens, the D-N1 fix)**.
- **`a9b461c`** adds T-081 (registration fixes) and T-082 (the real care client).

I ran everything at `d06d8ca`, then re-ran the suites the new commits touch at `a9b461c`. My branch `feat/tester/next` is at the merge of `a9b461c`.

## 7.1 Result: PASS as a release candidate. D-N1 is closed. No Critical or High finding is open.

| Area | `d06d8ca` | `a9b461c` |
|---|---|---|
| **Browser sign-in walkthrough** (new) | **9/9** | **9/9** |
| Activity and export (T-077, new) | 10 pass, 2 `todo` (D-AC1, D-AC2) | 10 pass, 2 `todo` |
| Baselines (T-078, new) | **11/11** | **11/11** |
| Findings (T-076) | 20 pass, 1 `todo` (D-X2) | **21/21: D-X2 fixed** |
| Registration | 35 pass, 1 NOT RUN, 3 `todo` | **36 pass**, 1 NOT RUN, 1 `todo` (D-R3). **D-R1 and D-R2 fixed** |
| 401 sweep / ZT-01 / static-config | 7/7, 13/13, 3/3 | 7/7, 13/13 |
| Care loop / reference model | 41/42 (CL-09a, T-059), 28/28 | 41/42 |
| Login suites (37 + 21 + 12 + 29 + 5) | all pass | |
| AI suites (fact check 58, coverage 6, owner context 21, pipeline 11, replays 10, real-call file 11) | all pass; budget still **9 of 10** | |
| a11y suite (jsdom, 59 states) | 143 pass, 0 fail, 16 `todo` (same open items as `ui-a11y-002`) | |
| `pnpm test` (all packages) | **725/725** | **740/740** |
| Typecheck, web build | pass | pass |

## 7.2 Browser sign-in walkthrough (headless Chromium, my own API)

`tests/e2e/a11y/browser/signin-walkthrough.mts` runs everything in **one process that ends when the run ends**:
- **API:** my own instance (`buildServer`, **fixture mode**, a synthetic two-server config, a temp auth database) on a **random loopback port**. Never the founder's `:3001`, and the script refuses that port.
- **Web:** the built web app, served through request interception on `127.0.0.1:5173`, so the real cookies and Origin checks apply.
- **Browser:** headless Chromium.

TOTP codes come from **my own RFC 6238 implementation** (`tests/e2e/auth/support/totp.mts`), not the product's library. axe (WCAG A/AA, contrast on) ran at every step: **0 violations**, **0 console errors**.

| Step | Result |
|---|---|
| First load shows sign-in (title "Sign in · ServrSit") | PASS |
| Setup with the token my instance handed out; the authenticator key is shown as text (32 characters) and as a QR code | PASS |
| Confirm with my own TOTP code; **10 recovery codes**; "Continue" is unavailable until the box is ticked, and **pressing it by keyboard does nothing** | PASS |
| Signed in to the overview | PASS |
| Sign out: notice shown, focus on the heading | PASS |
| Sign in with password and my own TOTP code (next 30 s step, because the setup confirmation used the current one) | PASS |
| Sign out, sign in with a **recovery code** | PASS |
| The **same recovery code again** is refused ("That recovery code didn't work. Each code works once.") | PASS |
| A wrong password is refused with a non-disclosing message ("That username and password don't match.") | PASS |

**Evidence:** `docs/team/evidence/next-001/` (7 screenshots and `signin-walkthrough.json`). **The two screens that show the authenticator key and the recovery codes are not captured.** My first run did capture them; I deleted those two files before committing (they belonged to a throwaway instance whose database is gone), and the script now skips them. The script also fails if the key or any recovery code reaches the evidence file.

## 7.3 T-077 activity and export (FR-18, FR-21, UX 14)

Harness: the findings harness from section 1, now shared (`tests/e2e/findings/support/world.mts`).

| Test | Result |
|---|---|
| AC-01 a finding gives an "opened" and a "resolved" record, the latter naming the check | PASS |
| AC-02 health checks recorded with result and coverage; failures as fixed text; no server output | PASS |
| AC-03 filters (type, server, result, period, limit); invalid filters are 400 with the contract body | PASS |
| AC-04 search by server name, any case; a configured secret never appears in the list | PASS |
| **AC-05 export, report and JSON**: states range, time zone (`Asia/Jakarta`) and redaction; timestamps with explicit offsets; **a planted secret (a fake key in a failed-unit name) is not in either file**; downloaded as an attachment; listed persistently | PASS |
| AC-06 expires after exactly 7 days (410 `EXPIRED`, gone from the list); the stored file never changes | PASS |
| AC-07 bad zone, reversed range, unknown format or fields are 400; unknown id 404 | PASS |
| AC-08 session on all routes, CSRF on `POST /api/exports` | PASS |
| AC-09 inspection records pruned after 30 days; finding records kept | PASS |
| **AC-04b search never matches secret contents** | **`todo`: D-AC1** |
| **AC-04c search matches identifiers** | **`todo`: D-AC2** |

**Mutation check:** removing the export's own scrub step leaks nothing. Each record is already scrubbed when it is stored, so this is a second layer and an equivalent mutant in the paths I can drive.

**Harness limit:** I inject my own fleet service, so the product's own "record after every pass" hook (`onPassComplete`) is not exercised. Records are made by its other path, "record before each read of the list", which uses the same recorder. Coder's own tests cover the hook.

## 7.4 T-078 baselines (FR-09, FR-15, UX 12)

| Test | Result |
|---|---|
| **INV-01 the new remote inventory script is read-only.** Only `test`, `find`, `printf` and `awk` (behind the timeout); no redirection, pipe, chaining, substitution, `sudo` or network program; `find` without `-exec`, `-delete` or `-fprint*`; `awk` without `system()`, `getline` or output redirection. The section list is fixed, so a change must be reviewed. | PASS. **Mutant: a redirect in one command is caught.** |
| INV-02 the script sent over SSH contains exactly these commands | PASS |
| INV-03 the product's parser, fed hostile output: `..`, `$(…)` and control characters rejected; at most 500 directories kept; an invalid package name rejected | PASS |
| BL-01 candidates: plain `/srv` directories eligible; world-writable and setgid ones not, each with a reason | PASS |
| BL-02 compare: Matches, Missing and **Conflict** (owner differs, with what was found); **the target is unchanged** | PASS |
| BL-03 "mark intentional" gives Different by design and is recorded in an append-only history; it can be removed; invalid reasons refused | PASS |
| BL-04 **setup plan holds only the missing directories, parents first, as `prepare.directories.v1`**; the conflict and the packages are listed as not included, with reasons; nothing runs | PASS |
| BL-05 a server with writes disabled gets a plan blocked `WRITES_DISABLED` | PASS |
| BL-06 versions (v2 with `baselineId`); names and ids validated | PASS |
| BL-07 session on every route, CSRF on every change | PASS |

**Not run, by design:** the inventory **over SSH**. For registered servers it uses the real process runner with no seam, so my API tests used simulated servers. I did not run the local variant either, because the controller is a real machine. The script is covered by INV-01 to INV-03 instead. **Package installation from a baseline is not implemented** (per the handoff), and BL-04 checks that the plan says so.

## 7.5 ZT-01

Twelve more mutating routes were reviewed, each with a reason in the test:
- **T-077:** `POST /api/exports` uses ServrSit's own records only.
- **T-078:**
  - `POST /api/baselines/:id/compare` (and `GET …/candidates`) run the **read-only** inventory over SSH on the chosen server.
  - Exceptions and baseline saves are records.
  - A setup plan is only a plan, and for real servers it is blocked `WRITES_DISABLED`.
- **T-079:** the schedule and AI settings are records; pause and resume act on the existing read-only checks; AI cannot be switched on without a configured provider.

ZT-01 never calls the inventory routes against the real hosts. The inventory still fails on any unreviewed route.

## 7.6 Findings

| ID | Severity | Status |
|---|---|---|
| D-N1 no sign-in in the web app | Critical | **Closed** (Designer `t080` merged; walkthrough 9/9) |
| D-R1 / D-X2 very long ids got the framework's error body and echoed the URL | Low | **Closed** by T-082's router setting; SR-53b and FN-12b are guards now |
| D-R2 re-registering under the same name did not point to the existing record | Low | **Closed** by T-081; SR-41b is a guard |
| D-R3 an abandoned draft's private key stays on the controller | Medium | **Open** (SR-23b) |
| **D-AC1** | **Low** | **Activity search matches secret contents.** With a secret configured for redaction, the list and the export show it scrubbed, but `?q=<part of the secret>` still returns the records that hold it. Anyone signed in can confirm a guess at a secret. UX 14: "do not use secret contents". Search should run on the scrubbed text. |
| **D-AC2** | **Low** | **Activity search does not match identifiers.** A full server id, a record id and a record-id prefix all find nothing; UX 14 asks for names, titles **and identifiers**. |
| D-N2 | Low (CI) | **`pnpm -r build` failed once in three parallel runs** with `contracts/dist/fleet.d.ts is not a module`. Several packages' `prebuild` hooks rebuild `contracts` at the same time. A sequential build (`--workspace-concurrency=1`) always passes. A CI job running the parallel build will fail at random. |
| O-N2 | Observation | Redaction scrubs **known** secret values only. A token-shaped string that is not configured as a secret (here a fake key in a unit name) appears in the list and the export as it is. That matches the contract ("known secret values"); I note it because the AI path also uses a pattern-based detector and the export does not. |
| O-N1 | Observation | Still open: the API lets you acknowledge a `not-rechecked` finding; the screen does not. |

## 7.7 My own slips this round (caught before reporting)

- **`world(setup)` took the setup function as the mode,** so the server ran without my fleet service, and AC-04/AC-05 showed an empty history. I suspected the product until I had narrowed it down. `world()` now accepts a function as its first argument.
- **The registration binding missed T-081's new `privilegeProbe` seam.** The product's real privilege check then tried `spawn(/usr/bin/ssh)` to my fake `100.64.1.x` addresses. **The process guard blocked every attempt**, so no SSH ran. The binding now injects the product's own `probePrivilegeViaSsh` with the fake `ssh`. I'm glad the guard was there: on this machine `100.64.0.0/10` is the Tailscale range.
- My `seedImported` called the store directly and missed T-081's new `productionStatus` field.
- I captured the two credential screens in the first walkthrough run, then deleted them (7.2).
- INV-01's word check first matched the path `/var/lib/apt/lists` as the program `apt`. It now matches whole words only.

## 7.8 Recommendations

1. **The release candidate is ready on my evidence**, with D-R3 (Medium) the only open item above Low. Fix it or accept it explicitly.
2. Fix D-AC1 (search the scrubbed text) and D-AC2 (match ids). Both are small.
3. Make the build hooks safe for parallel runs, or build sequentially in CI (D-N2).
4. A person still needs to do the screen-reader pass (unchanged from the a11y reports).
