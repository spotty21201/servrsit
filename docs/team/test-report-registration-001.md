# Test Report: server registration (T-069), written before the implementation

**Tester:** Kiro Tester  
**Branch:** `feat/tester/server-registration`, on top of the T-069 contract `37805b6` (`packages/contracts/src/servers.ts`).  
**Status: PENDING.** The API is not implemented. The scenarios are written and typecheck, and are reported as skipped until a binding to the real endpoints exists.  
**Sources:** PRD FR-02, FR-03; Technical Spec 6.2 (target validation), 6.3 (host-key verification), 6.4 (SSH invocation), 7.1 (inspect-only); execution-security steering (credential handling, target safety). The contract file supplies paths and response shapes only; no expectation was taken from its comments.

## 1. What exists

| File | What |
|---|---|
| `tests/e2e/registration/support/ssh.mts` | Independent SSH-key oracle written from RFC 4253 6.6 and the OpenSSH key format: wire blob, `SHA256:` fingerprint, `authorized_keys` parser (options with quoted commas). |
| `ssh.test.mts` | **2/2 pass.** The oracle's fingerprint equals the real `ssh-keygen -lf` for 20 random ed25519 keys; the parser handles options, no options, and refuses multi-line input. |
| `support/world.mts` | A fake network: scripted DNS (including rebinding sequences), fake SSH servers with real ed25519 host keys that honour `restrict` and `from=` like sshd, and a log of every lookup and connection attempt. No socket is opened. |
| `support/contract.mts` | The abstract harness the scenarios use, so the same scenarios run on the real API once it lands. |
| `scenarios.mts`, `scenarios2.mts` | **35 scenarios**, all pending. |
| `registration.test.mts` | Runner. Also checks that every one of the 11 contract endpoints is exercised by at least one scenario (**passes**). |

## 2. The scenarios, by requirement

| Requirement | Scenarios | What a pass will mean |
|---|---|---|
| **Address validation** (Tech 6.2) | SR-01 to SR-07 | 59 shell-syntax, URI, embedded-credential, option-looking (`-oProxyCommand=…`) and malformed inputs refused **before any DNS lookup or connection**, and not echoed. 31 blocked literals: loopback, unspecified, metadata `169.254.169.254`, link-local, multicast, and their odd spellings (decimal `2130706433`, hex, octal, `127.1`, `::ffff:127.0.0.1`, trailing dot). The controller and operator addresses in every spelling and through DNS. Names resolving to a blocked address, or to a mix including one. **DNS rebinding**: a name that changes to `127.0.0.1` or the metadata address after registration is never connected to. Private/CGNAT only inside the enrolled route. Malformed ports refused. |
| **Host key** (Tech 6.3, FR-02) | SR-10 to SR-15 | The scan reads the key without signing in or running anything, and the fingerprint shown equals my independent computation. **Only the exact owner-supplied fingerprint confirms**: wrong, another server's, case-swapped, whitespace, `sha256:`, MD5 form, empty, wrong types all refused, and the state does not move. Out-of-order steps change nothing and contact nothing. A changed key voids the confirmation, and the old fingerprint never carries over. A key change between confirmation and first check gives `HOST_KEY_CHANGED` and **nothing is offered** to the new server. Evidence stored (algorithm, fingerprint, actor, time). |
| **Access key** (FR-03, credentials) | SR-20 to SR-24 | The line is ed25519 with `restrict` and `from=` naming the real controller (no wildcard), and its stated fingerprint matches the key in the line. One key per server; asking again does not replace an installed key. **No private key in any response, header, log line or subprocess argument**, across the whole flow including disconnect, searched with the private key itself as the needle. Key files owner-only; deleting or expiring a draft removes its unused key; deleting an activated draft does not. The first check offers only this server's key. |
| **First check** (FR-02, FR-03, Tech 7.1) | SR-30 to SR-32 | Route, authentication, timeout and bad-output failures get **distinct codes**, no coverage is claimed, and the same draft succeeds after the fix. A login **without elevated privilege** still gets a check, with "unavailable" steps that carry a reason. Only the fixed collector commands run, and hostile server text is never repeated back. |
| **Activation, duplicates, edits** (FR-02) | SR-40 to SR-45 | One server, with the owner's classification and **writes off**, and nothing run on the server. **A duplicate address opens the existing record** (`duplicateOf` or `DUPLICATE_SERVER` naming it) under any display name or spelling, and can never become a second server or change the existing one. Ten racing activations make one server. Rename and reclassify work; address, port, login, id and `writesEnabled` can never be changed. Hostile ids give clean 4xx answers. |
| **Disconnect and reconnect** (FR-03) | SR-50 to SR-54 | Schedules stop, the controller's key is deleted, the owner gets the steps and the exact line, and **`remoteKeyRemoved` is false and no step claims the key is gone**. Disconnect contacts no server. Nothing is collected for 24 h afterwards. Queued operations are cancelled before sending; a running one is reported, never killed or called cancelled. Reconnecting needs a fresh confirmation and a new key. |
| **Access control and contract** | SR-60, SR-61 | Every endpoint needs a session (401); state-changing ones need CSRF and an allowed origin (403). Every happy-path response matches the contract schemas. |

