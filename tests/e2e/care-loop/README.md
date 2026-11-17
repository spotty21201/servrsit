# Care-loop acceptance tests (Tester)

Written from PRD FR-10..FR-17, Technical Spec §9-§11 and §13, execution-security invariants 1-14 and ADR-014. The scenarios were written **before** T-048 existed and assert only on an abstract `Harness`. They now run against the integrated care loop through `binding.mts`.

Latest results and findings: `docs/team/test-report-care-loop-001.md`.

## Files

| File | Purpose |
|---|---|
| `scenarios.mts` | 42 scenarios (CL-01a … CL-09a). Assert only on the abstract `Harness`. |
| `support/contract.mts` | `Harness` interface, value types, vocabulary, `UnsupportedByBinding` |
| `support/helpers.mts` | Setup, refusal checks, "nothing reached the server" check |
| `binding.mts` | **Plumbing only, no assertions.** Real `buildServer` routes + real `Dispatcher` + real `SimulatedTarget`, through `fastify.inject()`. A recording proxy around the target is the oracle. |
| `care-loop.test.mts` | Runs the scenarios against the integrated system. A scenario the binding cannot express is reported NOT RUN, never a pass. |
| `zt01-real-hosts.test.mts` | ZT-01 on the **real** four-host wiring, with a guard that makes any process spawn, socket, TLS or DNS call throw and be counted |
| `static-config.test.mts` | No real host has `writesEnabled` true in `hosts.json` |
| `reference-model.mts`, `self-check.test.mts` | Spec-derived model with 25 deliberate faults. Proves the scenarios can pass and can fail. Says nothing about the product. |

## Run

From `apps/api` (where `tsx` is installed), with Node on PATH (`~/.local/node24/bin`), after `pnpm install` and a build of the workspace dependencies (`pnpm test` in any package does it):

```
pnpm exec tsx --test --test-reporter=spec ../../tests/e2e/care-loop/*.test.mts
```

## Oracle rule

Effects on the managed server are read from the **target** (what it was asked, in order; which operations it claimed), never from the API's own account of itself. Operation counts come from the database through a second read-only connection.

## Safety

The scenarios drive mutation paths and run **only** against simulated targets that exist inside the test process. Nothing here opens a socket, spawns a process or reads an address, key or host from the environment. `zt01-real-hosts.test.mts` exercises the real host configuration but with I/O made impossible (and counted). Never point these at a real server.

## What the binding maps (visible, because they affect what a pass means)

- Error code is `body.error`. For `PLAN_BLOCKED`, the gate or conflict reason (`WRITES_DISABLED`, `OUTCOME_UNKNOWN`, `TARGET_BUSY`) is used.
- Plan state `expired` is derived from `expiresAt` and the test clock; the API has no such field.
- The system has one production acknowledgement. Both abstract acknowledgements together map to it; a partial set maps to none, so CL-02e cannot tell "one of two" from "none".
- There is no stop-request route and no reconcile route (real 404). For reconcile only, the fallback is the dispatcher's own reconciliation step, and the report says so.
- There is no alias/canonical-identity model (CL-03e is NOT RUN), no inspection route for simulated servers (CL-08g reads the target directly), and no scheduler path (CL-08f proves less than its title).

## Mutation checks on the real code

Done in a throwaway detached worktree (not committed, then removed). See the report, §5. The two faults not caught are explained there.
