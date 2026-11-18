# Test Report: server registration (T-069), written before the implementation

**Tester:** Kiro Tester  
**Branch:** `feat/tester/server-registration`, on top of the T-069 contract `37805b6` (`packages/contracts/src/servers.ts`).  
**Status: RUN against T-069 (`5610a48`). See section 6.** Sections 1 to 5 describe the scenarios as written before the implementation landed.  
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


---

# 6. Run against T-069

**Code tested:** `feat/coder/server-registration` pinned at **`5610a48`**, trial-merged with `feat/coder/owner-auth` `41676cc` in a throwaway worktree (removed). Branch `feat/tester/server-registration`. No product file in any branch was changed.

## 6.1 Result: PASS. 35 scenarios pass, 1 NOT RUN, 3 defects held by `todo` scenarios (1 Medium, 2 Low).

| Suite | Result |
|---|---|
| Registration scenarios (`registration-live.test.mts`) | **35 pass, 0 fail, 1 NOT RUN (SR-52), 3 `todo` (D-R1, D-R2, D-R3)** |
| Process guard over the whole run | **0 attempts**: no process other than `/usr/bin/ssh-keygen`, no socket, no DNS lookup |
| 401 sweep (`routes-401`, every registered `/api` route including the 9 new ones) | **7/7** |
| ZT-01 real-host gate (`zt01-real-hosts`) | **13/13**: the 12 original tests plus the T-055 one from the care-loop round |
| Static checks: unique ids, every contract endpoint exercised, SSH oracle vs `ssh-keygen` | 4/4 |
| Typecheck of the registration tests | 0 errors |

**Safety record.** Read-only. No real host was contacted or registered, and no new SSH target was used. The registration binding is built from a **synthetic config with no hosts**, so the four real servers are never imported into its registry. ZT-01 runs on the real config as before, with its own spawn, socket and DNS guard (0 attempts). The guard in the registration run blocks everything but local `ssh-keygen`, and it recorded nothing.

## 6.2 How it is bound (what is the real product, what is faked)

| Real product code | Replaced (only these) |
|---|---|
| `buildServer` and the T-053 auth guard and session; `AddressPolicy`; `ServerRegistry`; the routes; the SQLite store; the **real key vault** (local `ssh-keygen` into a temp dir), so private-key searches use real keys; the **product's own collector `collectViaSsh`** with its real ssh argv, its own pinned `known_hosts` file and its fixed script; the `FleetService` | The host-key scanner, the TCP probe, the DNS resolver and the controller's own addresses (all answered from the fake network). The **ssh subprocess**: a fake `ssh` that acts as OpenSSH. It re-resolves the host name itself (so rebinding would show). It refuses without `StrictHostKeyChecking=yes` and `BatchMode=yes`, checks the host key against exactly the `known_hosts` file it was given, offers only the `-i` key, and answers with the product's nonce. |

Because the product's real argv and script reach the fake `ssh`, SR-32 also checks that **every script the product sent equals its own fixed collector script** for that nonce.

## 6.3 Results by requirement

| Requirement | Scenarios | Result |
|---|---|---|
| **Address validation** (Tech 6.2) | SR-01 to SR-07 | **7/7 pass.** 59 malformed or hostile inputs and 31 blocked literals refused before any lookup or connection. The controller and operator addresses are refused in every spelling and via DNS. Names resolving to a blocked address are never connected to. **DNS rebinding**: no connection to `127.0.0.1` or the metadata address. Private/CGNAT only inside the enrolled route. Ports: only 22 is allowed in this config, every other port is `ADDRESS_REJECTED` (answers R-3). |
| **Host key** (Tech 6.3, FR-02) | SR-10 to SR-15 | **6/6 pass.** The fingerprint shown equals my independent computation, the scan does not sign in, and only the exact owner-supplied fingerprint confirms. A key change after confirmation gives `HOST_KEY_CHANGED` at the first check, with **nothing offered** to the changed server. Evidence is stored: algorithm, fingerprint, `confirmedBy`, `confirmedAt`. |
| **Access key** (FR-03) | SR-20 to SR-24 | **5/5 pass**, plus SR-23b `todo` (D-R3). `restrict` and `from="<controller>"`, ed25519, fingerprint matches, one key per server. **No private key material in any response, header, log line or subprocess argument** (searched with the real key lines as needles). Key files are owner-only. AUTH_FAILED until the owner installs the line, and the same draft then succeeds. |
| **First check** | SR-30 to SR-32 | **3/3 pass.** Route, authentication, timeout and bad output get distinct codes and no coverage is claimed. A login without privilege is checked, not failed. Only the fixed script runs, and hostile server text is never shown. |
| **Activation, duplicates, edits** (FR-02) | SR-40 to SR-45 | **6/6 pass**, plus SR-41b `todo` (D-R2). Writes off, nothing run on activation, ten racing activations make one server. A duplicate address gives a draft whose `duplicateOf` names the existing server, and it cannot be activated. **The same host key under another address is flagged at confirmation and refused at activation** (`DUPLICATE_SERVER`), which answers R-4: detection already uses the host key. PATCH cannot set `writesEnabled`, the address, port, user or id. |
| **Disconnect and reconnect** (FR-03) | SR-50, SR-51, SR-53 to SR-55 | **5/5 pass**, plus SR-53b `todo` (D-R1). `remoteKeyRemoved: false`, schedules stopped, the controller's key deleted, the exact line and the steps returned, no server contacted. Nothing collected in the 24 h after. Reconnecting needs a fresh confirmation and a new key. **New guard SR-55:** disconnecting an *imported* server (how the four real servers are held) never deletes or changes the owner's own key file, and reports `controllerKeyDeleted: false`. |
| Queued/running operations on disconnect | SR-52 | **NOT RUN.** Registered servers are real-ssh servers with writes off, so no operation can exist for them. This also leaves R-5 open. |
| **Access control, contract** | SR-60, SR-61 | **2/2 pass.** 401 without a session, 403 without CSRF or with a foreign origin, on all 11 endpoints; every happy-path response matches the schemas. |