**Positive controls.** Every refusal scenario also shows a valid request succeeding in the same run, so a product that refuses everything cannot pass.

## 3. Gaps the contract already shows (to resolve before or with T-069)

| ID | Severity | Finding |
|---|---|---|
| **R-1** | Medium | **Production cannot be left unset.** FR-02: "an unset status uses production-level precautions". The contract makes `production` a required boolean, so "not sure" is not representable. SR-08 accepts either "required" or "unset means production"; please decide. |
| **R-2** | Medium | **No privilege or sudo signal.** FR-02 asks to distinguish "insufficient privileges when evidence permits", and FR-03 says broad administrator access must not be presented as harmless read-only. `FirstCheck.failureCode` has no privilege code, and nothing reports that the login *has* sudo. SR-31 checks the "unavailable step with a reason" path only. |
| **R-3** | Low | **"Unapproved ports" is not defined.** Tech 6.2 says to reject them; the contract accepts 1 to 65535. SR-07 records what the API does for 25, 53, 80, 443, 3306, 5432, 6379, 2222 and 65535 as an open question rather than guessing. |
| **R-4** | Low | **Duplicate detection is address+port only** until T-056's identity reaches registration (the contract says so). SR-42 (same host key, new address) is marked as needing that capability. |
| **R-5** | Low | **Disconnect does not report running operations.** FR-03 requires reporting "any already-running action that may continue"; `DisconnectResponse` has no field for it. SR-52 accepts either the operation id or explicit wording in the response, so this needs a field or a decision. |

## 4. Not yet done, and why a future pass needs care

- **No reference model yet.** The care-loop and login suites were validated against a spec-derived model with injected faults before the product existed. These 35 scenarios were not, because I was moved to the T-066 and care-loop work. Until that is done, a pass here proves less than it does there. Next step: a model with faults (accept-any-host-key, no rebinding re-check, private key echoed, schedules not stopped, remote removal claimed).
- **No binding.** When T-069 lands, the binding needs seams for the resolver, the SSH transport (key scan and connect), the key store and the scheduler, so the fake network can stand in for real hosts. Without them the scenarios cannot run without real network access, which I will not use.
- Scenarios that need a capability the product may not expose are marked (`needs: routes, identity, evidence, keystore, care`). They will be reported NOT RUN, never passed, if the seam is missing.

## 5. Commands

```
cd apps/api && pnpm exec tsx --test --test-reporter=spec ../../tests/e2e/registration/*.test.mts
# today: 38 tests, 3 pass (oracle x2, endpoint inventory), 35 skipped (PENDING T-069)
```
