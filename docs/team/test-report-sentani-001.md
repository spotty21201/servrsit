# Test report — T-088 helper on Sentani, real Ubuntu (sentani-001)

**Author:** Kiro Tester · **For:** Kiro Orchestrator · **Started:** 2026-11-21
**Status:** steps P, 1 and 3a/3b **final** (runs 07:03 to 07:05 UTC, commit `cf2a16b`). Step 2 **final** (07:38 to 07:40 UTC). F2 (held package) and F3 (lock) **final** (07:51 and 08:10 UTC). 3c **final** after the redo (first run 08:15 UTC landed before dpkg; redo 08:28 UTC landed 3 kills inside dpkg). Step 4 (reboot) **final** (08:30 to 08:32 UTC). Step 5 (disk) **final** (08:33 to 08:34 UTC). **All T-088 steps in this round are done**; see section 5 for what is still open (mid-dpkg kill) applies the LLVM set, then steps 4 and 5. **Orchestrator decision (after step 2):** F2, F3 and 3c run on the CURRENT helper (`4101502`). Any result that touches needrestart or debconf is labelled **[PRE-FIX]**. Step 2 and a needrestart/conffile case are re-run after T-090 (fixes for D-S5 to D-S7) is installed.
**Authority:** ADR-021 (Sentani is disposable; fault injection allowed on Sentani only), ADR-022 (helper installed by the founder; T-088 rules), T-088
**Target:** Sentani ONLY. Host `sentani` resolves to 100.119.231.102 (checked before every send). The pin comes from registry row `75e41a8a-6a97-4a06-8151-c0cb33ad0fc1`: its `known_hosts_file` holds only Sentani, with the owner-confirmed key `SHA256:j3nno/hlFOSktmjBlrxPO9oTE3qWFmITlKgKTIt+JrM` (confirmed 2026-11-21T05:44:58Z). Nothing was sent to Nabire, Timika or Merauke.
**Helper on Sentani:** package `servrsit-helper-0.1.0.tar.gz`, sha256 `8f25e5a3…a6d0d6`. Rebuilding from integration/live-v1 `4101502` gives the identical checksum, so the installed code is `target-helper/` at `4101502`, which includes T-084.
**Harness:** `tests/live/t088/h.mts`. It uses the bench signer (`ctrl-…` Ed25519 key) and the product's hardened `buildSshArgv`, and spawns `ssh` itself so it can kill the local client at a chosen moment. Every send is logged with the manifest digest and the reply.

> **Not used:** the CLI's default `apps/api/.data/known_hosts`. It pins Sentani's pre-reinstall key (`nhrV6…`), which ADR-021 makes void, and it also pins Timika and Nabire.

## 0. Gate before going live (fake root, no server)

My suite (`feat/tester/next`, `tests/helper`) against the installed source `4101502`: **126/126 passed**. H12 and H18 (race and torn-record tests) passed **10/10** on repeat. Against the old `6c7df23`, the same suite fails 8 tests, so it does separate fixed code from old code. Three tests were adapted to the T-084 layout without weakening them: H04b now asserts that duplicate JSON keys are refused, H42 checks the `$OPTIONS` key line, and H44 checks `account-remove-key.sh`.

## 1. Plan (in order of increasing risk)

| Step | What | Mutation on Sentani | Root outside helper? |
|---|---|---|---|
| P | Read-only probes as `spotty` (inspect key, fixed scripts, nothing interpolated): clock, boot id, disk, `apt-get -s upgrade`, dpkg versions, running services, holds, timers, needrestart config | none | no |
| 1a | `query.operation.v1` for an unknown id | none | no |
| 1b | Rejections: bad signature, unknown key id, wrong installation id, expired, unsupported op, oversize input, a 5,000-digit integer (D-H1), duplicate keys (D-H5) | none expected | no |
| 1c | Replay and digest checks with one real accepted op: `prepare.directories.v1` creating `~spotty/servrsit-t088-replay` (spotty:spotty 0755). Then the same id with the same digest gives `existing`, and the same id with another digest gives `DIGEST_MISMATCH` | one empty directory (spotty removes it afterwards) | no |
| 2 | `apply.packages.v1` with the exact pending Ubuntu-archive updates from a fresh `apt-get -s upgrade`, excluding Docker and other third-party origins. Precondition uses the helper's rule over the observed `from` versions. Versions are verified independently with `dpkg-query` as spotty, and service start times are compared before and after (checks for needrestart restarting services without a separate approval) | package upgrade | no |
| 3a | Kill the local ssh client **before acceptance**: (i) send half the request, then kill; (ii) send all of it, keep stdin open, then kill. Retry = query the same id first | (i) none; (ii) may be accepted | no |
| 3b | Kill **right after acceptance**, before the reply is read. Query first; never resubmit a different manifest | one directory | no |
| 3c | Kill the client **mid-dpkg** of an apply, then query until finished. Never a second transaction (one `servrsit-op-<id>` unit, one dpkg run in the logs) | package upgrade | needs a pending update. If step 2 used them all, a founder downgrade step is required |
| 4 | `reboot.host.v1` with return verification: new boot id, SSH back as `spotty` and `servrsit`, and the helper's query settles `succeeded` | reboot | no |
| 5 | Disk pressure as `spotty`: fill files under `~spotty/servrsit-t088-fill/` until only a small margin is free. Check the helper's behaviour (ledger write fails closed; apply refused or failed, never half-recorded). Remove the files and check `df` returns to the earlier value | files as spotty | no |
| F | External apt lock, `apt-mark hold`, and any downgrade needed for 3c: exact founder commands in `docs/team/t088-founder-steps.md`, then **STOP** | — | yes, founder only |

**Stop rules:**
- An unexpected `outcome_unknown`, a runner unit still running after 15 minutes, or SSH not returning after a reboot within 10 minutes: I stop, record it, and ask the founder. I don't intervene.
- Any reply that suggests a second transaction: I stop.
- No password is asked for or used.

## 2. Runs

All times are UTC on 2026-11-21. Op = first 8 hex characters of the operation id. Digest = the 12 hex characters after `sha256:` of the manifest digest. The full digests and replies are in the local run log `/tmp/t088/runs.jsonl`. It is not committed, because it is raw server output.

### P — read-only baseline (as `spotty`, inspect key)

- **Clock:** Sentani agrees with the controller to within the SSH round trip, about 1.2 s.
- **System:** boot id `c456de4b-ff23-44e7-9ed0-78a1da95a498`, up since 05:22:32. Ubuntu 24.04. needrestart 3.6-7ubuntu4.6 is installed (`99needrestart` hook).
- **Disk:** `/` has 230.8 GB available out of 249.3 GB.
- **apt:** no apt or dpkg process running and no holds. Package lists are from 2026-11-21 ~04:52 (`update-success-stamp` 1795236767). apt-daily-upgrade last ran 06:29, next 2026-11-22 06:14.
- **Pending updates:** `apt-get -s upgrade` shows **0 to install and 11 kept back**. All 11 are deferred by Ubuntu phasing: `libnss-systemd libpam-systemd libsystemd-shared libsystemd0 libudev1 systemd systemd-dev systemd-resolved systemd-sysv systemd-timesyncd udev`. `dist-upgrade` gives the same result. There is no Docker origin. The only third-party source is Tailscale, and nothing from it is pending.

### 1 — query and rejections [FINAL]

| Time | Kind | Input | Op | Digest | Mode | Reply / ledger |
|---|---|---|---|---|---|---|
| 07:03:49 | query | unknown id `00000000-…0001` | — | — | normal | `found: false`, helperVersion 0.1.0 |
| 07:03:51 | raw | valid request, one signature bit flipped | — | — | normal | rejected `INVALID_SIGNATURE` |
| 07:03:52 | raw | keyId `ctrl-0000000000000000` | — | — | normal | rejected `UNKNOWN_KEY` |
| 07:03:53 | raw | 300 KiB request | — | — | normal | rejected `INVALID_REQUEST` "the request is too large" |
| 07:03:54 | raw | 5,000-digit integer (D-H1) | — | — | normal | rejected `INVALID_REQUEST` (no traceback) |
| 07:03:54 | raw | duplicate `"op"` key (D-H5) | — | — | normal | rejected `INVALID_REQUEST` |
| 07:03:55 | raw | query id `../../etc/shadow` | — | — | normal | rejected `INVALID_REQUEST` |
| 07:03:56 | submit | installationId `servrsit-someone-else-1`, validly signed | 838170c1 | e155c3be82aa | normal | rejected `MISBOUND` |
| 07:03:57 | submit | acceptBefore 05:15 (past), validly signed | 838170c1… | 20b9d3418402 | normal | rejected `EXPIRED` |
| 07:03:58 | submit | operation `shell.run.v1`, validly signed | 838170c1… | ade239a6cae6 | normal | rejected `UNSUPPORTED_OPERATION` |
| 07:04:17 | submit | `prepare.directories.v1` `~spotty/servrsit-t088-replay` | a2e38565 | ef8c87a59b2d | normal | **accepted** |
| 07:04:21 | query | | a2e38565 | ef8c87a59b2d | normal | finished, exit 0, outcome **succeeded** ("1 of 1 verified with the planned owner and mode") |
| 07:04:22 | submit | identical manifest again | a2e38565 | ef8c87a59b2d | normal | **existing** (same record) |
| 07:04:24 | submit | same id, other directory | a2e38565 | faaf4eb889c9 | normal | rejected **`DIGEST_MISMATCH`** |
| 07:04:24 | query | | a2e38565 | ef8c87a59b2d | normal | unchanged: finished, succeeded |

