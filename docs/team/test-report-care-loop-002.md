# Test Report: care loop against T-054, T-055, T-056, T-057 (and T-058)

**Tester:** Kiro Tester  
**Branch:** `feat/tester/care-loop-002`  
**Code tested:** `feat/coder/care-gaps`, pinned:

| Run | Code | Why |
|---|---|---|
| **A** | `e3d8a29` (T-054 to T-057) as committed | Coder's branch exactly. It is not built on T-053, so it has no owner login. |
| **B1** | `e3d8a29` + `feat/coder/owner-auth` `41676cc`, trial merge | What integration will look like. **This is the verdict for T-054 to T-057.** |
| **B2** | `fb73a6c` (adds T-058) + `41676cc`, trial merge | T-058 landed while I was working; I tested it rather than ignore it. |

Trial merges were in throwaway worktrees (removed), built by one script so both resolved identically: the only code conflict is the one in `apps/api/src/routes/care.ts` (see I-1), resolved by dropping `CsrfGuard`, since the global guard enforces CSRF on every state-changing `/api` route. No product file in any branch was changed.

## Result: PASS for T-054 to T-057. 41 of 42 scenarios pass; the one failure waits for T-059.

| Suite | Before (owner-auth only) | A: care-gaps as is | **B1: T-054..T-057 + login** | B2: + T-058 |
|---|---|---|---|---|
| care-loop (42) | 36 pass, 6 fail | 36 pass, 6 fail (4 of them only because A has no login) | **41 pass, 1 fail** | **41 pass, 1 fail** |
| zt01-real-hosts | 12 pass, 1 fail* | 13/13 | **13/13** | **13/13** |
| static-config | 3/3 | 3/3 | 3/3 | 3/3 |
| self-check (reference model) | 28/28 | 28/28 | 28/28 | 28/28 |
| 401 sweep | 7/7 | n/a (no login on A) | 7/7 | 7/7 |

\* **ZT-01 is 13 tests, not 12.** In the previous round I added one reviewed test for the two T-055 routes (stop-request and reconcile on an unknown id are refused and touch no server), and the route inventory now lists them. All 12 original tests pass in every run. On a branch without T-055 the inventory test fails on purpose, because those routes are expected; that is the one failure in the first column.

**The remaining failure is CL-09a** (service restart, reboot and directory preparation are not built). It is T-059.

## Which CL-* scenarios each task turned green (B1)

| Task | Finding | Scenarios that now pass | Proof the scenarios guard it |
|---|---|---|---|
| **T-053** (login, via the merge) | F1 | CL-02g | (previous round) |
| **T-054** | F2 approval does not re-check the target | **CL-04c** | Mutant "no re-check" fails CL-04c; mutant "re-check replays too" fails CL-03f (previous round). |
| **T-055** | F3/F6 no stop or reconcile route | **CL-06e, CL-07a, CL-07b, CL-07c** (through the real routes; the binding's reconcile fallback is unused) | (previous round) |
| **T-056** | F5 no canonical identity | **CL-03e** (two display names for one machine share one lock) | Mutant "lock on server id only" fails CL-03e (previous round). |
| **T-057** | O1 one generic production acknowledgement | **CL-02e** now tests what it says: a partial set is really sent as a partial set and is refused | **This round:** mutant "one of the two is enough" fails CL-02e; mutant "acknowledgements not checked" fails CL-02e and CL-01c. |
| T-058 | O2/O3 typed ROUTE_UNAVAILABLE, backoff | No scenario targets O2/O3 directly. Nothing regressed once CL-06e allows the retry interval. | Not mutation-tested. |

On run A, CL-02g, CL-06e and CL-07a/b fail only on their "a request with no session is refused" step. That is F1, fixed by T-053, which is not on that branch.

## Changes to my files (and why none weakens a check)

1. **Acknowledgement mapping (`binding.mts`, `zt01-real-hosts`).** T-057 replaced one production acknowledgement with two named ones. The binding now maps each abstract acknowledgement to its own product token **by name** (`ACK_RECOVERY_ROUTE`, `ACK_INTERRUPTION_RISK`), and falls back to the old single token on code without T-057. Coder supplied a patch (`docs/team/t056-t057-tester-binding.patch`). I reviewed it and took the mapping idea, but not its two other hunks: it mapped by array position, and it re-added an `identity()` forward I already had. This makes CL-02e **stronger**: before, "one of two" was sent as "none", so a product that accepted one acknowledgement could not have been caught. ZT-01 now sends **both** acknowledgements for production real hosts, so their refusal cannot be explained by a missing acknowledgement.
2. **CL-06e timing.** On B2 it failed with `TARGET_BUSY`. I probed rather than guessed: after reconcile the operation is `verifying`, and with T-058's backoff it reaches `succeeded` after **one** simulated minute, and the block lifts. My scenario assumed zero time. It now allows 2 minutes, as CL-05a/b/c already do. This is my assumption corrected, not a product defect.

## Findings

| ID | Severity | Finding |
|---|---|---|
| **I-1** (still open) | **High (integration)** | `feat/coder/care-gaps` is still not built on T-053. Merging it with owner-auth conflicts in `apps/api/src/routes/care.ts` (T-055's two routes call `o.csrf.check`, and T-053 removed `CsrfGuard`). After the obvious resolution, Coder's own `apps/api/src/routes/care.test.ts` still constructs `CsrfGuard`, so **`apps/api` does not typecheck** (lines 409 and 414). The branch should be rebased on owner-auth before it is merged. |
| I-3 | Low (process) | The branch moved under me: T-058 was committed between my reading the branch and creating the worktree, so my first "B" run tested T-058 without my knowing. I caught it from the worktree's HEAD and re-ran with pinned commits. Lesson for me: pin a commit, never a branch name. |
| G-1 | Gap (mine) | Two mutants from the previous round still survive: a stop request that cancels an operation whose send was already attempted (M2), and approval of an ambiguous identity (M5). No new scenario this round. |
| G-2 | Gap (mine) | No scenario targets T-058's typed `ROUTE_UNAVAILABLE` on planning or its backoff (O2/O3). |

## Recommendations

1. Rebase `feat/coder/care-gaps` on `feat/coder/owner-auth` and fix `care.test.ts` (I-1), then merge. On my evidence T-054 to T-057 are ready.
2. T-059 is the last care-loop gap (CL-09a).
3. I will add scenarios for G-1 and G-2 next.

## Files

```
tests/e2e/care-loop/binding.mts               acknowledgements mapped by name (T-057), with a fallback
tests/e2e/care-loop/zt01-real-hosts.test.mts  both acknowledgements for production real hosts
tests/e2e/care-loop/scenarios.mts             CL-06e allows the worker's retry interval
docs/team/test-report-care-loop-002.md        this report
```
