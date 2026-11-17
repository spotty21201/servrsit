# Care-loop acceptance tests (Tester)

Written **before** the care loop exists, from PRD FR-10..FR-17, Technical Spec §9-§11 and §13, execution-security invariants 1-14 and ADR-014. Not derived from Coder's code.

**Status: PENDING T-048.** The 39 scenarios in `care-loop.test.mts` are registered as skipped. A skipped test is NOT RUN, never a pass.

## What is here

| File | Purpose | Runs today |
|---|---|---|
| `scenarios.mts` | 39 scenarios (CL-01a … CL-08g). Assert only on the abstract `Harness`. | via the two files below |
| `support/contract.mts` | The `Harness` interface, value types, error and state vocabulary | — |
| `support/helpers.mts` | Setup, refusal checks, "nothing reached the server" check | — |
| `care-loop.test.mts` | Runs the scenarios against the REAL system through `http-binding.mts` | **skipped** until bound |
| `http-binding.mts` | The only file that knows request/response shapes. **Unbound.** Has hard safety guards. | — |
| `reference-model.mts` | Small spec-derived model with 24 switchable faults | used by self-check only |
| `self-check.test.mts` | Tests the tests: pass on the correct model, fail on each fault | yes (27 tests) |
| `static-config.test.mts` | ZT-01: no real host in `hosts.json` has `writesEnabled` true | yes (3 tests) |

## Run

From `apps/api` (where `tsx` is installed), with Node on PATH (`~/.local/node24/bin`):

```
pnpm exec tsx --test --test-reporter=spec ../../tests/e2e/care-loop/*.test.mts
```

## Oracle rule

Effects on the managed server are read from the **simulated target** (its ledger, mutation log and interaction log), never from the API's own account of itself. "Double approval creates one operation" is asserted by counting mutations the target actually applied.

## Safety

These tests drive mutation paths. They must **never** reach Sentani, Nabire, Timika, Merauke or any real machine. `http-binding.mts` refuses to run unless the base URL is loopback **and** `CARELOOP_SIMULATED=1` is set, and it never reads an address, key or host from the environment. Do not weaken this to make a run pass.

## Needs from Coder (T-048) so these can run

The spec fixes behaviour and error codes but not JSON shapes or test hooks. Test mode needs:

1. **Simulated targets** (no `ssh` involved), loopback-only, enabled by an explicit env flag, and refusing to start if any real host is configured. Each simulates the helper: claim an operation id in a ledger (same id + same digest returns the existing one; same id + different digest rejected), `query.operation`, recompute the package transaction and refuse a changed one, held-open transactions, and a log of every request it receives in order.
2. **Target oracle and fault controls** (test-only, same flag): read `mutations`, `interactions` (kind: `manifest` | `query` | `inspect` | `connect-failed`, plus operation id), `ledger`, `killSignals`; and control `partition`, `dropNextAck(before-acceptance | after-acceptance)`, `changeTransaction(add-dependency | new-candidate-version | add-removal)`, `holdTransactionOpen` / `completeHeldTransaction`. Two server records can share one target (alias test).
3. **Injectable clock** driving plan expiry, worker polling and leases (`advance`).
4. **Manual-drive worker**: background loops off in test mode; `settle()` runs the dispatcher, poller and reconciler until idle; `pauseDispatch`; `restartController` rebuilds worker state from the database.
5. **Server-side flag toggle** for `writesEnabled` (set / remove). It must not be settable through any client field.
6. **Test sessions**: a way to get a valid session + CSRF token, and to send none or a wrong one.
7. **Operation view** with: `state` (§11 names), `stopRequested`, `reason` when blocked/failed/cancelled, `events[]` with ordered `seq`, `type` = the state name for state changes plus `stop-requested`, an `outcome_unknown` event, and an appended `reconciled` event. `GET` operations list per server.
8. **Error codes** in a `code` field per §13: `PLAN_EXPIRED`, `PLAN_CHANGED`, `TARGET_BUSY`, `OUTCOME_UNKNOWN`, `READ_ONLY_ACCESS` (closest named code for the writes gate; a different code is acceptable and the tests only require a 4xx with a machine-readable code).

## Spec gaps I had to decide (tests tolerate either, or are called out)

| Gap | What the tests do |
|---|---|
| Exactly 15:00 | Not asserted. Tests use 14m59s (allowed) and 15m01s (refused). |
| Second approval, new key, same plan | Either the same operation or a refusal. Never a second operation. |
| Planning on a write-disabled server | Either blocked at planning or refused at approval. Both pass. |
| How long until a lost operation becomes `outcome_unknown` | Spec silent. Scenarios advance 30 minutes. |
| Which code the writes gate returns | Any 4xx with a machine-readable code. |
| An alias server record with a different flag than its canonical machine | **Not tested** (undefined by ADR-014). Needs an Orchestrator decision. |
| Stop semantics for a serial batch (FR-17 "cancelling a batch") | **Not covered** (batch API unspecified). |
