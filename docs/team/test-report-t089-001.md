# Test report — T-089 end-to-end through the app on Sentani (t089-001)

**Author:** Kiro Tester · **For:** Kiro Orchestrator · **Date:** 2026-11-21 (11:36 to 11:55 UTC)
**Authority:** ADR-026 (writes enabled for Sentani only), ADR-021/022/024/025, T-088 gate verdict (`test-report-sentani-001.md` §7.2), T-089
**Code under test:** `integration/live-v1` at **`fd4bc03`** (includes T-089 `b4927c9`, T-092 helper 0.3.0, ADR-026 `fa83b7b`, and T-091 `b8e86ba`)
**Target:** Sentani only. Helper 0.3.0 per the last verification (to be re-confirmed at the start of the main run).

## Status: (1) to (5) PASS. (3) was run as the FAST variant (Addendum D). Gate verdict in Addendum D §3.

| # | Requirement | Status |
|---|---|---|
| (4) | Nabire, Timika, Merauke plans blocked `WRITES_DISABLED`, zero SSH writes | **PASS**, including at approval (§3.1) |
| (5) | restart, reboot and directory plans still refused | **PASS**, including at approval, for Sentani and a protected server (§3.2) |
| (1) | controller `previewDigest` equals the helper's package precondition rule | **PASS** (Addendum B) |
| (2) | plan → approve → dispatch → helper → independent verification → `succeeded`, with operation record and Activity entry | **PASS** (Addendum B), one defect on pre-approval disclosure (D-T2) |
| (3) | lost ack, client kill, API restart mid-operation reconcile to the same op, no duplicate | **PASS, fast variant** (Addendum D); the download-window variant was not run |

> ## ⚠ Founder's API on :3001 is DOWN (found 11:41 UTC, still down at 11:52)
> **Cause (read-only diagnosis, not touched by me):** `integration/live-v1` moved to `fd4bc03` (the T-091 merge, commits `38ba435` and `fd4bc03`) after the founder's API had started at 11:30:43. `apps/api/src/servers/registry.ts` now imports `inspectKeyOptions` from `@servrsit/ssh`, but `packages/ssh/dist` in the founder's checkout was built at **11:30:32**, before the merge, and does not export it. The founder's `tsx watch` restarted its child on the source change, and the child crashes at import with `SyntaxError: The requested module '@servrsit/ssh' does not provide an export named 'inspectKeyOptions'`. The watcher process is still running; the API child is not, and `curl` to :3001 is refused.
> **Likely fix (Orchestrator or Coder, not me):** rebuild the workspace packages in `/projects/servrsit` (`pnpm -r --workspace-concurrency=1 build`). I did exactly that in a private worktree of `fd4bc03` (1 m 44 s, clean), and `inspectKeyOptions` is then exported, so it is expected to work.
> **What I did not do:** I did not build, install or edit anything in the founder's checkout.
> **My own part, disclosed:** at about 11:36 I wrote one temporary file under `apps/api/src` for a few seconds, to seed my own settings copy, and removed it. `git status` was clean afterwards and the founder's process (pid 176455, started 11:30:43) was not restarted by it. It was down before my first failure at 11:41, and the cause is the stale `dist`, not that file. I should have used a path outside his tree, and did from then on.

## 1. Method and isolation

