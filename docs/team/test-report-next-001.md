# Test Report: release candidate `integration/next` (24cc9b5): T-076 findings and full regression

**Tester:** Kiro Tester  
**Branch:** `feat/tester/next`, from `integration/next` **`24cc9b5`**. It contains T-053/T-066 (owner login), T-054 to T-058 (care gaps), T-069 (registration), T-076 (findings), and the integration fixes `fa28545` and ADR-019. It also carries the newest copy of every one of my suites, which were spread over five tester branches.  
**Spec:** PRD FR-19, FR-20; UX Spec 13.1, 13.2; plus each earlier suite's own sources.  
**Safety:** no real host was contacted, no AI call was metered (budget still 9 of 10), no product file was changed (mutants were temporary and reverted, and `git status` confirms only test files changed).

## Result: FAIL as a release candidate, on one blocker (D-N1). Everything the API does passes.

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