**Independent checks (as spotty):**
- `~spotty/servrsit-t088-replay` is spotty:spotty 755 directory.
- `~spotty/servrsit-t088-other` and `…-reject` do not exist.
- The journal shows **one** `servrsit-op-a2e38565…` unit: started 07:04:16, deactivated successfully 07:04:17.

All SSH exits were 0, and no reply carried a traceback.

### 3a / 3b — killing the local ssh client [FINAL] (SIGKILL), retry = query the same id first

Each case used its own `prepare.directories.v1` operation. The retry rule: query the same id. If not found, resubmit the **identical** manifest. If found, do nothing. Never use a new id.

| Time | Case | Op | Digest | What was sent before the kill | Kill | First query | Retry action | Final |
|---|---|---|---|---|---|---|---|---|
| 07:05:08 | 3a(i) before acceptance | 1063c121 | 7cf23dcdaea1 | first 200 bytes, stdin held open | 3,005 ms | **not found** | resubmitted identical manifest at 07:05:13, accepted | finished, succeeded |
| 07:05:20 | 3a(ii) full request, no EOF | 1ce216e5 | d17208dde3a3 | whole request, stdin held open | 3,006 ms | **found, finished, succeeded** | none | finished, succeeded |
| 07:05:36 | 3b reply lost | 8b9d59be | b15cca950930 | whole request + EOF | 704 ms, no reply received | **found, finished, succeeded** | none | finished, succeeded |
| 07:05:26 | (control) | 8014c6e1 | 5402bd8ca712 | whole request + EOF | 1,000 ms planned; reply came first at 781 ms | found | none | finished, succeeded |
| 07:05:31 | (control) | 8a3b55b1 | 4bcc8838c9ad | whole request + EOF | 1,150 ms planned; reply came first at 773 ms | found | none | finished, succeeded |

**Independent check:** the journal shows 6 `servrsit-op-*` units in total (1c plus the five above), each **started exactly once**. All five directories existed as spotty:spotty 755. All six test directories were removed afterwards by spotty with `rmdir` (only empty directories can be removed that way). The helper's ledger keeps their records.

**Finding (3a(ii)):** the client was killed while the helper was still waiting for end-of-input. When sshd closed the session, the gateway got EOF with the **complete** request and the helper accepted and ran it. The client never saw a reply. This proves invariant 6 on real Ubuntu: a dropped connection is no evidence that nothing happened. Querying first was the only thing that stopped a duplicate.

### 2 — real `apt-get`-equivalent transaction through the helper [FINAL]

