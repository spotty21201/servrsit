# Test Report: care loop (T-048), AWS skeleton (T-049), live cards (T-046) on integration/live-v1

**Tester:** Kiro Tester  
**Date:** 2026-11-17 (UTC)  
**Branch:** `feat/tester/care-loop` (integration/live-v1 plus my tests)  
**Code tested:** integration/live-v1 at `6bc72cc`. Integration has since advanced to `e9dd899`; I checked, and nothing but docs, `.gitignore` and an agent file changed, so the product code is identical.  
**Spec reviewed:** PRD FR-10..FR-17; Technical Spec §8.2, §9, §10.2, §11, §13; execution-security invariants 1-14; ADR-014; Coder's T-047..T-049 handoff.

## Result: PARTIAL

The write gate holds on every real-host path I could find or build. The core care-loop behaviours I tested pass. Six scenarios fail and one could not run, and every one of the seven is a gap in what has been built, not a safety failure. Nothing wrote to a real server.

| Area | Result |
|---|---|
| **ZT-01: `writesEnabled=false` blocks every real-host write path** | **CONFIRMED** (§2). 12/12 on the real four-host wiring, 11 of 13 faults I injected into the real code caught, the other two explained. |
| Care-loop scenarios against T-048 | 42 scenarios: **35 pass, 6 fail, 1 not run** (§3) |
| Real-host ZT-01 suite | 12/12 pass |
| Static host-config check | 3/3 pass |
| Self-check of the tests themselves | 28/28 pass |
| Live fleet re-check, all four servers | **PASS**: `source=live`, `fresh`, 15/15 each (§6) |
| Repo's own suite (regression) | **362 pass, 0 fail**, same as Coder reported (353 plus infra 9) |
| Strict `tsc` on all my test files | exit 0 |

```
$ pnpm exec tsx --test ../../tests/e2e/care-loop/*.test.mts
ℹ tests 85   ℹ pass 78   ℹ fail 6   ℹ cancelled 0   ℹ skipped 1
  care-loop.test.mts        42 tests: 35 pass, 6 fail, 1 skipped (NOT RUN)
  zt01-real-hosts.test.mts  12 tests: 12 pass
  self-check.test.mts       28 tests: 28 pass
  static-config.test.mts     3 tests:  3 pass
```

## Safety record

| Rule | What happened |
|---|---|
| Read-only, no writes on any real host | No write was sent anywhere. The care-loop scenarios run only against simulated targets inside the test process. The real-host suite runs with a guard that throws on and counts any process spawn, socket, TLS or DNS call. The count was **0**. |
| No sudo | None used. |
| No SSH from me | I never ran `ssh`. The only contact with real hosts was my one API instance's read-only collector pass (§6): **4 checks, one per host, 0 failures**. I did not read any key file. |
| No production source edited | `git status` shows only `tests/` and this report. Mutation testing was done in a throwaway detached worktree under `/tmp`, which I removed. |
| Founder's running instance (port 3001) | Untouched. I read its cached `/api/fleet` once (no new contact) and it was still up when I finished. |
| My process and pane | Instance on port 3002 stopped by SIGTERM (exited in 0.1 s) after confirming its PID's working directory was my worktree. Pane closed. |

## 1. How the tests run against T-048

T-048 has **no HTTP test mode**: simulated servers can only be injected in code (`buildServer({ care: { simulated } })`). So the binding (`tests/e2e/care-loop/binding.mts`) runs the real Fastify routes, real SQLite store and real `Dispatcher` in-process through `fastify.inject()`, against the real `SimulatedTarget`. A recording proxy around the target logs what it saw, in order. That log, the target's claims, and a second read-only database connection are the oracle, so no scenario trusts the API's own account of itself. No socket is opened.

The scenarios were written before T-048 existed and assert only on an abstract harness. The binding holds all shape assumptions and no assertions. Its mappings are listed in the README because they affect what a pass means.

## 2. ZT-01: writes disabled on real hosts

The shipped config covers Sentani, Nabire, Timika and Merauke. Evidence for each layer:

