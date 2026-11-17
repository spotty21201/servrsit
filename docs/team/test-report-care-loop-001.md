# Test Report — Care loop acceptance tests, written ahead of T-048

**Tester:** Kiro Tester  
**Date:** 2026-11-17 (UTC)  
**Branch / worktree:** `feat/tester/live-check` at `/projects/servrsit-tester`  
**Spec reviewed:** PRD FR-10..FR-17; Technical Spec §8.2, §9, §10.2, §11, §13; execution-security invariants 1-14; ADR-014. Coder's code was **not** read to write these tests.  
**Implementation reviewed:** none. T-048 has not landed (evidence below).

## Result: PARTIAL

| Part | Status |
|---|---|
| Tests written from the spec (39 scenarios, 7 requested areas) | **Done** |
| Tests proven able to pass and able to fail (self-check on a reference model) | **Done, 27/27** |
| Static ZT-01 check on the shipped host config | **Done, 3/3 pass** |
| Tests run against Coder's care loop (T-048) | **NOT RUN.** It does not exist yet. All 39 real-system scenarios are skipped as PENDING. |

Nothing in this report is a verdict on Coder's implementation. A green self-check says the tests are sound, not that the product is.

**T-048 status, checked rather than assumed:** the ID appears in no doc in either checkout (`grep -rln T-048` → nothing). `apps/api/src` in Coder's worktree (HEAD `5c61936`, "T-047 … still disabled") and the integration branch (`2a2e768`) contain no plan or operation routes and no `writesEnabled` anywhere in source.

## Verbatim results

```
$ pnpm exec tsx --test ../../tests/e2e/care-loop/*.test.mts
ℹ tests 69   ℹ pass 30   ℹ fail 0   ℹ cancelled 0   ℹ skipped 39   ℹ todo 0

self-check.test.mts      ℹ tests 27  ℹ pass 27  ℹ fail 0  ℹ skipped 0
static-config.test.mts   ℹ tests 3   ℹ pass 3   ℹ fail 0  ℹ skipped 0
care-loop.test.mts       ℹ tests 39  ℹ pass 0   ℹ fail 0  ℹ skipped 39   (PENDING T-048)
tsc --noEmit (strict) over all new files: exit 0
```

Skipped tests are **not passes**. The "30 pass" are the self-check and the static config check only.

No server was contacted. The test code contains no process spawn, network call or SSH (grep: one hit, a comment). The static check only reads the text of `hosts.json`.

## How the tests are built, and why

The spec fixes behaviour, endpoints and error codes. It does **not** fix request/response JSON. So:

- **Scenarios assert on an abstract `Harness`** (`support/contract.mts`). Every shape assumption is isolated in `http-binding.mts`, which is deliberately unbound. When T-048 lands I map shapes there without touching any assertion.
- **The managed server is the oracle.** Effects are read from a simulated target's own ledger, mutation log and interaction log, not from the API's account of itself. "Double approval gives one operation" is proved by counting mutations the target actually applied.
- **Tests were validated before use.** A small spec-derived reference model passes every scenario, and 24 deliberately broken variants ("faults") are each caught by the scenarios I named. This guards against tests that cannot fail.
- **Hard safety guards in the binding:** refuses any non-loopback URL, refuses to run without `CARELOOP_SIMULATED=1`, never reads an address, key or host from the environment. These tests drive mutation paths and must never reach Sentani, Nabire, Timika or Merauke.

## Coverage of the seven requested areas