**Founder F1** (Orchestrator's `f1.sh`, verified by Orchestrator): 8 packages downgraded at 07:36:19 to 07:36:29 UTC. apt history records it as `Requested-By: spotty (1000)`.

**Split:** step 2 applies the **vim set** (5 packages). The **LLVM set** (3 packages) stays pending for the F2 hold test, the F3 lock test and 3c, which need a pending update. Each of those would otherwise need another downgrade. All 8 go through the helper.

**Fresh read-only observation, 07:37 UTC (as spotty):**
- Clock: Sentani's clock and the controller's agree to the second.
- Boot id `c456de4b…`, unchanged.
- No apt or dpkg process running, no holds.
- `apt-get -s upgrade`: **8 upgraded, 0 newly installed, 0 to remove**. All 8 come from `Ubuntu:24.04/noble-updates` (and `noble-security` for the vim set). No third-party origin is involved.
- The manifest's `from`/`to` versions and architectures were taken from these `Inst` lines.

**python-apt key check (read-only, as spotty, through the helper's own library):** `cache["vim-common:all"]` and `cache["vim-runtime:all"]` resolve, but their `fullname` is `vim-common:amd64` and `vim-runtime:amd64`. This predicts D-S5.

| Time | Run | Op | Digest | Scope | Ledger / outcome | Independent check |
|---|---|---|---|---|---|---|
| 07:38:25 | 2a, architectures exactly as apt prints them (`vim-common`, `vim-runtime` = `all`) | 254d3315 | 9d194d8e9a01 | 5 vim packages | accepted, then finished, **exit 1, `failed`**: "the transaction would change other packages; nothing was changed", "0 of 5 packages at the planned version" | dpkg: all 5 still at `2:9.1.0016-1ubuntu7`; dpkg.log shows no change; one unit, 07:38:27 to 07:38:29 |
| 07:38:50 | 2b, same 5 packages, all labelled `amd64` (python-apt's convention) | 24793587 | 9a2b5042c03f | 5 vim packages | accepted, then finished after ~45 s, **exit 0, `succeeded`**: "apt commit returned success", "5 of 5 packages at the planned version" | see below |

**Independent verification of 2b (as spotty, not through the helper):**
- **dpkg:** a full `dpkg-query` diff before and after shows **exactly 5 lines changed**, `vim vim-common vim-runtime vim-tiny xxd` `2:9.1.0016-1ubuntu7` → `2:9.1.0016-1ubuntu7.20`. Every package is still in state `ii`. The LLVM set is unchanged at `1:18.1.3-1`.
- **dpkg.log:** 5 `upgrade` lines at 07:39:29 to 07:39:31, then `status installed`, plus the `man-db` trigger at 07:39:33. The trigger is not a version change.
- **apt history:** one transaction, 07:39:28 to 07:39:33, `Upgrade:` the 5 packages, with no Commandline or Requested-By line (python-apt commit). apt itself lists the `all` packages as `:amd64`.
- **Journal:** one `servrsit-op-24793587…` unit, started 07:38:53, finished 07:39:39, 12.0 s CPU.
- **`apt-get -s upgrade` afterwards:** 3 to upgrade, only the LLVM set.
- **Services:** all 23 running services kept their PID and start time.
- **needrestart under the helper** (read-only: the needrestart config, the apt hook, and the 2b unit's journal; spotty is in group `adm`):
  - **It runs.** `/etc/apt/apt.conf.d/99needrestart` sets `DPkg::Post-Invoke {"… /usr/lib/needrestart/apt-pinvoke -m u …"}`. Inside the transient unit, after dpkg finished, `servrsit-runner[8401]` logged at 07:39:34: "Running kernel seems to be up-to-date. The processor microcode seems to be up-to-date. **No services need to be restarted.** No containers need to be restarted. No user sessions are running outdated binaries. No VM guests are running outdated hypervisor (qemu) binaries on this host."
  - **Mode: automatic.** `/etc/needrestart/needrestart.conf` leaves `#$nrconf{restart} = 'i';` commented out (line 40), and `/etc/needrestart/conf.d/` holds only `README.needrestart`. The file says (lines 38 to 39): "UBUNTU: the default restart mode when running as part of the APT hook is 'a', unless a specific UI is configured". No UI is configured. The helper sets neither `NEEDRESTART_MODE` nor `NEEDRESTART_SUSPEND` (`apt-pinvoke` skips needrestart only when `NEEDRESTART_SUSPEND` is set).
  - **Restarted:** nothing, here, because vim is not loaded by any running service. The journal between 07:38 and 07:41 shows no service stop or start apart from `user@999` (the ServrSit account's per-login user manager, started and stopped with each SSH session) and the scheduled `sysstat-collect` and `fwupd-refresh`.
  - **The founder's F1 run**, an interactive `sudo apt-get` reported by Orchestrator, printed the same scan lines and no "Restarting services" lines. That is consistent: nothing needed a restart there either.
  - **Conclusion:** needrestart's automatic restart mode is active under the helper but was **not triggered** in this run. See D-S6.
- **debconf/dpkg without a terminal** (same journal): "debconf: unable to initialize frontend: Dialog … Readline … falling back to frontend: Teletype", and "dpkg-preconfigure: unable to re-open stdin". No question was asked for these packages. See D-S7.
- **Timing:** ~35 s between acceptance and dpkg start, which covered cache open and download; ~4 s of dpkg.

**Unattended-upgrades:** next run 2026-11-22 06:14 UTC. The vim set is already done. The LLVM set is in `noble-updates` only, which Ubuntu's default unattended-upgrades configuration does not install. The package steps should finish well before then.

### F2 — held package [FINAL] (no commit happened, so needrestart and debconf were not involved; not pre-fix sensitive)

**Founder:** `f2.sh` held `libclang1-18`. I saw the hold read-only at **07:51:40** (`apt-mark showhold` as spotty) and submitted right away, inside the 10-minute window. `apt-get -s upgrade` at that moment: 2 to upgrade, `libclang1-18` kept back.

| Time | Op | Digest | Scope | Ledger / outcome | Independent check |
|---|---|---|---|---|---|
| 07:51:45 | 86a9751a | b421be87d58c | LLVM set (3, `amd64`, from the 07:50 observation): `libllvm18`, `libclang-cpp18`, `libclang1-18` `1:18.1.3-1` → `1:18.1.3-1ubuntu1` | accepted, then finished, **exit 1, `failed`**: "the transaction would change other packages; nothing was changed", "0 of 3 packages at the planned version" | dpkg: all 3 still at `1:18.1.3-1` (`libclang1-18` in state `hi`, hold + installed); no dpkg.log entry after 07:39:32; one `servrsit-op-86a9751a…` unit, 07:51:47 to 07:51:50 |

**Result:**
- **Proven on Sentani:** a transaction that contains a held package is **refused whole**. The other two packages were not applied either, and nothing changed. That meets the steering rule that hold overrides are unsupported.
- **Defect D-S8:** the reason in the evidence is wrong. The ledger says "would change other packages", and neither the owner nor the controller can tell that the hold was the cause.
- **Observation (product side, T-089):** the refusal comes only **after** approval and acceptance. The controller's planner already sees holds in `apt-get -s upgrade` ("kept back"), so it should block a held package at plan time, before asking for approval.

### F3 — package-manager lock held by another process [FINAL] (no commit happened, so needrestart and debconf were not involved; not pre-fix sensitive)

**Founder:** `f3.sh` held the lock for 300 s. Confirmed read-only at **08:10:32** before submitting:
- `/proc/locks` held a POSIX lock on **both** `/var/lib/dpkg/lock-frontend` (inode 1704268) and `/var/lib/dpkg/lock` (inode 1704267), by pid **10850**;
- `ps` shows pid 10850 is `python3 -c import apt_pkg … pkgsystem_lock() …`, started by `sudo sh ~spotty/servrsit-t088/f3.sh`;
- `apt-mark showhold` was empty, so the F2 hold was gone and did not affect this test;
- `apt-get -s upgrade` showed 3 to upgrade (the LLVM set).

| Time | Op | Digest | Scope | Ledger / outcome | Independent check |
|---|---|---|---|---|---|
| 08:10:38 | 7da4237d | 844c2cfb4aa9 | LLVM set (3, `amd64`), same scope as F2 | accepted, then finished, exit `null`, **`failed`**: "the adapter stopped with an error (Error); check the server before trying again" | journal: unit started 08:10:40 and exited `status=1/FAILURE` at 08:10:42; at 08:10:47 pid 10850 still held both locks; dpkg: all 3 still at `1:18.1.3-1`, `ii`; no dpkg.log entry at 08:xx |

**Result:**
- **Proven on Sentani:** when another process holds the package-manager lock, the helper does not wait, does not take the lock, and changes nothing. The operation ends in a final `failed` record, so the server is not left blocked.
- **Defect D-S9:** the cause is not reported. `Error` is python-apt's generic `apt_pkg.Error`; the lock is the only difference from the successful 2b run, so it is the cause by inference. The helper correctly keeps the raw library text out of the ledger, but the owner gets no typed reason. Tech Spec §11 defines `PACKAGE_LOCKED` for this.

### 3c — client kills during a running package transaction [PARTIAL] (needrestart lines are **[PRE-FIX]**)

**Precondition (read-only, 08:15:34):** `/proc/locks` showed no lock on either dpkg lock file, `apt-mark showhold` was empty, and `apt-get -s upgrade` showed the 3 LLVM packages pending.

**Script:** `tests/live/t088/t3c.sh`. One submit. When a `dpkg` process appeared on Sentani, it would run (a) a query with the client killed before the reply, (b) a query with stdin held open, then killed, and (c) an identical resubmit killed at 400 ms. Then the correct retry: (d) query the same id first, (e) resubmit the identical manifest.

| Time (UTC) | Action | Op | Digest | Reply |
|---|---|---|---|---|
| 08:15:40 | submit LLVM set (3, `amd64`) | 7f8cccc8 | e446a9d5b061 | accepted |
| 08:15:42 to 08:18:20 | waited for a `dpkg` process (90 probes) | | | **none seen**; the script printed "the kills below are NOT mid-dpkg" |
| 08:18:20 | (a) query, client SIGKILL at 305 ms | 7f8cccc8 | | no reply (killed) |
| 08:18:21 | (b) query, stdin held, client SIGKILL at 1,504 ms | 7f8cccc8 | | no reply (killed) |
| 08:18:23 | (c) identical resubmit, client SIGKILL at 404 ms | 7f8cccc8 | e446a9d5b061 | no reply (killed) |
| 08:18:24 | (d) retry rule: query the same id first | 7f8cccc8 | e446a9d5b061 | found, `running`, outcome null |
| 08:18:25 | (e) identical resubmit | 7f8cccc8 | e446a9d5b061 | **`existing`**, `running` |
| 08:18:56 | final query | 7f8cccc8 | e446a9d5b061 | finished, exit 0, **`succeeded`**: "apt commit returned success", "3 of 3 packages at the planned version" |

**Where the kills landed (unit journal and dpkg.log):**
- The unit started at 08:15:42.
- `dpkg-preconfigure` ran at 08:18:42 and `startup archives unpack` at **08:18:43**.
- The last configure (`libc-bin` trigger) finished at **08:18:48**, and the unit deactivated at 08:18:54 (15.0 s CPU).
- So the kills (08:18:20 to 08:18:23) and the retries (08:18:24 to 08:18:25) all fell in the ~3-minute **download/preparation phase**, about 20 s before dpkg began. dpkg itself lasted ~5 s.
- The detection loop missed the start because each probe takes ~1.8 s over SSH and the loop stopped at 08:18:20.

**Independent verification (as spotty):**
- **dpkg:** `libllvm18`, `libclang-cpp18` and `libclang1-18` at `1:18.1.3-1ubuntu1`, all `ii`. `dpkg --audit` is clean (exit 0, no output).
- **dpkg.log:** **one** unpack/configure sequence, 08:18:43 to 08:18:48. Each package is upgraded once, and the only other entry is the `libc-bin` trigger.
- **apt history:** **one** transaction, 08:18:43 to 08:18:48, `Upgrade:` the 3 packages.
- **Journal:** `servrsit-op-7f8cccc8…` started **once**.
- **`apt-get -s upgrade` afterwards:** 0 to upgrade (only the 11 phased packages remain).
- **[PRE-FIX] needrestart** ran inside the unit at 08:18:49: "No services need to be restarted". No running service loads LLVM, so this says nothing about D-S6.
- **[PRE-FIX] services:** none of the 22 services running before changed PID or start time. One service was **added**: `packagekit.service` (PID 18115, started inside the transaction window). That is D-Bus activation, apt's `20packagekit` hook notifying PackageKit, not a restart. The owner's approval does not mention it.

**Result:**
- **Proven on Sentani:** killing the local ssh client, three ways, while an accepted package transaction is running (download phase) does not stop or duplicate it. The correct retry (query first, then the identical manifest) returns `running` and then `existing`, and exactly one transaction happens.
- **NOT proven:** a client kill **inside dpkg's ~5-second unpack/configure window**. The transient unit does not depend on the SSH session, as the kills at 08:18:20 to 08:18:23 already show, so I don't expect a different result. But the instruction asked for mid-dpkg, and it was not achieved.
- **Proposed redo:** a founder step F4 downgrades the LLVM set again, the same as F1 for those 3 packages. Then a revised script fires a killed query and a killed identical resubmit **every second** from acceptance until the ledger says finished, so several kills must land inside the dpkg window. dpkg.log timestamps then confirm which ones did.

### 3c redo — client kills inside dpkg's unpack window [FINAL] (needrestart lines are **[PRE-FIX]**)

**Founder F4** (`f4.sh`): exit 0. The 3 LLVM packages were downgraded to `1:18.1.3-1`. The founder's output also said "libfwupd2 libgusb2 no longer required". That is an apt autoremove hint only: those packages were not touched, and they are not in any manifest.

**Precondition (read-only, 08:28:2x):** no lock in `/proc/locks`, no hold, and `apt-get -s upgrade` showed exactly the 3 LLVM packages `1:18.1.3-1` → `1:18.1.3-1ubuntu1`, all from Ubuntu origins. The script refuses to continue otherwise.

**Run (`tests/live/t088/t3c2.sh`):**
- **Submit:** 08:28:34, op **199982cc**, digest **3180d35c5292**, accepted.
- **Kills:** from acceptance until the ledger said finished, a background loop fired every second a query with the local ssh client SIGKILLed at 400 to 700 ms, and every 4th tick also an identical resubmit, killed the same way. 12 kills in total (9 queries, 3 resubmits), 08:28:37.2 to 08:28:49.2.
- **Retry after finish:** a query of the same id first gave finished, exit 0, **succeeded** ("3 of 3 packages at the planned version"). Then the identical resubmit gave **`existing`**.

**dpkg window** (unit journal, `short-precise`, and dpkg.log): `dpkg-preconfigure` 08:28:38.713, `startup archives unpack` 08:28:38/39, `libllvm18` unpack 08:28:40.167 to 08:28:41.851, last configure and `libc-bin` trigger 08:28:42.65 and finished before 08:28:43.

**Kills inside the window.** Kill times are computed from the local run log. Sentani's clock and the controller's agree to about 1 s, and each margin below is larger than that.

| Client started | SIGKILL at | Kind | Killed after | Reply | Where dpkg was |
|---|---|---|---|---|---|
| 08:28:39.710 | **08:28:40.202** | identical resubmit | 492 ms | none | unpacking `libllvm18` (08:28:40.167 to 41.851) |
| 08:28:39.721 | **08:28:40.212** | query | 491 ms | none | unpacking `libllvm18` |
| 08:28:40.721 | **08:28:41.309** | query | 588 ms | none | unpacking `libllvm18` |

Unkilled queries in the same window returned `running`.

**Independent verification (as spotty):**
- **Journal:** `servrsit-op-199982cc…` **started once** (08:28:36.06), deactivated successfully 08:28:48.78, 11.7 s CPU.
- **dpkg.log:** **one** unpack/configure sequence, each of the 3 packages upgraded once, plus the `libc-bin` trigger.
- **apt history:** **one** transaction, 08:28:38 to 08:28:42, `Upgrade:` the 3 packages.
- **dpkg:** all 3 at `1:18.1.3-1ubuntu1`, `ii`. `dpkg --audit` is clean (exit 0). `apt-get -s upgrade`: 0 to upgrade.
- **[PRE-FIX] services:** all running services unchanged (PID and start time). needrestart said "No services need to be restarted" at 08:28:44. As before, no service loads LLVM, so this is not evidence about D-S6.

**Result:** **proven on Sentani** for FR-17. Killing the local ssh client while dpkg is unpacking, three times and including an identical resubmit, neither stops nor duplicates the transaction. The transient unit finishes on its own, and the query-first retry finds the single operation and returns `existing` for the identical manifest.

### 4 — reboot with return verification [FINAL]

**Precondition (read-only, 08:30:47):** no dpkg lock, no hold, no unfinished operation (every earlier op finished). Boot id **`c456de4b-ff23-44e7-9ed0-78a1da95a498`**, up since 05:22:32. 23 services running. **Script:** `tests/live/t088/t4.sh`.

| Time (UTC) | Event | Evidence |
|---|---|---|
| 08:30:49 | submit `reboot.host.v1`, previousBootId `c456de4b…`, op **82fbde1e**, digest **6d64794d43de** | accepted |
| 08:30:50.86 | `servrsit-op-82fbde1e…` started; deactivated 08:30:51.09 (runner ran `systemctl reboot`) | journal of the previous boot (`-b -1`) |
| 08:30:53 | last journal entry of boot `c456de4b…` | `journalctl --list-boots` |
| 08:31:01 | SSH as spotty first fails | harness |
| 08:31:30 / 08:31:34 | new boot: `uptime -s` 08:31:30, first journal entry 08:31:34, boot id **`2374c423-ef52-4028-b846-cff771e6fe64`** | `base` probe, `--list-boots` |
| 08:31:44 | SSH as spotty back, new boot id (about 55 s after submit; window 10 min) | harness |
| 08:31:46 | helper query as `servrsit` (gateway): finished, exit 0, **`succeeded`**: "reboot requested (exit status 0); waiting for a new boot id", "the server came back with a new boot id" | reply |
| 08:31:4x | **identical reboot manifest submitted again** | **`existing`**, finished; **no second reboot** |
| 08:32:09 | 20 s later: still boot `2374c423…` (boot list shows exactly one new boot) | `--list-boots` |

**After the return (as spotty):**
- `systemctl --failed` is empty. `tailscaled` and `ssh` are active, and the helper answered queries as `servrsit` (gateway, sudoers and ledger all working after the reboot).
- 20 services running. The 3 that were running before and not after are `fwupd`, `packagekit` and `upower`. All three are on-demand D-Bus services, none enabled at boot (`packagekit` had been activated by apt's hook in 3c).
- Disk unchanged (230.7 GB available).

**Result:**
- **Proven on Sentani:** the reboot runs once. The old and new boot ids are recorded, SSH comes back for both the inspect key and the maintenance key, and the helper settles the operation `succeeded` only when it sees a new boot id.
- **Also proven:** a retry of the identical manifest after the reboot returns `existing` and **does not reboot again** (invariant 7). The ledger's `existing` check runs before the precondition check, which would otherwise fail on the changed boot id.

**Not proven:** "a reboot that returns late" from T-088 (delayed return or outcome unknown at window expiry). Sentani came back in about 55 s. That case needs a host that stays down, which a founder step could simulate (for example by holding the network down at boot). It is not in this round's instructions.

### 5 — disk pressure as `spotty` [FINAL]

**Filesystem (read-only, before):** `/`, `/home` and `/var/lib/servrsit` are all on `/dev/mapper/ubuntu--vg-ubuntu--lv`, ext4, block size 4096: 60,869,734 blocks in total, **59,069,500 free**, **56,318,498 available to non-root**. The difference, **2,751,002 blocks (about 11.3 GB, 4.5%)**, is ext4's root reserve, now measured rather than assumed.

| Time (UTC) | Action (as spotty unless noted) | Result |
|---|---|---|
| 08:33:42 | `fallocate` `~spotty/servrsit-t088-fill/fill.bin`, everything available minus 64 MiB (230,613,450,752 bytes) | available to non-root: **67,055,616 bytes (16,371 blocks)**; free including the reserve: 2,767,373 blocks |
| 08:33:45 | write 128 MiB as spotty | **fails, exit 1**, after 67,059,712 bytes, so non-root users are really out of space (the partial file was removed) |
| 08:33:46 | helper query of the reboot op (gateway as `servrsit`, `sudo -n`, ledger read) | found, finished, succeeded |
| 08:33:47 | helper `prepare.directories.v1` `~spotty/servrsit-t088-disk` (op **c816d225**, digest **696fcf964e58**) | accepted, then finished, exit 0, **`succeeded`**, "1 of 1 verified with the planned owner and mode"; the directory exists as spotty:spotty 755. Root's directory and ledger writes came from the reserve |
| 08:33:54 | remove the fill file and directory | available back to 230,680,539,136 bytes (before: 230,680,567,808; the 28,672-byte difference is the new directory and logs). The test directory was then removed with `rmdir` |

**Result:**
- **Proven on Sentani:** filling the disk as a non-root user does not stop the helper. The gateway, sudo, ledger reads and writes, and a root directory creation all still work. The SSH logins for inspection (spotty) and maintenance (servrsit) still work too.
- **NOT proven:** root-side out-of-space (ENOSPC) in the ledger or during dpkg. `spotty` cannot use the 11.3 GB reserve. Reaching that state needs root, for example a founder `fallocate` as root into the reserve. Reading the code, the helper has **no free-space check** before `apt` commits. An apply on a server with less free space than the unpacked packages need would fail inside dpkg, possibly leaving half-installed packages. I recommend a pre-commit check of free space against the transaction's download and installed size (python-apt's `cache.required_download` and `required_space`), refusing with a typed reason. This is untested, so it is listed as observation O-S2, not a defect.

### 3c redo — preparation

- **Approved** by Orchestrator: the mid-dpkg kill matters for FR-17.
- **Founder script** `~spotty/servrsit-t088/f4.sh`, reviewed read-only: spotty:spotty mode 664 (D-S3 still applies), sha256 `55be73df01ec59449073af21c9e9b27bcb9ea455716a6266e63db560c8f26674`. Its simulation guard requires exactly 3 `Inst` lines and ` 0 to remove`. The real install has **no pipe**, and the script prints `apt exit $RC`, so D-S2 does not apply to this script.
- **Waiting** for "T-088 F4 done, apt exit 0".
- **Script:** `tests/live/t088/t3c2.sh`.


- ~~**Step 2 is blocked**~~ (resolved by option B / F1, see step 2 above): there was no pending update that `apt-get upgrade` (the product's own observation) would install. Applying the 11 phased systemd packages would override Ubuntu's staged rollout, re-execute systemd, and restart resolved, timesyncd and udev. That is a founder decision. The options are in `docs/team/t088-founder-steps.md`; option B (downgrade 8 harmless packages, then install them back through the helper) is recommended.
- **3c, the hold test and the lock test** depend on step 2's packages. Their founder steps are F1 to F3 in `docs/team/t088-founder-steps.md`.
- **Steps 4 (reboot) and 5 (disk)** are held back to keep the order of increasing risk: they come after step 2.
- **Planning note for step 5:** `spotty` cannot fill root's reserved blocks. ext4 reserves ~5% by default, which I can't read without root, so it is assumed. A `spotty` fill can therefore prove behaviour when users are out of space, but probably **not** a root-side ENOSPC in the ledger or dpkg.

## 3. Proven on real Ubuntu vs not (so far)

| Claim | Status |
|---|---|
| Gateway forced command, bounded stdin, typed rejection codes, no traceback on hostile input (incl. D-H1, D-H5) | **Proven on Sentani** |
| Signature, unknown key, installation binding, expiry, operation allowlist | **Proven on Sentani** |
| Replay → `existing`; same id, other digest → `DIGEST_MISMATCH`; ledger unchanged | **Proven on Sentani** |
| `systemd-run` transient unit runs the accepted operation once and outlives the SSH session (`servrsit-op-*` in the journal) | **Proven on Sentani** for `prepare.directories.v1` |
| Real root ownership/chown: a directory created as root with the planned owner spotty:spotty and mode 755 | **Proven on Sentani** |
| Query-before-retry stops duplicates after a client kill before acceptance, with no EOF, and after acceptance with the reply lost | **Proven on Sentani** |
| Real `sudo -n` with the one sudoers rule | **Proven indirectly:** every reply above came from the root helper through it |
| APT transaction through the helper: exact set, exact versions, nothing else changed, verified independently by dpkg | **Proven on Sentani** (2b) |
| A transaction that would not be exact is refused whole, with nothing changed | **Proven on Sentani** (2a) |
| Transactions with `Architecture: all` packages labelled as apt prints them | **FAILS on Sentani** (D-S5) |
| needrestart runs inside the helper's transient unit, in automatic mode | **Proven on Sentani** (journal + config) |
| A package update does not restart services | **Proven only when no service loads the upgraded files** (vim). Where a running service uses an upgraded library, it would be restarted automatically (D-S6) |
| A debconf question or conffile prompt with no terminal | **NOT proven** (none occurred; D-S7) |
| Held package: whole transaction refused, nothing changed | **Proven on Sentani** (F2); the evidence text is wrong (D-S8) |
| External package-manager lock: refused, nothing changed, record final | **Proven on Sentani** (F3); no typed reason (D-S9) |
| Client kill during a running package transaction (download phase): no stop, no duplicate, query-first retry → `existing` | **Proven on Sentani** (3c) |
| Client kill inside dpkg's unpack window (3 kills, incl. an identical resubmit): no stop, no duplicate, query-first retry → `existing` | **Proven on Sentani** (3c redo) |
| Reboot and return verification: new boot id, SSH back (both keys), query settles `succeeded`, identical retry → `existing` with no second reboot | **Proven on Sentani** (step 4) |
| Delayed return or outcome unknown at window expiry | **NOT proven** (Sentani returned in ~55 s) |
| Non-root disk full (ext4 reserve intact): the helper keeps working (query, ledger, root directory creation) | **Proven on Sentani** (step 5) |
| Root-side ENOSPC in the ledger or dpkg | **NOT proven** (needs root to fill the 11.3 GB reserve); no free-space check before commit (O-S2) |
| Uninstall on the real server | **NOT tested** (not in this round's instructions) |
| The controller's `previewDigest` (packages/domain plans) equals the helper's precondition rule for packages | **NOT proven.** My manifests use the helper's rule directly; this matters for T-089 |

## 4. Defects and review findings

| ID | Severity | File:Line | Description | Repro / evidence | Owner |
|---|---|---|---|---|---|
| D-S1 | Medium | `tests/live/helper-cli/cli.mts:42` (also the usage text at :19) | When `SERVRSIT_KNOWN_HOSTS` is unset, the CLI uses `apps/api/.data/known_hosts`. That file (dated 2026-11-17) pins Sentani's **pre-reinstall** key `SHA256:nhrV6lE7…FS4I`, which ADR-021 makes void, and it **also pins Timika and Nabire**. **(a)** With the default, every send to the reinstalled Sentani fails host-key checking. That is safe, but it pushes the user toward "fixing" a pin by hand. **(b)** `SENTANI_HOST` can be set to any name in that file, and the CLI would then contact a protected server with the maintenance key. Authentication would fail there, because the key is not installed, but contacting the server at all breaks the "Sentani only" rule (ADR-021). | Compare `ssh-keygen -lf apps/api/.data/known_hosts`, which shows 3 hosts and Sentani `nhrV6…`, with the registry row `75e41a8a…`'s `known_hosts_file`, which shows Sentani only, `j3nno/…JrM`, owner-confirmed 05:44:58Z. Not reproduced live: I never ran the CLI with its default. | Coder |
| D-S2 | Low | `~spotty/servrsit-t088/f1.sh` on Sentani (Orchestrator's script), the line `apt-get install -y --allow-downgrades $PKGS \| tail -n 2` | The pipeline's exit status is `tail`'s, so `set -e` does not stop on a failed `apt-get`, and the script still prints **"T-088 F1 done"**. Low, because step 2 starts from a fresh `apt-get -s upgrade` and dpkg observation, so a failed downgrade is caught there. But the founder's message would be wrong. Fix: run `apt-get` without the pipe, or check `dpkg-query` for the 8 versions before printing "done". | Read-only review of the file on Sentani (sha256 below) | Orchestrator |
| D-S3 | Low (Sentani) / would be High on a real server | `~spotty/servrsit-t088/f{1,2,3}.sh` on Sentani: spotty:spotty mode 664, run by the founder with `sudo sh` | The files are writable by `spotty`, and so by ServrSit's **inspect key**, which is a full `spotty` shell (its key line is `restrict,from=…` with no forced command). Whoever holds that key can change a script between now and the founder's `sudo sh`, which turns inspect access into root. That is acceptable on disposable Sentani, but this pattern must not be used on Nabire, Timika or Merauke. Before running, the founder can check `sha256sum ~/servrsit-t088/f*.sh` against the values below. | Checksums recorded 2026-11-21 (read-only, as spotty) | Orchestrator |
| D-S4 | Info | `~spotty/servrsit-t088/f2.sh` | Ctrl-C during `sleep 600` exits the script before `apt-mark unhold`, and the script doesn't say how to recover. My founder-steps doc does (`sudo apt-mark unhold libclang1-18`). Suggest a `trap 'apt-mark unhold libclang1-18' EXIT`, or printing the recovery command. | Read-only review | Orchestrator |

**Founder scripts reviewed (read-only, as spotty).** The commands match `docs/team/t088-founder-steps.md` F1 to F3. F1's two automatic stops are correct:
- `grep -q " 0 to remove"` does not match "10 to remove";
- the check for exactly 8 `Inst` lines also stops if a new package would be installed.

SHA-256 at review time:

```
a9813b617a679332d9d7daff5746c5132fb3a68a307a63a87bdcc05086d2f83c  f1.sh
eeafb796051fcf8e80cb3f668f318bb947ad2564e8648e6fa8e2b836c85599ea  f2.sh
5f2f54d2fe089e396e8684fb6e14e304d1eb0f420806b24d571999a36ea972c5  f3.sh
```

| D-S5 | **High** (functional; safe failure) | `target-helper/servrsit_helper/adapters.py` `RealSystem.apply_packages()`: `wanted = {"%s:%s" % (c["name"], c["arch"]) …}` against `changed = {p.fullname for p in cache.get_changes()}` | For a package with `Architecture: all`, apt prints `[all]` (`apt-get -s upgrade`, `dpkg-query ${Architecture}`, dpkg.log `vim-common:all`), and python-apt resolves `cache["name:all"]`. But `Package.fullname` is `name:amd64`. So any manifest that labels an `all` package as `all` builds a `wanted` set that can never equal `changed`, and **every such transaction is refused** with "would change other packages". The refusal itself is correct and safe: nothing changes. But most Ubuntu updates include `all` packages (here 2 of 5), so `apply.packages.v1` cannot apply typical updates. The fake-root suites (mine and Coder's) could not see this, because their fake System has no python-apt. Fix options: compare on `p.name` + `p.candidate.architecture` after normalising `all` to the native architecture, or key by the resolved package (`cache[key].fullname`) on both sides. The controller's planner and the verification keys (`expectInstalled`) must use the same convention, because `installed()` already accepts both. Add a regression test that uses a fake whose `fullname` differs from the lookup key. | Live: 2a (op 254d3315, failed, nothing changed) vs 2b (op 24793587, the same 5 packages with `amd64` labels, succeeded). Read-only python-apt probe output is in this report | Coder |

| D-S6 | **High** (invariant 5) | `target-helper/servrsit_helper/adapters.py` `RealSystem.apply_packages()` (`cache.commit()` runs dpkg and apt's hooks in the runner's environment; nothing sets `NEEDRESTART_MODE`/`NEEDRESTART_SUSPEND`) | Ubuntu's needrestart apt hook runs after every helper transaction, in its Ubuntu default mode `'a'` (automatic). When an approved package update replaces a library used by a running service (for example libssl, used by sshd and nginx), needrestart restarts that service **inside a package-only approval**. That breaks invariant 5 (package, service-restart and reboot approvals are separate) and Tech Spec §8.1 (`restart.service.v1` needs its own approval). The run still reports the operation as package-only. Not triggered in 2b (vim). Fix options: run the commit with `NEEDRESTART_MODE=l` (list only), and record needrestart's "services that need restarting" list as evidence so the controller can propose separate `restart.service.v1` plans; or `NEEDRESTART_SUSPEND=1` plus the helper's own check. | Read-only config and journal evidence above. To prove it live: a package step that upgrades a library a running service uses. I propose a later step (founder downgrade of one such library), with your approval, because it would restart a service on Sentani | Coder |
| D-S7 | Medium | Same place: `cache.commit()` with stdin closed, no `DEBIAN_FRONTEND`, no dpkg `--force-confdef`/`--force-confold` | Under the transient unit, debconf falls back to its Teletype frontend with no stdin, and dpkg has no conffile policy. An update that asks a debconf question, or that changes a conffile the owner modified, would read end-of-file at the prompt. The usual result is a failed or half-configured package (`iF`/`iU`) in the middle of an approved transaction, instead of a clean refusal or the documented default. Fix: set `DEBIAN_FRONTEND=noninteractive` and `Dpkg::Options::=--force-confdef,--force-confold` (keep the owner's file; record the `.dpkg-dist`), and verify `dpkg --audit` is clean after the commit. Not triggered in 2b. | Journal of `servrsit-op-24793587…` (07:39:28, 07:39:33) | Coder |

| D-S8 | Low | `adapters.py` `RealSystem.apply_packages()`: `mark_install(auto_fix=False, from_user=False)` silently does not mark a held package, and the generic "would change other packages" message is returned | A held package in the scope causes a correct refusal with a wrong explanation. Fix: check `pkg.selected_state == apt_pkg.SELSTATE_HOLD` (or `dpkg --get-selections`) for each package first and refuse with a typed reason (for example "libclang1-18 is held on this server; ServrSit does not override holds"). Also compare the marked set and name the actual difference when it is not a hold. | F2 run above (op 86a9751a) | Coder |

| D-S9 | Low | `target-helper/servrsit_helper/runner.py:34-36` (`except Exception` → "the adapter stopped with an error (%s)") together with `adapters.py` `apply_packages()` (`cache.commit()` with no lock handling) | A lock held by another process gives a generic `failed` with `exitCode: null` and "check the server before trying again". There is no typed reason, and nothing tells the owner or controller to wait and retry. Fix: catch the lock failure in the adapter (or check `apt_pkg.get_lock()` on both lock files before `commit()`), end with a typed `PACKAGE_LOCKED` reason (Tech Spec §11), and state that nothing changed. | F3 run above (op 7da4237d) | Coder |

No other helper defect was found in steps 1, 2, F2, F3 and 3a/3b.

## 5. Summary for the Orchestrator (end of this round)

**Done on Sentani (helper `4101502`), all Sentani-only:**
- Step 1: rejections, replay and digest mismatch.
- Steps 3a/3b: client kills before and after acceptance.
- Step 2: an exact package transaction, verified by dpkg.
- F2: a held package.
- F3: an external lock.
- 3c: client kills during the transaction and inside dpkg's window.
- Step 4: reboot and return.
- Step 5: non-root disk pressure.

No step produced a duplicate operation, a second transaction or a second reboot. No step left a package half-installed (`dpkg --audit` clean). Nothing was sent to Nabire, Timika or Merauke.

**Open defects:**

| ID | Severity | Owner | Status |
|---|---|---|---|
| D-S1 | Medium | Coder | open (CLI default pin) |
| D-S2 | Low | Orchestrator | fixed in the pattern for `f4.sh`; `f1.sh` unchanged (already run) |
| D-S3 | Low / High on a real server | Orchestrator | open (founder scripts writable by the inspect account) |
| D-S4 | Info | Orchestrator | open |
| D-S5 | High | Coder | in T-090 |
| D-S6 | High | Coder | in T-090; needs a live case afterwards |
| D-S7 | Medium | Coder | in T-090; needs a conffile case afterwards |
| D-S8 | Low | Coder | open |
| D-S9 | Low | Coder | queued |

**Observations:**
- **O-S1:** the planner should block held packages before approval (T-089).
- **O-S2:** no free-space check before commit.
- **O-S3:** `packagekit.service` is started by apt's hook during a helper transaction, which the approval does not mention. [PRE-FIX]

**Still to do (not in this round's instructions, or waiting on fixes):**
- After T-090 is installed: re-run step 2 with `Architecture: all` labels, and run the needrestart case (a library used by a running service) and a conffile/debconf case.
- A reboot that returns late (outcome unknown at window expiry).
- Root-side ENOSPC (needs a founder step).
- Uninstall on the real server.
- Whether the controller's `previewDigest` matches the helper's precondition rule (T-089).

**Gate decision for T-089:** the transport, signature, ledger, retry, lock, hold, reboot and disconnect mechanics **pass** on real Ubuntu. Writes through the app should **not** be enabled until D-S5 and D-S6 are fixed and re-verified on Sentani. D-S5 makes most real updates fail. D-S6 can restart services without their own approval (invariant 5).

---

## 6. Helper 0.2.0 (T-090) re-run

**Installed version:** `VERSION` reads 0.2.0. All 13 files under `/usr/lib/servrsit` match source **`0b59cae`** (integration/live-v1) by sha256; I read them as spotty, since they are world-readable. Rebuilding `0b59cae` gives package sha256 `25f12d377964…862287`, the same as `target-helper/dist/sentani/servrsit-helper-0.2.0`. `adapters.py` is root:root 644 and the sudoers file root:root 440. The ledger directory cannot be read as spotty, which is correct.

**Fake-root gate (no server):** my suite (`tests/helper`, binding extended for the five new `System` methods, H55 allows the two new reply fields `restartNeeded` and `reasonCode`) passes **126/126** on 0.2.0. H12 and H18 passed 5/5 on repeat. The same binding still gives 126/126 on 0.1.0. Coder's own suite at `0b59cae` passes.

**What 0.2.0 does, from reading the code (`adapters.py`, `helper.py`, `runner.py` at `0b59cae`):**
- **D-S5:** each change is resolved with apt's own lookup, and the plan and the transaction are compared by resolved `fullname`.
- **D-S6:** the commit runs with `NEEDRESTART_SUSPEND=1` and `NEEDRESTART_MODE=l`. Afterwards `needrestart -b -r l` (list only) is recorded as `restartNeeded` and in the evidence.
- **D-S7:** `DEBIAN_FRONTEND=noninteractive`, `--force-confdef`/`--force-confold`, `Dpkg::Use-Pty=0`, and `dpkg --audit` after the commit. **Also:** if `dpkg --verify` shows that the owner changed a configuration file of any package in the scope, the submit is **refused** with `CONFFILE_MODIFIED` before acceptance, and checked again in the runner. So the owner's file is kept by **not updating** the package; confold is a second line of defence.
- **D-S8:** a held package is refused at submit with `PACKAGE_HELD`, naming the package.
- **D-S9:** the runner checks the package-manager locks before commit, and a lock failure during the commit is also reported as `PACKAGE_LOCKED`.

**Candidates chosen read-only (as spotty):**

| Case | Packages | Why | Read-only pre-checks |
|---|---|---|---|
| (a) `Architecture: all` | vim set: `vim`, `vim-common` (**all**), `vim-runtime` (**all**), `vim-tiny`, `xxd`, from `2:9.1.0016-1ubuntu7` to `…ubuntu7.20` | 2 of 5 are `all`; this set failed under 0.1.0 (2a) | `dpkg --verify` clean |
| (b) needrestart | `libaio1t64` `0.3.113-6build1` to `…6build1.1` | the only running service that loads it is `multipathd.service` (`ldd` of each running service's executable); one small library, no configuration files, and no multipath devices on this machine | `multipathd` active, MainPID 402 |
| (c) changed configuration file | `wget` `1.21.4-1ubuntu4` to `…ubuntu4.5`, conffile `/etc/wgetrc` | leaf package with one configuration file that owners really edit | `dpkg --verify` clean, `/etc/wgetrc` md5 `c43064699caf…` |
| (d) hold / lock | vim set, hold on `vim-common` (an `all` package, which also exercises the name lookup) | pending until (a) | — |

**Founder steps:** relayed by the Orchestrator, with no scripts in the founder's home (D-S3). The commands are in my reply of this round. The downgrade runs with `NEEDRESTART_MODE=a`, so `multipathd` restarts once onto the old `libaio`, and any later "needs a restart" comes from our update.

**Founder attempt 1 (relayed by the Orchestrator, split into short lines with shell variables):** the founder reported "steps 1-3 done, apt exit 0". The Orchestrator verified read-only that **nothing was downgraded**: the vim set is still at `…ubuntu7.20`, `libaio1t64` at `0.3.113-6build1.1`, `wget` at `1.21.4-1ubuntu4.5`, and `multipathd` still has PID 402 since 08:31:34. The `/etc/wgetrc` edit **is** present. Likely cause: the variables were empty, and `apt-get install` with no package arguments exits 0 having done nothing. So "apt exit 0" is not evidence of a downgrade (the same class of false success as D-S2). The simulation in step 1 would have said `0 downgraded`.

- **Effect on the plan:** none. The edit to `/etc/wgetrc` is kept through the redo, because the downgrade uses `--force-confold` and `dpkg --verify` compares against the installed version. `t090.sh` cannot run on a wrong state: each `scope()` asserts that exactly the expected packages are pending, from a fresh `apt-get -s upgrade`, and stops otherwise.
- **Recommendation:** end the founder's real downgrade with a version read-back instead of relying on the exit code:
  `dpkg-query -W -f='${Package} ${Version}\n' vim vim-common vim-runtime vim-tiny xxd libaio1t64 wget`
- **Status:** resolved by founder attempt 2 (see 6.1).

### 6.1 Results on 0.2.0 (2026-11-21, 09:21 to 09:31 UTC)

**Founder attempt 2 (verified by the Orchestrator):**
- all 7 packages at the old versions, `dpkg --audit` clean, no holds;
- the `/etc/wgetrc` owner edit present (`dpkg --verify` shows `??5?????? c /etc/wgetrc`, md5 `e5cca7a09bcf…`);
- needrestart restarted `multipathd` during the founder's own downgrade, as intended: the old PID 402 shut down and the new **MainPID 4794** started at 09:16:35 (its journal);
- apt history: one downgrade transaction, 09:16:28 to 09:16:34, `Requested-By: spotty`.

**Step 4 by the founder:** hold on `vim-common`, then the python lock for 240 s ("lock started 09:26"). I detected both phases read-only: the hold at 09:21:25 (`apt-mark showhold`), and the lock at 09:25:53 (`/proc/locks`, pid 7111 on both dpkg lock files, no hold).

| Case | Time | Op | Digest | Scope | Reply / ledger | Independent check (as spotty) |
|---|---|---|---|---|---|---|
| (d1) held (D-S8) | 09:21:46 | f9a50722 | e27dc1d7cb68 | vim set, planned versions, `vim-common`/`vim-runtime` labelled `all` | **rejected `PACKAGE_HELD`**: "vim-common:all is held on this server; ServrSit does not override holds, nothing was changed". Not accepted; no unit | hold still present at 09:21:51; no op unit since 09:20 apart from those below |
| (d2) lock (D-S9) | 09:25:54 | ba79290d | 6bf57fbc9338 | vim set | accepted, then finished, exit null, **`failed`, `reasonCode: PACKAGE_LOCKED`**: "another program is using the package manager (an apt or dpkg lock is held); nothing was changed, try again when it has finished", `restartNeeded: []` | unit 09:25:57 to 09:25:59; no apt history entry; versions unchanged |
| (a) `Architecture: all` (D-S5) | 09:30:09 | c14a1397 | 24f7183a500c | from a fresh `apt-get -s upgrade`: `vim:amd64`, **`vim-common:all`**, `vim-tiny:amd64`, **`vim-runtime:all`**, `xxd:amd64`, `…ubuntu7` → `…ubuntu7.20` | finished, exit 0, **`succeeded`**: "apt commit returned success (needrestart suspended, no prompts, your changed configuration files kept)", "5 of 5 packages at the planned version", "no service needs a restart" | dpkg: all 5 at `…ubuntu7.20`, `ii`; apt history: **one** transaction 09:30:15 to 09:30:20 with the 5 upgrades; unit journal: "packages have been installed but needrestart is suspended" |
| (b) needrestart (D-S6) | 09:30:37 | 260b2813 | 1621f342bc4a | `libaio1t64:amd64` `0.3.113-6build1` → `…6build1.1` | finished, exit 0, **`succeeded`**, **`restartNeeded: ["multipathd.service"]`**, evidence "services that need a restart (not restarted; needs a separate restart approval): multipathd.service" | **multipathd MainPID 4794 and ActiveEnterTimestampMonotonic 2704821641 (09:16:35) unchanged** before and after; the multipathd journal shows no stop or start after 09:16:35; unit journal: "needrestart is suspended"; apt history: one transaction 09:30:46 |
| (c) changed configuration file (D-S7) **[OLD BEHAVIOUR, superseded by ADR-024]** | 09:31 | 34d6ff01 | 0bdad63a595a | `wget:amd64` `1.21.4-1ubuntu4` → `…ubuntu4.5` | **rejected `CONFFILE_MODIFIED`**: "configuration files you changed: /etc/wgetrc". Not accepted | `/etc/wgetrc` md5 still `e5cca7a09bcf…` (owner edit kept); `wget` still `1.21.4-1ubuntu4`; no `/etc/wgetrc.dpkg-dist`; no apt or dpkg process left (nothing hanging); `apt-get -s upgrade` still offers `wget` |

**After all runs:**
- `dpkg --audit` is clean (exit 0), and exactly 3 `servrsit-op-*` units started since 09:20 (d2, a, b).
- All running services kept their PID and start time from before (a) to after (c). The one exception is **`packagekit.service`, started** (D-Bus activation by apt's hook) during (a)/(b). This is O-S3 and is still present in 0.2.0.
- The `/etc/wgetrc` edit is **kept in place** for the 0.3.0 re-run of (c), as instructed. Founder step 5 (remove the edit) is **not** needed.

**Script note:** my first run stopped at (d1) by design. While `vim-common` was held, `apt-get -s upgrade` kept back `vim-common` and the packages that depend on it, so only `xxd` showed as pending, and the scope check refused. (d1) was then submitted with the planned versions verified before the hold, which is what a controller would send for an already-approved plan. `t090.sh` now takes the scope before the hold.

### 6.2 Status of the 0.1.0 defects on 0.2.0

| ID | Status | Evidence |
|---|---|---|
| D-S5 | **Closed, verified on Sentani** | (a): `all` packages labelled as apt prints them, 5 of 5 |
| D-S6 | **Closed, verified on Sentani** | (b): library update, service not restarted (PID and start time unchanged), reported in `restartNeeded` |
| D-S7 | **Partly closed.** The noninteractive environment, confold option and `dpkg --audit` check are in place (no prompt, nothing hung). The conffile **policy** follows ADR-024: 0.2.0's refusal is the old behaviour, and 0.3.0 (T-092) must update and keep the owner's file. **Re-run (c) on 0.3.0** | (c) |
| D-S8 | **Closed, verified on Sentani** | (d1): `PACKAGE_HELD`, names the package, before acceptance |
| D-S9 | **Closed, verified on Sentani** | (d2): `PACKAGE_LOCKED`, typed, nothing changed |
| O-S3 | Open | `packagekit.service` is still started by apt's hook during a helper commit |

### 6.3 Gate verdict for T-089

**GO, with limits, for building T-089 and running its end-to-end fault-injection suite on Sentani only** (`writesEnabled` on Sentani only, set in controller config).

The helper's mechanics now pass on real Ubuntu for:
- signature, binding and expiry;
- replay and digest mismatch;
- the atomic ledger;
- query-before-retry after client kills, including inside dpkg;
- exact package transactions, including `Architecture: all`;
- held packages and package-manager locks, refused with typed reasons;
- no service restart inside a package approval, with services needing a restart reported;
- reboot, return and no second reboot;
- non-root disk pressure.

**NO-GO for any other server, and T-089 must not be closed,** until:
1. (c) passes on **0.3.0** under ADR-024: `wget` updated, the owner's `/etc/wgetrc` kept, `.dpkg-dist` reported if one is shipped, and evidence that lists both.
2. T-089 proves that the controller's `previewDigest` equals the helper's precondition rule for packages (not proven here).
3. D-S1 (CLI default pin) and D-S3 (inspect key is a full shell; T-091) are resolved, because they affect how far the write path can be trusted.

Still untested on a real server: a reboot that returns late (outcome unknown), root-side ENOSPC, and uninstall.

---

## 7. Helper 0.3.0 (T-092, ADR-024) re-run of (c), and final verdict

**Installed version:**
- Package sha256 **`604f3fce0afc…21540e2`** is reproduced exactly by rebuilding **`ebe0287`** (integration/live-v1).
- All 13 installed files under `/usr/lib/servrsit` match `ebe0287` (sha256, read as spotty).
- Orchestrator verified VERSION 0.3.0, ownership, sudoers 0440, the ledger kept, and the gateway still rejecting shell input.

**Fake-root gate (no server):** 126/126 on 0.3.0 and still 126/126 on 0.2.0. H12 and H18 passed 3/3 on repeat. Coder's suite at `ebe0287` passes. The binding was extended for `prompt_risk` and `keptFiles` (`feat/tester/next` `e48567c`).

**0.3.0 behaviour, from reading the code:**
- **Changed configuration files are kept and the update still runs.** dpkg runs with `--force-confdef --force-confold`, and ucf with `UCF_FORCE_CONFFOLD`. The files are detected with `dpkg --verify` before the commit. Any `.dpkg-dist` or `.ucf-dist` files that appear under `/etc` during the commit are paired with the kept files and recorded as `keptFiles: [{path, newDefault}]` and in the evidence.
- **`CONFFILE_MODIFIED` is gone.** It survives only in a comment about 0.2.0 records.
- **The only refusal before acceptance is `INTERACTIVE_PROMPT`.** It fires only when debconf's non-interactive frontend (`/usr/share/perl5/Debconf/FrontEnd/Noninteractive.pm`) is missing; it is not decided per package. See O-S4.

**Pre-run checks (read-only):**
- Only `wget` was pending (`1.21.4-1ubuntu4` → `1.21.4-1ubuntu4.5`, `noble-updates`/`noble-security`).
- No hold and no lock. `Noninteractive.pm` is present. `dpkg --audit` is clean.

| Time (UTC) | Op | Digest | Scope | Reply / ledger |
|---|---|---|---|---|
| 10:27:38 | **950bb860** | **d9a448748d8c** | `wget:amd64` `1.21.4-1ubuntu4` → `1.21.4-1ubuntu4.5` (from a fresh `apt-get -s upgrade`) | accepted, then finished, exit 0, **`succeeded`**; **`keptFiles: [{"path": "/etc/wgetrc", "newDefault": null}]`**; evidence: "apt commit returned success (needrestart suspended, no prompts, your changed configuration files kept)", **"your file was kept: /etc/wgetrc (this version brought no new default for it)"**, "1 of 1 packages at the planned version", "services that need a restart (not restarted; needs a separate restart approval): multipathd.service" |

**Independent verification of `/etc/wgetrc` (as spotty):**

| | Before (10:27) | After (10:28) |
|---|---|---|
| `wget` | `1.21.4-1ubuntu4` `ii` | **`1.21.4-1ubuntu4.5` `ii`** |
| `/etc/wgetrc` sha256 | `658b6a5de6aa31844c33b9c7c9a324163a2802dbb61c742ff8962ea798be9774` | **identical** |
| `/etc/wgetrc` md5 / size / mtime | `e5cca7a09bcf…` / 4969 / 09:10:20 | **identical** |
| owner marker line `# servrsit-t088 owner edit` | 1 | **1** |
| `/etc/wgetrc.dpkg-dist` | absent | **absent** |
| `dpkg --verify wget` | `??5?????? c /etc/wgetrc` | the same (the owner's file still differs from the package default) |
| `dpkg --audit` | clean | **clean** |

**Other checks:**
- **apt history:** one transaction, 10:27:44 to 10:27:45, `Upgrade: wget:amd64 (1.21.4-1ubuntu4, 1.21.4-1ubuntu4.5)`.
- **Unit journal** (`servrsit-op-950bb860…`, 10:27:41 to 10:27:51): "Setting up wget (1.21.4-1ubuntu4.5)", the install-info and man-db triggers, "packages have been installed but needrestart is suspended". **No configuration-file prompt and no "keeping old config file" line.** dpkg prints that line only when the package ships a changed default, which matches `newDefault: null`.
- **Services:** all running services kept their PID and start time, including **multipathd MainPID 4794, started 09:16:35**. The exception is `packagekit.service`, started by apt's hook (O-S3).
- **`restartNeeded: multipathd.service`** is the state left by (b) on 0.2.0: `libaio1t64` was updated at 09:30 and the service has not been restarted. It does not come from wget. The helper reports it correctly, and nothing was restarted.
- **Afterwards:** `apt-get -s upgrade` shows 0 to upgrade (only the 11 phased packages remain), and no harness process is left running.

**Result (ADR-024): PASS on Sentani for the kept-file case.** The approved update was applied, the owner's file was kept byte for byte, the evidence names the kept file, there was no prompt and no hang, and dpkg ended clean.

**Not proven live:**
1. **The `.dpkg-dist` path.** wget `…ubuntu4.5` ships the same `/etc/wgetrc` default as `…ubuntu4`, so dpkg had no decision to make and created no new default. To exercise `--force-confold` together with `newDefault`, a candidate is needed whose packaged default changed between the installed and the target version. It can be found read-only by downloading both `.deb` files as spotty into `/tmp` (`apt-get download`) and comparing the conffile checksums. That needs one more founder downgrade.
2. **The vim no-false-positive check.** It was skipped because the vim set is no longer pending (applied in 6.1 (a)). `prompt_risk` does not depend on the package: it returns empty whenever `Noninteractive.pm` exists. (c) passed that same check on this server, so **no package can get a false `INTERACTIVE_PROMPT` on Sentani**, the vim set included. A live vim run would add no information beyond 6.1 (a).

**Observation O-S4 (for Coder, Low):** `INTERACTIVE_PROMPT` is not decided per package (`adapters.py` `RealSystem.prompt_risk()`). It cannot catch a package whose maintainer scripts read from a terminal directly, or a ucf conffile that an older ucf would still prompt for. With `stdin` closed and noninteractive debconf, such a package would fail rather than hang, and `dpkg --audit` would then report it. So the risk is a failed update, not a hang. The name suggests more protection than the check gives.

### 7.1 Final defect status (helper 0.3.0)

| ID | Status |
|---|---|
| D-S5 `Architecture: all` | **Closed**, verified on 0.2.0 (6.1 (a)); unchanged in 0.3.0 |
| D-S6 needrestart | **Closed**, verified on 0.2.0 (6.1 (b)); 0.3.0 still suspends needrestart and lists services needing a restart (seen again in (c)) |
| D-S7 configuration files / prompts | **Closed for the kept-file case** on 0.3.0 (7, ADR-024). `.dpkg-dist` reporting not proven live (gap 1) |
| D-S8 held | **Closed**, verified on 0.2.0 (6.1 (d1)) |
| D-S9 lock | **Closed**, verified on 0.2.0 (6.1 (d2)) |
| D-S1 CLI default pin | Open (Coder) |
| D-S3 founder scripts / inspect key is a full shell | Open (T-091) |
| D-S4 | Open (Info) |
| O-S2 no free-space check | Open |
| O-S3 packagekit started by apt's hook | Open, still seen on 0.3.0 |
| O-S4 coarse `INTERACTIVE_PROMPT` | New, Low |

### 7.2 Final gate verdict for T-089

**GO** for building T-089 and running its end-to-end fault-injection suite **on Sentani only** (`writesEnabled` on Sentani only, set in controller config, never via API or UI). On helper 0.3.0, every helper mechanism T-089 relies on has passed on real Ubuntu:
- signature, binding and expiry; replay, digest mismatch and the atomic ledger;
- query-before-retry after client kills, including inside dpkg;
- exact transactions, including `Architecture: all`;
- `PACKAGE_HELD` and `PACKAGE_LOCKED`;
- no service restarted inside a package approval, with `restartNeeded` reported;
- owner configuration files kept, with the update still applied;
- reboot and return with no second reboot; non-root disk pressure.

**NO-GO for Nabire, Timika, Merauke or any other server**, and T-089 must not be closed, until:
1. T-089 shows that the controller's `previewDigest` equals the helper's package precondition rule. This report does not prove it; my manifests used the helper's rule directly.
2. D-S1 and D-S3/T-091 are resolved.
3. The `.dpkg-dist` reporting case (gap 1) passes live, or the Orchestrator accepts it as tested by code review and fake-root tests only.

Still untested on a real server: a reboot that returns late (outcome unknown at window expiry), root-side ENOSPC, and uninstall. These belong in T-089's fault-injection suite or a later T-088 round.