| Item | What I did |
|---|---|
| Code | The **unmodified** production entry point `apps/api/src/index.ts`, started as a second instance, under `strace -f -e trace=connect,execve`. Runs `a`/`c`/`d`/`e`/`f` (run `b` failed to start: the stale-`dist` error above) |
| Build | A private worktree `/tmp/t089/wt` of `fd4bc03`, built by me with the sequential command above. The founder's checkout was only read |
| Port and data | Port 38917. My own copies of every store: registry (a SQLite **backup-API snapshot** of the founder's registry), findings, activity, baselines, settings, auth, care, intents |
| Same as the founder's | `config/writes.json`, `config/test-bench.json` and `config/hosts.json` are byte-identical to his (sha256 compared). The manifest signing key and Sentani's maintenance key are **hard links** to his files (same inodes, no copy of key bytes): the product refuses a symlinked key directory ("must be a plain directory"), which is correct hardening. The Sentani registry row is `75e41a8a-6a97-4a06-8151-c0cb33ad0fc1` |
| Account | My own owner (`tester`, own password, own RFC 6238 code). Never the founder's. Credentials are in a 0600 file under `/tmp/t089`, outside the repository, and are not in any log or this report |
| No metered calls | `ai.enabled=false` seeded in my settings copy; none made |
| No background checks on other servers | Phase A: scheduler paused. Phase B: the three protected rows are marked `disconnected` in my copy (the registry's append-only and no-reconnect triggers prevent deleting them or reconnecting them), so the scheduler can only check Sentani |
| Evidence | `docs/team/evidence/t089-001/` (summaries only; raw `strace` logs contain key paths and stay in `/tmp/t089`) |

**What the instance itself sends outside:** DNS to the local resolver, and HTTPS to two public time hosts (142.251.x.x and 104.16.x.x) from the clock monitor. These happen in every instance, are not SSH, and go to none of the four servers.

## 2. First finding, an artefact of my setup: `IDENTITY_UNVERIFIED`

In my first run the Sentani package plan carried `IDENTITY_UNVERIFIED` ("host key and machine id not confirmed"). The cause is that the machine id comes from the **latest health check** (`ssh-write-target.ts` `machineId()`), and I had paused the scheduler. That is not a product defect. With the scheduler running against Sentani, the identity is verified and the plan shows only `NO_CHANGES` (instance `d`). This is also why the founder's own instance, with checks on, can approve.

## 3. Results that need no pending package

### 3.1 (4) Protected servers: PASS, down to approval (phase A, instance `e`, scheduler paused, protected rows connected)

Fresh registry snapshot and its own care database. For each case I created a plan and then **tried to approve it**, with the acknowledgements the plan asked for.

| Case | Plan | Approval | Operation created |
|---|---|---|---|
| Nabire `apply.packages.v1` | blockers `[WRITES_DISABLED]`, `approvable: false`, `previewDigest: "none"` | **409 `PLAN_BLOCKED`** `[WRITES_DISABLED]` | no |
| Timika `apply.packages.v1` (production) | `[WRITES_DISABLED]` | 409 `PLAN_BLOCKED` | no |
| Merauke `apply.packages.v1` | `[WRITES_DISABLED]` | 409 `PLAN_BLOCKED` | no |
| Nabire `reboot.host.v1` | `[WRITES_DISABLED]` | 409 `PLAN_BLOCKED` | no |
| Timika `restart.service.v1` `ssh.service` | `[WRITES_DISABLED, UNIT_NOT_SELECTED]` | 409 `PLAN_BLOCKED` | no |

**`strace` of the whole run:** **zero `ssh` launches** (`{}`), zero `connect()` to Nabire (100.117.187.86) and to Timika (100.120.143.103). Across **all five** instance runs, the only `ssh` ever started was `-l spotty -> sentani` (the inspect key, read-only), and no connection reached Nabire or Timika (`strace-summaries.json`).

Phase 1 (first run, `a`) gave the same `WRITES_DISABLED` results at plan time, with `strace` showing the same absence of contact.

### 3.2 (5) Refused kinds: PASS, down to approval (phase B, instance `f`, Sentani only, identity verified)

| Plan | Blockers | `approvable` | Approval | Operation created |
|---|---|---|---|---|
| Sentani `restart.service.v1` `ssh.service` | `[UNIT_NOT_SELECTED]` | false | 409 `PLAN_CHANGED` (see O-T1) | no |
| Sentani `restart.service.v1` `multipathd.service` | `[UNIT_NOT_SELECTED]` | false | 409 `PLAN_CHANGED` | no |
| Sentani `reboot.host.v1` | `[PLAN_UNAVAILABLE]` | false | 409 `PLAN_CHANGED` | no |
| Sentani `prepare.directories.v1` `/srv/app` | `[PLAN_UNAVAILABLE]` | false | 409 `PLAN_CHANGED` | no |
| Sentani `apply.packages.v1` (nothing pending) | `[NO_CHANGES]` | false | 409 `PLAN_BLOCKED` `[NO_CHANGES]` | no |

`strace`: only `-l spotty -> sentani` (3 launches: scheduler check and previews), none to a protected server. The Sentani gate is open in this instance (no "write access is closed" and no "no dispatcher" warning in its log).

## 4. Observations from this round

| ID | Severity | Where | Description |
|---|---|---|---|
| **O-T1** | Low | `apps/api/src/routes/care.ts` `currentDigest()` and `/api/plans/:id/approvals`; `apps/worker/src/ssh-write-target.ts` `previewService`/`previewBoot`/`previewDirectories` (always `null`) | Approving a blocked restart, reboot or directories plan on Sentani answers **`PLAN_CHANGED`**, not `PLAN_BLOCKED` with its blockers, because the approval-time re-check gets `null` for kinds the target cannot preview and answers before the store's own blocker check. The refusal and the safety are right, and the plan itself lists the real blockers with `approvable: false`, so the UI never offers approval. The reason code is misleading for an API caller or a log reader. Suggest checking `plan.blockers` before the digest re-check. For Coder |
| **O-T2** | Info, process | integration branch handling | A merge into `integration/live-v1` broke the founder's running API through a stale `dist`. A step that rebuilds after merges, or a start script that fails loudly on an out-of-date build, would prevent a repeat. For Orchestrator |
| **O-T3** | Info | T-091 | Once the founder applies the new inspect-key line (a forced command that runs only five reviewed scripts), **my own T-088 harness probes** (arbitrary read-only scripts over that key) will be refused, and I can no longer independently verify through that key. The app itself uses only the reviewed scripts. **Please do not apply the replacement line on Sentani until my run finishes, or tell me when it is applied** and I will switch my verification to the five allowed scripts |
| O-T4 | Info | registry | The registry's triggers make a server's disconnection and its event log irreversible, so every phase in my copy needed a fresh snapshot. Good product behaviour; noted only because it shaped the test setup |

## 5. What is left, and what I need from the founder

### 5.1 Why more than one downgrade round

The package plan covers **all** pending Ubuntu updates and has no way to select a subset (`PlanRequest` for `apply.packages.v1` carries only `serverId`). So each scenario consumes the whole pending set, and each needs its own downgrade round. All three commands were **simulated read-only on Sentani as `spotty`** with `apt-get -s` first:

| Round | Simulated result | Used for |
|---|---|---|
| **R1** vim set (5) + `wget` | 6 downgraded, 0 to remove, exactly those 6 | scenarios (1) + (2): happy path with `all`-architecture packages and the kept owner file `/etc/wgetrc` |
| **R2** LLVM set (3) | 3 downgraded, 0 to remove | scenario (3): the download phase lasts about 3 minutes, which gives a window for a lost ack and an API restart |
| **R3** `xkb-data` (1) | 1 downgraded, 0 to remove | left pending for the founder's own first update in the app |

`xkb-data` was chosen because it is a data-only leaf: architecture `all`, **no configuration files**, no service. My first candidate, `ncurses-term`, is **unsafe**: it depends on `ncurses-base (= the same version)`, so downgrading it would also downgrade an essential package.

### 5.2 (1) previewDigest equality: method (to run after R1)

1. Take the plan's `scope.packages` and `preconditions.previewDigest` from the API.
2. Compute independently, with my own canonical JSON and sha256: `digestOf({installed: {"name:arch": fromVersion, ...}})` over the packages sorted by key, as the helper's `precondition_digest` does, and compare with the plan's value.
3. Check that the helper accepts the manifest: the same digest is recomputed on Sentani at submit, so `accepted` (and not `PRECONDITION_CHANGED`) proves equality end to end. Also read the dpkg versions as `spotty` and compare.

### 5.3 (2) the happy path (after R1)

Plan → approve with the plan's digest, version, idempotency key and acknowledgements → watch the dispatcher → helper accepts → apt commit → independent verification by the app **and** by me (dpkg, apt history, unit journal as `spotty`) → `succeeded`. Then: `GET /api/operations/:id` events, the Activity entry, `keptOwnerFiles` for `/etc/wgetrc`, `restartNeeded`, and a repeat of the same approval (idempotency key) returning the same operation.

### 5.4 (3) lost ack, client kill, API restart (after R2)

One operation, with `strace` and a poll of the API's own `ssh` children:
- **Lost ack:** SIGKILL the API's gateway `ssh` client during the submit. Expect the app to query the same operation id before anything else, and no second manifest.
- **API restart:** SIGKILL the API process while the helper is in its download phase, restart it, and expect the reconciler to find the same operation and finish it.
- **Pass criteria:** one operation id, one `servrsit-op-…` unit, one apt history entry, `dpkg --audit` clean, no second submit with the same id.

### 5.5 Exact founder commands (Sentani, as `spotty`, own sudo; no scripts, no variables, each ends with a read-back)

**R1.** Simulation first. The last line must read `6 downgraded, 0 to remove`:
```
sudo apt-get -s install --allow-downgrades vim=2:9.1.0016-1ubuntu7 vim-common=2:9.1.0016-1ubuntu7 vim-runtime=2:9.1.0016-1ubuntu7 vim-tiny=2:9.1.0016-1ubuntu7 xxd=2:9.1.0016-1ubuntu7 wget=1.21.4-1ubuntu4 | tail -n 3
```
Then, only if it said exactly that (the same line without `-s` and without the pipe, and with `--force-confold` so the owner's `/etc/wgetrc` is kept):
```
sudo apt-get install -y --allow-downgrades -o Dpkg::Options::=--force-confold vim=2:9.1.0016-1ubuntu7 vim-common=2:9.1.0016-1ubuntu7 vim-runtime=2:9.1.0016-1ubuntu7 vim-tiny=2:9.1.0016-1ubuntu7 xxd=2:9.1.0016-1ubuntu7 wget=1.21.4-1ubuntu4
```
Read-back. All six must show the older versions (`…ubuntu7` and `1.21.4-1ubuntu4`):
```
dpkg-query -W -f='${Package} ${Version}\n' vim vim-common vim-runtime vim-tiny xxd wget
```

**R2** (only when the Tester says R1 is done). Simulation, then the real command, then the read-back:
```
sudo apt-get -s install --allow-downgrades libllvm18=1:18.1.3-1 libclang-cpp18=1:18.1.3-1 libclang1-18=1:18.1.3-1 | tail -n 3
sudo apt-get install -y --allow-downgrades libllvm18=1:18.1.3-1 libclang-cpp18=1:18.1.3-1 libclang1-18=1:18.1.3-1
dpkg-query -W -f='${Package} ${Version}\n' libllvm18 libclang-cpp18 libclang1-18
```
The simulation's last line must read `3 downgraded, 0 to remove`.

**R3** (only when the Tester says R2 is done; this one stays pending for the founder's first in-app update):
```
sudo apt-get -s install --allow-downgrades xkb-data=2.41-2ubuntu1 | tail -n 3
sudo apt-get install -y --allow-downgrades xkb-data=2.41-2ubuntu1
dpkg-query -W -f='${Package} ${Version}\n' xkb-data
```
Simulation: `1 downgraded, 0 to remove`. Read-back: `xkb-data 2.41-2ubuntu1`.

## 6. Gate status (provisional)

Unchanged from `test-report-sentani-001.md` §7.2 until (1), (2) and (3) run. What this round adds: the protected-server and refused-kind guarantees now hold **through approval** in the real app, not only at plan time, with `strace` evidence of zero contact. **T-089 must not be closed yet.**

## 7. State left behind

- **My instance:** stopped (no process left). My databases and the private worktree `/tmp/t089/wt` (with the hard-linked key files, in a 0700 directory) are kept for the resumed run and will be removed when the task ends.
- **Sentani:** nothing changed by me this round. Sentani has no pending Ubuntu updates, and the owner's `/etc/wgetrc` edit is still in place.
- **Founder's checkout:** not modified by me (see the disclosure above).
- **Commits:** `tests/live/t089/` (library and scenarios), probes added to `tests/live/t088/h.mts`, this report and its evidence.

---

## Addendum A: re-verification against the founder's rebuilt build (12:05 to 12:38 UTC)

**Status: the stale-`dist` incident is resolved. (1) to (3) still wait for founder round R1, which had not landed by 12:38.**

**The founder's build (read-only checks):**
- His checkout is at `695f25e`, which is `fd4bc03` plus one commit that changes only `.kiro/steering/structure.md`. No code differs from what I tested.
- `packages/*/dist` were rebuilt at 12:05. `packages/ssh/dist/index.js` exports `inspectKeyOptions`, and :3001 answers HTTP 200 again.
- The built output of `ssh`, `domain` and `store` is **byte-identical** to my private worktree's build (sha256 over every `.js` file).

**What changed in my setup:**
- My instance now runs **from the founder's checkout**: the same code and the same `dist` his API runs, with its plain `.data/helper` directory.
- The private worktree and the hard-linked key files are **removed**. The two key files are back to one link each (mode 600).
- His `git status` was clean after my runs.
- **This supersedes the hard-link and worktree method in §1.**

**Verified again on the founder's build** (instance `g`):
- The write gate is open: `writesEnabled ["sentani"]`, with no "write access is closed" or "no dispatcher" warning.
- Sentani's identity is verified after its first health check, and its package plan shows only `NO_CHANGES`.
- The helper answers over the gateway as **version 0.3.0**.
- `git status` in his checkout: 0 changes.

**Self-test of the oracle for (1):** my Node digest function and my independent Python canonicalizer (the one from the helper suite) give the same value for the same input, `sha256:b5dbb502…52e5`. Both are written from the helper's rule text (`digest_of({"installed": {"name:arch": version}})` over sorted keys), not from the product.

**R1 not applied at 12:37:58:**
- All six packages are still at the newer versions (vim set `…ubuntu7.20`, wget `1.21.4-1ubuntu4.5`).
- There has been no apt activity since my own `wget` update at 10:27:45, no dpkg lock and no hold.
- My script waited read-only for 25 minutes. **Nothing was sent to Sentani.**
- My instance is stopped.

**To resume:** `node tests/live/t089/s3-happy.mjs` (from node 24). It starts my instance if it is not up, waits for the first health check, waits read-only for R1, then runs (1) and (2) end to end.

**Two coordination points while my operations run:**
1. **Please don't approve anything in the founder's own app on Sentani.** The helper allows one unresolved mutation per server, so two instances would collide on `TARGET_BUSY`.
2. **Please keep the T-091 forced-command inspect line off Sentani** until the run is finished (O-T3).

---

## Addendum B: (1) digest equality and (2) the happy path, through the app (13:01 to 13:02 UTC)

**Founder round R1** (read-back by the founder, then my own read-only check at 13:01:32): `vim`, `vim-common`, `vim-runtime`, `vim-tiny`, `xxd` at `2:9.1.0016-1ubuntu7` and `wget` at `1.21.4-1ubuntu4`. `/etc/wgetrc` unchanged by the downgrade (sha256 `658b6a5de6aa…9774`, md5 `e5cca7a09bcf…`, one owner marker line). Helper 0.3.0, confirmed over the gateway. `apt-get -s upgrade` showed exactly those 6 packages, all from `noble-updates`/`noble-security`, with no third-party origin.

**Instance:** my own, run from the founder's rebuilt checkout (Addendum A). Run log: `evidence/t089-001/s3-happy-path-run.txt`; summary: `s3-happy-path-summary.json`.

### (1) previewDigest equality: PASS

| | Value |
|---|---|
| Controller's `plan.preconditions.previewDigest` | `sha256:b13f31fdb34d33af5c351bf693546782b2173113a8fc8c314eeca6ab59499b02` |
| My independent computation (own canonical JSON; the helper's rule `digest_of({"installed": {"name:arch": fromVersion}})` over the 6 sorted keys, including `vim-common:all` and `vim-runtime:all`) | `sha256:b13f31fdb34d33af5c351bf693546782b2173113a8fc8c314eeca6ab59499b02` |
| **Equal** | **yes** |

End to end, the helper recomputes the same rule on Sentani at submit and would have rejected the manifest with `PRECONDITION_CHANGED` on any difference. The event log shows `remote_accepted`. My Node and Python digest implementations also agree with each other (Addendum A).

### (2) Happy path: PASS

Plan `eac19992…` v1: 6 packages, `blockers: []`, `approvable: true`, no acknowledgements required (non-production server), nothing excluded.

| Step | Result |
|---|---|
| Approve (digest, version, idempotency key) | **201**, operation `02f6c275-40e0-459a-a7cc-9e94745d3153`, `queued` |
| **Same approval again** (same idempotency key) | **200**, `replayed: true`, **the same operation id** |
| States over time | `queued` +5 s → `running` +11 s → `verifying` +29 s → **`succeeded` +35 s** |
| Events | `created` → `dispatch_attempted` 13:01:50 (manifest digest `sha256:803e8849…861f`, `retry: false`) → `remote_accepted` 13:01:53 → `remote_progress` ×2 → `remote_finished` 13:02:10 (exit 0, helper 0.3.0, outcome `succeeded`, `restartNeeded: []`, `keptFiles: [{path: /etc/wgetrc, newDefault: null}]`) → `verification_recorded` 13:02:15 (**6 verified, 0 not verified**) |
| Helper ledger, queried by the same operation id | `finished`, exit 0, `succeeded`; the manifest digest equals the one in `dispatch_attempted`; evidence "6 of 6 packages at the planned version", "no service needs a restart", "your file was kept: /etc/wgetrc (this version brought no new default for it)" |
| Activity entry | 1 record: `op-02f6c275…`, "Update packages", result `succeeded`, "Finished, and the result was verified.", link `/operations/02f6c275…` |

**My own checks on Sentani, not through the app or the helper (as `spotty`):**
- **dpkg:** all 6 packages at the planned versions, state `ii`; `dpkg --audit` clean.
- **apt history:** exactly **one** transaction, 13:01:55 to 13:02:00, upgrading those 6 packages.
- **Journal:** the operation's `servrsit-op-…` unit started **once**.
- **Owner's file:** `/etc/wgetrc` sha256 and md5 **identical before and after**, owner marker line still present, `dpkg --verify` still shows it as locally changed. No `.dpkg-dist`: this wget ships the same default.
- **Services:** the only difference in the running-service list is `user@999.service`, the per-login user manager of the `servrsit` gateway account, which restarts with my SSH sessions. It is not a package effect. The upgrade restarted nothing, as `restartNeeded: []` says.

### New finding

| ID | Severity | Where | Description |
|---|---|---|---|
| **D-T2** | Low (disclosure; no data effect) | `packages/domain/src/plan.ts` reads `preview.keptConffiles`; **nothing in the real preview sets it** (`packages/ssh/src/preview.ts`, `apps/worker/src/ssh-write-target.ts`); only test doubles do | The T-092 handoff says "the package plan's scope gets `keptOwnerFiles`", and `PlanView.keptOwnerFiles` is wired in the web client. On the real Sentani target the plan has **no** `keptOwnerFiles`, although `/etc/wgetrc` was owner-modified and would be kept. The owner is told only **after** the run (the `keptFiles` in the operation record and events). The helper behaves correctly and keeps the file, and the safety is intact. But product principle 4 (a meaningful approval) and ADR-024 intend the owner to see before approving which of their files will be kept. Fix: have the read-only preview return the `dpkg --verify` result for the plan's packages as `keptConffiles`. For Coder |

**Status of the gate conditions:** the last open condition from `test-report-sentani-001.md` §7.2 (controller digest equals the helper's rule) is now **met**. Scenario (3) is the remaining condition for T-089.

**State left behind:** my instance is stopped. Sentani now has **no pending Ubuntu updates** again, and the owner's `/etc/wgetrc` edit is intact. His checkout's `git status` is clean.

**Next:** round R2 (LLVM set, §5.5) for scenario (3).

---

## Addendum C: scenario (3) is prepared and tested; waiting for one founder line (13:31 UTC)

**R2 is in place.** The founder's read-back shows `libllvm18`, `libclang-cpp18` and `libclang1-18` at `1:18.1.3-1`. My own read-only check at 13:27 shows exactly those 3 pending (`apt-get -s upgrade`: 3 upgraded, 0 to remove), no dpkg lock and no hold.

**The cache clean has not been done.** All six LLVM `.deb` files, both versions, are still in `/var/cache/apt/archives` (checked at 13:27 and again at 13:30), and `APT::Periodic::AutocleanInterval "0"`, so nothing cleans them by itself. In my T-088 3c runs, the first operation spent about 3 minutes on the download, and the redo, with the files cached, took about 10 seconds. With the cache full, the operation would finish about 10 seconds after approval, which leaves no time for the lost-ack kill, the API crash and the recovery. **I did not consume R2 on a test that could not show the result.**

**What is ready (`tests/live/t089/s4-lostack.mjs`):**
- **Pre-flight refusal:** read-only. It refuses unless R2 is in place, no lock or hold exists, and no LLVM `.deb` is cached. Tested: it exits with code 6 and the message above while the cache is full.
- **One operation, three phases:**
  1. Plan and approve; check the digest again.
  2. **Lost ack:** SIGKILL the API's own gateway `ssh` client during the submit. Then my own independent gateway query shows whether the helper has the operation, and the app is watched as it re-finds it by id.
  3. **API crash:** SIGKILL the API process while the helper is still working. Restart it, sign in again, and follow the operation to the end.
- **Pass criteria:** one operation id, one `servrsit-op` unit, one apt transaction, `dpkg --audit` clean, and the same manifest digest in every event and in the helper's record.

**Mechanics tested without touching R2** (harmless read-only plan previews as load):
- The API's own `ssh` child is detected within 100 ms of starting.
- A SIGKILL of the API followed by a restart and re-login works, and the port is freed.
- **A bug found and fixed:** the pid of the detected child was a string, and `process.kill()` needs a number. A real run would have crashed at the first kill. It is fixed and tested on a harmless child.

**What I need:** the founder runs `sudo apt-get clean` and checks that `ls /var/cache/apt/archives/*.deb` says "No such file or directory". That removes only cached `.deb` files, and apt re-downloads them on demand.

---

## Addendum D: scenario (3), lost ack and API crash, through the app (13:35 UTC)

**Variant: FAST.** Sentani's apt cache still held all six LLVM `.deb` files (6 cached, autoclean off), so the helper's operation took about 13 seconds, not the 3-minute download of the slow variant. The Orchestrator directed me to run anyway, since R2 was in place and the founder was waiting. My script therefore crashed the API **right after the lost ack**, the moment the app knows nothing about the outcome, instead of waiting for the app to re-find the operation first. I label what that does and does not prove in §2.

### 1. What happened (one operation, my own instance, 13:35:09 to 13:35:38)

R2 as the founder left it, checked read-only just before: `libllvm18`, `libclang-cpp18`, `libclang1-18` at `1:18.1.3-1`; exactly those 3 pending; no lock; no hold. Plan `b81aeb3a…` v1, `approvable: true`; the controller's `previewDigest` again equals my independent computation (`sha256:3b7cabad84e0…`).

| Time (UTC) | Event | Source |
|---|---|---|
| 13:35:09.564 | approve → operation **`0fd8fc23-ff43-49bc-bf9e-0eae63966011`**, `queued` | app |
| 13:35:12.767 | `dispatch_attempted`, manifest digest `sha256:7e065dc0…3ad49`, `retry: false` | app |
| 13:35:12.802 | my script sees the API's gateway `ssh` client (pid 230834) | my watcher |
| **13:35:13.803** | **LOST ACK: SIGKILL of that client during the submit** | me |
| 13:35:13.809 | the app records `transport_error {during: "submit"}`; state stays `queued` | app |
| 13:35:15 | the helper's unit `servrsit-op-0fd8fc23…` **starts** (about 1.2 s *after* the client was killed) | Sentani journal |
| **13:35:15.345** | **API CRASH: SIGKILL of the API process (pid 230639).** The app's last state was `queued`, with 3 events recorded and no `remote_accepted` | me |
| 13:35:16 | my own gateway query while the API is down: **found, `running`, digest `sha256:7e065dc0fec0`**, the same digest | helper |
| about 13:35:20 | API restarted (new process); the app **reconciles on its own** | app |
| **13:35:20.962** | **`remote_accepted {how: "reconciled-before-retry", remoteState: "running"}`**: it asked the helper about the same id before sending anything | app |
| 13:35:26.756 | `remote_progress` (running) | app |
| 13:35:28 | the helper's unit finishes (12.1 s CPU) | Sentani journal |
| 13:35:32.529 | `remote_finished` (exit 0, helper 0.3.0, `succeeded`, `restartNeeded: []`, `keptFiles: []`) | app |
| 13:35:38.098 | `verification_recorded`: **3 verified, 0 not verified**; state **`succeeded`** | app |

### 2. What it shows

- **Lost ack:** the client was killed during the submit, but the request had already reached the sshd gateway, and the helper accepted it **after** the client had died. This matches the T-088 helper-level result (3a(ii)): disconnection is no evidence that a command stopped.
- **The harshest crash point:** the API died holding a `dispatch_attempted` and a `transport_error`, with no idea whether the manifest had arrived. After the restart it did not resubmit. It queried the same remote id first (`reconciled-before-retry`, invariant 7), found it `running`, and followed it to the end.
- **The API was down while the helper was working:** it restarted at about 13:35:20, and the helper was still running until 13:35:28. So the recovery happened with the operation in flight on Sentani, not only after it finished.
- **No duplicate:** see §3 for the independent evidence.

**Not shown by this variant (honest limits):**
1. A crash during a **long** helper download, as the slow variant would give. The recovery logic is the same, but the helper's run state differs.
2. A client kill that lands **before** the request is delivered, so that the app must resubmit the identical manifest (`retry: true`). Here the request was delivered. That path is covered at the helper level (T-088 3a(i)) and by the worker's own tests, but was **not exercised through the app** on a real server.
3. A second lost ack on the retry (my script's second-kill branch was not needed).

### 3. Pass criteria, checked independently as `spotty` (not through the app or the helper)

| Criterion | Result |
|---|---|
| One operation id | the app, the helper's ledger and the journal all use `0fd8fc23-ff43-49bc-bf9e-0eae63966011`; the helper's record is single |
| One `servrsit-op` unit for this id | **1** `Started` line in the journal |
| One apt transaction | **1**: 13:35:18 to 13:35:23, `Upgrade:` exactly the 3 LLVM packages |
| `dpkg --audit` | **clean** (exit 0, no output) |
| Packages | **3 of 3** at `1:18.1.3-1ubuntu1`, state `ii` |
| No second dispatch | **1** `dispatch_attempted` event, `retry: false` |
| Same manifest digest throughout | **one** digest in every app event, and the helper's record carries the same `sha256:7e065dc0…` |
| Helper ledger, queried by the same id | `finished`, exit 0, `succeeded`; evidence "3 of 3 packages at the planned version", "no service needs a restart" |
| Activity entry | 1: "Update packages", `succeeded` |
| Pending afterwards | none: `apt-get -s upgrade` shows 0 to upgrade (only the 11 phased systemd packages remain) |
| Services | no running service changed PID or start time. Only `packagekit.service` differs: it is D-Bus-activated by apt's hook (O-S3, still present on helper 0.3.0), not a restart by the update |

**`strace`:** instance 1 started 3 inspect-key and 2 gateway `ssh` clients, and instance 2 started 3 gateway and 2 inspect-key ones. All went to Sentani. None went to any other server.

### 4. Gate verdict for T-089 (Sentani only)

**All five conditions of the Orchestrator's brief are met on real Ubuntu, on the build the founder runs (`fd4bc03`):**
1. The controller's `previewDigest` equals the helper's precondition rule (equal, and the helper accepted it).
2. Plan → approve → dispatch → helper → independent verification → `succeeded`, with the operation record and an Activity entry, and an idempotent replay of the approval.
3. A lost ack, a client kill and an API crash mid-operation reconcile to the same operation, with no duplicate.
4. Nabire, Timika and Merauke are blocked `WRITES_DISABLED`, including at approval, with zero `ssh` to them.
5. Restart, reboot and directory plans are still refused, including at approval.

**GO to close T-089 for Sentani.** The decision to close is the Orchestrator's.

**Still NO-GO for any other server.** Open items:
- **D-T2** (Low): the plan does not list kept owner files before approval on a real target.
- **O-T1** (Low): approving a blocked restart, reboot or directories plan returns `PLAN_CHANGED`, not `PLAN_BLOCKED`.
- **O-S3**: `packagekit` is started by apt's hook.
- **D-S1** (the CLI's default known-hosts pin).
- **T-091:** the forced-command inspect line is merged but **not applied on Sentani**, so the inspect key there is still a full shell. It must be applied and re-verified before any real server follows.
- **Not tested on a real server:** the slow-window variant above, a reboot that returns late, root-side out-of-space, and uninstall.

**State left behind:** my instance is stopped. Sentani has **no pending Ubuntu updates** (R3 will leave one). The owner's `/etc/wgetrc` edit is intact. The apt cache still holds its 22 `.deb` files, which is harmless.