| # | Requested | Scenarios | Key assertions (spec source) |
|---|---|---|---|
| 1 | Plan expiry and digest mismatch | CL-01a–e, CL-02a–f | Approvable at 14m59s, refused `PLAN_EXPIRED` at 15m01s with zero ops and zero requests reaching the target (FR-11). Refresh gives a new digest and acknowledgements don't transfer (UX §10.3). **Accepted work is not expired or killed** (Tech §8.2). **Queued-unsent work is never sent after expiry** (Tech §9.3). Tampered digest, other plan's digest, wrong version, missing digest are all refused (`PLAN_CHANGED`). Both production acknowledgements required. Session and CSRF required (Tech §9.2). |
| 2 | Double approval returns one operation | CL-03a–f | Same key twice, and **10 concurrent**, give one operation id and one mutation on the target. Different key can never create a second. Two different plans at once: exactly one wins, loser gets `TARGET_BUSY` (FR-14). **Alias display name can't bypass the lock** (FR-02). Replay after completion changes nothing. |
| 3 | Changed transaction invalidates approval | CL-04a–d | Transaction changes after approval: **no commit**, a reason is given (Tech §10.2 step 5). Old approval can't be reused. A new plan has a new digest and applies exactly once. Change before approval is `PLAN_CHANGED`. Removals are blocked in A (FR-12). |
| 4 | Retry after lost ack queries same op ID | CL-05a–c | Ack lost after acceptance, request lost before acceptance, and controller restart. In each: the target only ever sees **one** operation id, the retry **queries first**, the mutation request is sent **once**, one mutation applied (invariant 7). |
| 5 | `outcome_unknown` blocks conflicting writes | CL-06a–e | Conflicting approval refused (`TARGET_BUSY` or `OUTCOME_UNKNOWN`) **even after the target is reachable again**, because reachability is not evidence. 1 h and 24 h later: still refused (lease expiry never authorizes, Tech §9.4). Other servers are unaffected. `reconcile` only reads and never guesses. Resolution **appends** events and keeps the earlier `outcome_unknown` record (Tech §11). |
| 6 | Stop request is not cancellation | CL-07a–c | Running op: request recorded, **state stays `running`**, **0 kill signals** to the target, work completes and is verified, no event claims rollback (FR-16, Tech §10.2). Never-sent op: `cancelled_before_start`, nothing ever sent. Possibly-already-sent op: **must query first, never called cancelled** (Tech §11). |
| 7 | `writesEnabled=false` blocks every write path (ZT-01) | CL-08a–g, CL-08h (static) | Control: all four kinds do work when enabled. With the flag **false and absent**: all four kinds refused, no op, nothing reaches the target. Client override via body or header ignored. Chat "yes / do it / approve" creates nothing, with writes on or off. **Gate re-checked at dispatch** (flag turned off or removed after approval). Scheduler, 30 hours of time and `reconcile` never send a mutation. Read-only inspection still works. Static: no host in `hosts.json` has `writesEnabled: true`. |

## Does each scenario actually detect its bug? (self-check)

24 faults, each introduced on its own, each caught. Examples (full list in `self-check.test.mts`):

| Fault introduced in the model | Caught by |
|---|---|
| expiry not enforced | CL-01b, CL-01e |
| expiry kills an already-accepted op | CL-01d |
| digest ignored / version ignored | CL-02a, 02b / CL-02c |
| no idempotency; duplicate ops | CL-03a, 03b, 03f / CL-03a, 03b, 03c |
| same-server lock missing | CL-03d, 03e, 06a |
| helper doesn't recheck the transaction | CL-04a, 04c |
| retry doesn't query first / regenerates the id | CL-05a–c / CL-05b |
| unknown outcome doesn't block / time unblocks it | CL-06a, 06b / CL-06b |
| reconcile re-dispatches | CL-06e |
| stop request kills the transaction | CL-07a |
| stop cancels a possibly-sent op without querying | CL-07c |
| writes gate missing / approve-only (not re-checked at dispatch) | CL-08b, 08c, 08e / CL-08e |
| client override honoured | CL-08c |
| chat approves | CL-08d |
| absent flag treated as enabled | CL-08b, 08e |

The correct model also passes under a second legal design (planning itself refuses write-disabled servers), so the tests don't force one implementation choice.

### Two flaws the self-check found in my own work (both fixed)

1. **CL-01d and CL-07a failed on the correct model.** After completing a held transaction they called `settle()` with no time advance, so they demanded instant completion detection. The spec gives no poll interval, so a correct controller could fail them. Fixed by advancing one poll interval first.
2. **The "client override" fault was not caught.** My model's planning step already blocked write-disabled servers, so the override was masked by `PLAN_BLOCKED`. FR-10 doesn't require planning to block (a plan can be inspected without changing a machine), so a real system may rely on the approval gate alone. Fixed by making the model's default match that, with the other design kept as a second variant.