| Layer | Evidence | Result |
|---|---|---|
| Config cannot enable writes | `FleetConfigSchema` rejects `writesEnabled` of `true`, `"true"`, `1`, `null`, `"false"`; absent parses to `false` | PASS |
| No route changes the flag | PATCH, PUT, POST, DELETE on `/api/servers/:id`, `/api/servers/:id/writes`, `/api/config` all 4xx: all four hosts in the test suite, and the first host on my live instance | PASS |
| Route inventory | The only mutating routes are `POST /api/plans`, `/api/plans/:id/revisions`, `/api/plans/:id/approvals`, `/api/assistant/messages`. A new one fails the test on purpose. | PASS |
| Planning gate | All four real hosts: plan `201`, blocker `WRITES_DISABLED`, `approvable:false`, `previewDigest:"none"` (no preview taken from a real server) | PASS |
| Approval gate | All four: refused `409 PLAN_BLOCKED`, **0 operation rows** (counted in the database). Override fields in the body (`writesEnabled`, `writes_enabled`, `force`, nested) get 4xx, and header overrides are ignored. | PASS |
| Store gate (route bypassed) | `store.approve` with a lying `writesEnabled:true` for an `ssh` target is rejected | PASS |
| Dispatcher gate | Switching writes off after approval cancels an unsent operation with `WRITES_DISABLED`, nothing sent (CL-08e) | PASS |
| Approval-time recheck | Switching writes off between plan and approval is refused (CL-08i, added after a fault in the store's gate survived) | PASS |
| Real SSH target | `submit` rejects `WRITES_DISABLED`; `query` and `inspectInstalled` throw `WritesDisabledError`; `previewPackages` is `null`. Its source imports only `./target.js` and `@servrsit/domain`: no process, network or dynamic-import capability. | PASS |
| Chat | "yes", "do it", "approve the plan", "go ahead and update the packages now" for every real host: 0 operations | PASS |
| No I/O | Process spawn, socket, TLS and DNS guard recorded **0 attempts** across all of the above | PASS |
| Running server | Same plan and approval checks against my live instance on port 3002 for all four hosts: plans blocked, approvals `409 PLAN_BLOCKED` | PASS |

**Limits of this confirmation, so it isn't read as more than it is:**

- It covers every write path that **exists**. No route runs the dispatcher and no worker process exists, so the dispatcher's real-host behaviour is exercised only in tests. When a worker or a new route is added, the route-inventory test fails on purpose and must be reviewed.
- The gate is four layers deep. Faults I injected into one layer at a time were caught where a layer is observable (§5). The one layer I cannot attack from outside is the database's unique index (needs a second process).
- This says nothing about the future real SSH write target. When that replaces `SshWriteTarget`, the target tests here will (correctly) fail and need rewriting against the disposable-server gates.

## 3. Care-loop scenarios (42)

| Area | Scenarios | Result |
|---|---|---|
| Plan expiry (FR-11) | CL-01a–e: approvable at 14m59s; `PLAN_EXPIRED` at 15m01s with 0 ops and nothing sent; refreshed plan has a new digest and acknowledgements don't carry; **accepted work is not killed by expiry**; queued-unsent work is never sent after expiry | **5/5 PASS** |
| Digest and approval envelope | CL-02a–f: tampered digest, another plan's digest, wrong version, missing digest, partial or missing production acknowledgement, missing or wrong CSRF token. All refused and the plan stays approvable afterwards. | **6/6 PASS** |
| No session | CL-02g: approval with no signed-in owner is refused | **FAIL** (F1) |
| Double approval (FR-11, FR-14) | CL-03a–d, f: same key twice, **ten concurrent** with one key, different key, two plans at once (`TARGET_BUSY` for the loser), replay after completion. One operation, one claim on the target. | **5/5 PASS** |
| Alias display name cannot bypass the lock | CL-03e | **NOT RUN** (F5) |
| Changed transaction (FR-11, FR-12) | CL-04a: changes after approval → nothing claimed, reason `PRECONDITION_CHANGED`. CL-04b: old approval unusable, new plan has a new digest and applies once. CL-04d: removals blocked. | **3/3 PASS** |
| Target changed before approval | CL-04c | **FAIL** (F2) |
| Retry after lost ack (invariant 7) | CL-05a–c: ack lost after acceptance, request lost before acceptance, restart with the route down. The target only ever sees **one** operation id, one claim, queries on the same id, one mutation. | **3/3 PASS** |
| `outcome_unknown` blocks conflicting writes (invariant 8) | CL-06a–e: conflicting approval refused even when the target is reachable again; time (10 min, 1 h, 24 h) with failed reconciles never unblocks; other servers unaffected; reconcile reads only; resolution **appends** events, keeps the earlier `outcome_unknown`, and lifts the block | **5/5 PASS** |
| Stop request is not cancellation | CL-07a–c | **FAIL** (F3, no route) |
| `writesEnabled` gate (ZT-01) | CL-08a–g, i | **8/8 PASS** (two are weaker than they look, see below) |
| Stage A scope | CL-09a: packages, restart, reboot, directories all exist | **FAIL** (F4) |

**Passes that prove less than their title** (so no one leans on them):

- **CL-08f** (schedules never write): the care loop has no scheduler path, so `schedulerTick` is a no-op here. It shows time and reconcile never send, not that a scheduler can't.
- **CL-08g** (inspection still works with writes off): the care loop has no inspection route for simulated servers, so the harness reads the target directly. The real read path is covered by the live fleet re-check (§6).
- **CL-02e** (both acknowledgements): the system has **one** acknowledgement, so "one of two" cannot be distinguished from "none". See O1.
- **CL-06a/b** pass through plan-level blocking (`PLAN_BLOCKED` carrying `OUTCOME_UNKNOWN`). The approval-level backstop is covered by CL-03d (fault R5).

## 4. Failures and the one not-run

| # | Scenarios | Finding | Severity | Safety effect |
|---|---|---|---|---|
| **F1** | CL-02g | An approval request with no session is accepted (`201`). Auth is still the stub (D3). | **High before any real write is enabled** | None today: real hosts are gated and the stub is loopback. **Blocks enabling writes.** |
| **F2** | CL-04c | Approving a plan after the target's package state changed is accepted. The spec says the approval endpoint checks target state (§9.2). Traced: the operation then fails `PRECONDITION_CHANGED` at the target, `remote_rejected`, **0 claims, 0 mutations**. | Low–Medium | None: the target's own check stops it. The user sees a failed operation instead of a refused approval. |
| **F3** | CL-07a–c | No `stop-request` route (real 404). The store has a `stop_requested` column and event type, but nothing sets them and `WriteTarget` has no way to stop or kill a run. FR-16 and FR-17 are priority A. | Medium (known gap) | None. |
| **F4** | CL-09a | Only `apply.packages.v1` exists. Service restart, reboot and directory preparation return 400. FR-13 and FR-15 are priority A. Handoff states this ("restart and reboot cannot be planned"). | Medium (scope) | None. |
| **F5** | CL-03e (NOT RUN) | No canonical-identity model: a second record for one machine gets its own server id and its own lock (the database index is on `server_id`). FR-02's duplicate-identity acceptance is not built. The remote helper's server-wide lock would still stop concurrent mutations once a real helper exists. | Medium | Not exercised. |
| **F6** | `POST /api/operations/:id/reconcile` | Route missing (real 404). Reconciliation happens only through the dispatcher's own passes. CL-06d/e pass using that fallback, which the binding records. | Low–Medium | None. |

## 5. Can the tests catch real bugs in the real code? (mutation checks)

I broke Coder's actual code one rule at a time in a throwaway detached worktree and ran the care-loop and real-host suites. Baseline failures were the six above. A fault is **caught** when it adds a failure.

| # | Fault injected in the real code | Result | Caught by |
|---|---|---|---|
| R1 | Dispatcher: drop the write-gate recheck | caught | CL-08e |
| R2 | Store: ignore the plan digest | caught | CL-02a, 02b, 01c |
| R3 | Store: ignore plan expiry | caught | CL-01b, 01c |
| R4 | Store: no idempotent replay | caught | CL-03a, 03b, 03f |
| R5 | Store: don't block on an unresolved operation | caught | CL-03d |
| R6 | Store: approval ignores the writes gate | **survived, then caught** | new **CL-08i** (a real gap in my scenarios, now closed) |
| R7 | Dispatcher: ignore plan expiry before first send | caught | CL-01e |
| R8 | Route: skip CSRF check on approval | caught | CL-02f |
| R9 | Dispatcher: transport loss marks the op `failed`, not unknown | caught | CL-05c, CL-06a–e |
| R10 | Dispatcher: after a lost ack, do not query immediately | **survived** | *Equivalent*: the next pass still queries the same id, so there is no second claim. Same behaviour, different timing. |
| R11 | Store: remove the unique-index backstop | **survived** | The application-level check still blocks, so only a second process racing it would show the difference. Coder's own tests cover that layer. I did not verify it independently. |
| R12 | Route: planning treats real hosts as writable (layer 1 off) | caught | three real-host ZT-01 tests |
| R13 | `SshWriteTarget.submit` pretends to accept | caught | real-target ZT-01 test |

## 6. Live fleet re-check (all four servers)

First, the founder's already-running instance (port 3001, cached read, **0 new contacts**, 20:53:33Z): all four `source=live`, `status=fresh`, 15/15.

Then my own instance on **port 3002 via the real `index.ts` entry point** (Coder's `PORT` override works), one collector pass, started 20:53:58Z:

| Server | access | source | status | age at read | window | checks | hostname | OS | boot id | pending / held | reboot |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Timika | ssh | live | fresh | 46.9 s | 30 min | 15/15 | timika | Ubuntu 24.04.5 | `d7c54a08` | 0 / 1 | no |
| Nabire | ssh | live | fresh | 45.2 s | 30 min | 15/15 | nabire | Ubuntu 24.04.5 | `3918acfd` | 1 / 0 | no |
| Sentani | ssh | live | fresh | 40.0 s | 30 min | 15/15 | sentani | Ubuntu 24.04.5 | `ecc8b4a3` | 6 / 0 | no |
| Merauke | local | live | fresh | 39.3 s | 30 min | 15/15 | merauke | Ubuntu 24.04.5 | `fdd6f28c` | 0 / 1 | no |

- **Identity:** four distinct hostnames and four distinct boot ids, and **each boot id is identical to the one the founder's independent instance reported**, so no key answered for another machine.
- **Merauke checked independently** from the machine itself: hostname, boot id `fdd6f28c`, `apt-get -s` "0 upgraded … 1 not upgraded", no reboot-required. All match.
- **Findings** (advisory only): Nabire 1 pending update, Sentani 6 pending updates, both worded "from the host's existing package information (not refreshed by ServrSit)". Nothing critical or warning.
- **Leaks:** my scanner now has real key paths to look for. Fleet body, headers and server log: **CLEAN** (`PRIVATE KEY`, `id_ed25519`, `/.ssh/`, `.ssh`, `identityFile`, `/home/spotty`, `BEGIN OPENSSH`, AWS-key shape all 0).
- **Contacts:** 4 `check finished`, 0 `check failed`. Process stopped well before its 15-minute timer; shutdown took 0.1 s.
- **Caveat:** this shows the read path works, not that the dedicated Sentani/Timika keys follow least privilege. I did not and must not read them.

## 7. Other observations

- **O1 (Low):** the system has one production acknowledgement (`production-impact`), while UX §10.2 and Tech §9.2 describe two (recovery route, interruption risk). The API takes an array, so the UI could send both; it just isn't enforced as two.
- **O2 (Low):** plan creation against an unreachable simulated target returns an untyped `500` (verified), though §13 has `ROUTE_UNAVAILABLE`. Real hosts are unaffected because no preview is taken from them.
- **O3 (Low–Medium, design):** the dispatcher has no delay between passes. Each pass against an unreachable target appends a `transport_error` event, and my settle loop produced dozens. Whoever builds the worker loop needs backoff or de-duplication, or an outage grows the append-only event table.
- **O4 (closed):** my earlier recommendation to write `"writesEnabled": false` explicitly is no longer needed. The schema is `z.literal(false).default(false)`, so absent means false and `true` cannot load.
- **O5 (info):** `/projects/servrsit-coder` is now on `feat/coder/ai-context`; I made no use of it.

## 8. Mistakes I made while testing, and fixed

For transparency, because each looked like a product failure first:

1. My binding mapped approval blockers as objects; the approval response uses plain strings. Product was correct.
2. CL-06e planned a second update after the first operation had applied everything, so the new plan was legitimately `NO_CHANGES`. Scenario fixed.
3. CL-06b let time pass with the target reachable, but the dispatcher legitimately reconciles on contact. Redesigned so reconcile keeps failing while time passes.
4. CL-05b asserted an intermediate state the dispatcher passes through instantly (it retries with no delay). Replaced with an order assertion that fails if the drop didn't happen.
5. A fake-ack scenario needed `thenPartition`, because here a lost ack is resolved by an immediate query unless the connection is also down.
6. My route-inventory parser read Fastify's nested tree wrongly. Fixed to rebuild full paths.
7. Three strict-typecheck errors in my files. Fixed, `tsc` exit 0.
8. Mutant R6 survived because of a real gap in my scenarios (policy change between plan and approval). Added CL-08i.

## 9. Not covered

- Invariant 5: a package-update approval cannot authorize a restart or reboot. Nothing to test until those exist (F4).
- ZT-03 (success reported only after independent verification): the dispatcher's verification is covered by Coder's tests (exit 0 with an unchanged package gives `partially_succeeded`). I did not write scenarios for it.
- Serial batches and cancelling a batch (FR-14, FR-17): no batch API.
- The database unique-index layer and multi-process races.
- Anything involving a real helper, APT locking, transient-job survival or reboot: these need the disposable server (T-010..T-014). A simulated target cannot prove them (ADR-014).
- Auth, MFA and session handling (F1).
- The AWS skeleton (T-049) and Designer's live cards (T-046): outside this request. I did not test them beyond confirming the integrated suite still passes (362/0) and the fleet read path works.

## 10. Recommendations for Orchestrator

1. **Do not enable writes on any real host until** authentication replaces the stub (F1) and the disposable-server gates pass (ADR-014). The gate is sound today, but its protection against a *person on the network* is the loopback bind, not auth.
2. **Add tasks for F3, F4, F6** (stop-request and reconcile routes with a real stop path; restart, reboot, directories) and a decision on F2 (should approval re-check target state?) and F5 (canonical identity), so the Stage A scope is tracked.
3. **Ask Coder** to add worker-loop backoff before any worker exists (O3) and typed `ROUTE_UNAVAILABLE` on planning (O2).
4. **Decide O1:** one acknowledgement, or two as UX §10.2 describes.
5. **Keep the route-inventory and real-target tests as a standing gate.** Any new mutating route or a replacement of `SshWriteTarget` should fail them and force review.

## 11. Files

```
tests/e2e/care-loop/binding.mts             in-process binding to the integrated system (no assertions)
tests/e2e/care-loop/care-loop.test.mts      42 scenarios against it
tests/e2e/care-loop/zt01-real-hosts.test.mts 12 tests, real four-host wiring, I/O guard
tests/e2e/care-loop/scenarios.mts           42 scenarios (CL-01a … CL-09a), CL-02g, CL-08i, CL-09a new
tests/e2e/care-loop/reference-model.mts     spec-derived model, 25 faults
tests/e2e/care-loop/self-check.test.mts     28 tests of the tests
tests/e2e/care-loop/static-config.test.mts  3 tests
tests/e2e/care-loop/README.md               how to run, what the binding maps
docs/team/test-report-care-loop-001.md      this report (replaces the earlier "pending" version)
```

No production source was modified. Raw `/api/fleet` captures from real hosts are not committed.