**Mutation checks (temporary edits in the trial worktree):**
- **"Any fingerprint confirms":** caught by SR-11.
- **"Metadata address not blocked" and "key issued while the host key is only seen":** both survive. On inspection they are equivalent mutants. `169.254.169.254` is still refused as link-local by a second check, and the next line refuses any state other than "confirmed". So they show defence in depth, not a gap in the tests.

## 6.4 Findings

| ID | Severity | Finding | Guard |
|---|---|---|---|
| **D-R3** | **Medium** | **An abandoned draft's private key stays on the controller indefinitely.** Expired drafts are swept only when the next draft is created (`registry.ts` `sweep()` is called from `createDraft` only). If the owner installed the public line on a server and then abandoned the draft, a working private key for that server remains in the key directory until they happen to start another registration. FR-03 and the credential rules call for access to be disabled when no longer needed. Suggest sweeping on a timer and on startup. | SR-23b `todo` |
| D-R2 | Low | **Re-registering an existing server under its own name does not lead to the existing record.** The name check runs before the duplicate check, so the answer is `INVALID_INPUT` "A server with this name already exists." with no pointer to the server, while a new name for the same address gets `duplicateOf` (FR-02 "flagged for resolution"). | SR-41b `todo` |
| D-R1 | Low | **A very long id gets the web framework's internal error body**, `{"error":"Bad Request","code":"FST_ERR_MAX_PARAM_LENGTH","message":"'/api/servers/aaaa…"}`, which is not the contract's error shape and **echoes the submitted path**. Seen on `/api/servers/:id/disconnect` and `/api/servers/drafts/:id`. | SR-53b `todo` |
| O-R1 | Observation | **A confirmed draft cannot be re-verified after a host-key change.** A rescan is refused with `STATE_CONFLICT`, and the change surfaces at the first check as `HOST_KEY_CHANGED`. Safe (nothing is offered to the changed server), but the owner must delete the draft and start again, and the message should say so. | SR-13 (both designs accepted) |
| O-R2 | Observation | Creating a draft for any address makes the controller **probe it over TCP**, and scanning reads its host key (a key exchange, no sign-in). Both are read-only, but registering one of the real servers' addresses would contact it. ZT-01 reviews these routes; I did not exercise them against real hosts. | ZT-01 inventory |
| I-4 | High (integration) | **`feat/coder/server-registration` is not built on T-053**, like care-gaps (I-1). The trial merge conflicts in `server.ts`, `index.ts` and the contracts barrel. `routes/servers.ts` imports the removed `CsrfGuard` type, and the registration and care routes still use the stub owner `"owner-dev-stub"`. I resolved it in the throwaway worktree by passing `csrf: null` (the global guard enforces CSRF) and the session owner, and by replacing the type import with an equivalent structural type. After that, Coder's own `routes/servers.test.ts` still does not typecheck. Coder should rebase on owner-auth. | - |

**Answers to section 3:** R-3 (ports) is configurable as `registration.allowedPorts` (default `[22]`), and others are refused. R-4 is answered: the host key is used. R-1 (production cannot be unset), R-2 (no privilege or sudo signal) and R-5 (disconnect does not report running operations) are unchanged.

## 6.5 My own corrections this round

- **"The first check never finished" on 15 scenarios** was my poll loop, which advanced simulated time without letting real time pass. The check finishes in about 200 ms. I added a 25 ms real wait per poll.
- **SR-22** collected the key needles after disconnect had deleted the keys, so the needles must be collected before.
- **SR-23** advanced 24 hours, which also expired the owner's 8-hour session (401). The auth clock in the binding is now real.
- **SR-13 and SR-42** assumed one design each: a rescan resetting the confirmation, and an alias flagged at scan time. The product's choices (rescan refused, alias flagged at confirmation) meet the same requirement, so both scenarios now accept either.
- **The ZT-01 inventory** is now a reviewed set with a reason per route, plus a check that the core routes exist, instead of one exact list. I checked that removing one reviewed entry makes it fail.

## 6.6 Recommendations

1. Rebase `feat/coder/server-registration` on owner-auth (I-4), in the same pass as care-gaps (I-1).
2. Fix D-R3: sweep expired drafts on a timer and at startup. Then D-R2 and D-R1.
3. Decide R-1, R-2 and R-5 (unchanged from section 3).

## 6.7 Files

```
tests/e2e/registration/support/binding.mts        binding to T-069 (real product paths, fake network and fake ssh subprocess)
tests/e2e/registration/registration-live.test.mts runner with the process guard; NOT RUN and todo reported, never passed
tests/e2e/registration/scenarios.mts, scenarios2.mts  SR-13/42 accept both designs; SR-22 order; SR-23b, SR-41b, SR-53b, SR-55 added
tests/e2e/registration/registration.test.mts      static checks only now
tests/e2e/care-loop/*                             care-loop-002 versions; ZT-01 inventory as a reviewed set incl. T-069 routes
```
Run (on code with T-069 and T-053): `cd apps/api && pnpm exec tsx --test --test-timeout=120000 ../../tests/e2e/registration/registration-live.test.mts`.