## ZT-01 static finding (runs today)

```
hosts.json                         Timika / Nabire / Sentani / Merauke
this worktree                      writesEnabled = <absent> on all four
/projects/servrsit-coder (5c61936) writesEnabled = <absent> on all four
/projects/servrsit (integration)   writesEnabled = <absent> on all four
static-config.test.mts → 3 pass on each
```

The check passes, but **the flag ADR-014 relies on does not exist yet**: no host config sets it and no source reads it. Today real hosts are safe only because no write code exists. Once T-048 lands, safety depends on "absent means false" (CL-08b covers the absent case, CL-08e the removed case).

## Defects

None found, because there is nothing to test yet. Observations:

- **O1 (Medium, process).** ADR-014's gate is specified but unimplemented, and the shipped config doesn't state it. Recommend `"writesEnabled": false` written explicitly on each real host, so the state is visible and reviewable rather than inferred from a missing key. My static check accepts both forms.
- **O2 (Low).** `T-048` is referenced in the request but is not on any task board I can find. I couldn't read its acceptance criteria. Please add it, so the tests can be traced to it.

## What is not covered (so no one assumes it is)

- **Invariant 5:** that package-update approval cannot authorize a service restart or reboot, and the reboot return window (FR-13, FI-016).
- **ZT-03:** command success followed by failed verification must not read as success (FR-16). Next candidate.
- **Serial batches** and "cancelling a batch" (FR-14/FR-17): the batch API is unspecified.
- **Helper-side checks** (signature, replay, same-id-different-digest, APT lock, low disk, held packages). These need the disposable VM (T-010–T-014) and cannot be proven with a simulated target (ADR-014).
- **Unknown routes.** CL-08 covers every write path I can name. Once T-048 lands I will also list its non-GET routes from its OpenAPI document and require each to map to a CL-08 case or be provably read-only.
- **Alias server with a different flag than its canonical machine:** undefined by ADR-014, so not tested.

## What I need

**From Coder (T-048)**, full detail in `tests/e2e/care-loop/README.md`: a loopback-only, flag-enabled simulated-target mode that refuses to start with any real host configured; a test oracle (mutation, interaction and ledger logs) and fault controls (partition, drop-ack, change-transaction, hold-open); an injectable clock; a manual-drive worker (`settle`, pause, restart); a server-side `writesEnabled` toggle; test sessions with CSRF; and operation views with ordered events and the §13 error codes.

**From Orchestrator:** a decision on the alias/flag question; confirmation that "READ_ONLY_ACCESS or any typed 4xx" is acceptable for the writes gate; and the T-048 task entry.

## Next steps when T-048 lands

1. Write the HTTP mapping in `http-binding.mts` from the API's OpenAPI document (no assertion changes), set `MAPPED = true`.
2. Run against the simulated mode only. Report each scenario PASS/FAIL with the target's logs as evidence.
3. Add the route-inventory check and the invariant-5 and ZT-03 scenarios.
4. Update this file with the real-system results. Until then, treat every care-loop requirement as **unverified**.

## Files (all new, none production)

```
tests/e2e/care-loop/README.md
tests/e2e/care-loop/scenarios.mts            39 scenarios
tests/e2e/care-loop/support/contract.mts     Harness interface and vocabulary
tests/e2e/care-loop/support/helpers.mts
tests/e2e/care-loop/care-loop.test.mts       real-system run (39 PENDING)
tests/e2e/care-loop/http-binding.mts         UNBOUND, with safety guards
tests/e2e/care-loop/reference-model.mts      spec-derived model + 24 faults
tests/e2e/care-loop/self-check.test.mts      27 tests
tests/e2e/care-loop/static-config.test.mts   3 tests
docs/team/test-report-care-loop-001.md       this report
```

No production source was modified.
