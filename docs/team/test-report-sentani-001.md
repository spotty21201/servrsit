# Test report — T-088 helper on Sentani, real Ubuntu (sentani-001)

**Author:** Kiro Tester · **For:** Kiro Orchestrator · **Started:** 2026-11-21
**Status:** steps P, 1 and 3a/3b **final** (runs 07:03 to 07:05 UTC, commit `cf2a16b`). Step 2 **final** (07:38 to 07:40 UTC). F2 (held package) and F3 (lock) **final** (07:51 and 08:10 UTC). Next: 3c (mid-dpkg kill) applies the LLVM set, then steps 4 and 5. **Orchestrator decision (after step 2):** F2, F3 and 3c run on the CURRENT helper (`4101502`). Any result that touches needrestart or debconf is labelled **[PRE-FIX]**. Step 2 and a needrestart/conffile case are re-run after T-090 (fixes for D-S5 to D-S7) is installed.
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

### 3c, 4, 5 — not run yet

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
| dpkg interruption | **NOT proven yet** (3c) |
| Reboot and return verification (boot id, SSH, query settles) | **NOT proven yet** (step 4) |
| Low disk | **NOT proven yet** (step 5); root-side ENOSPC is probably not reachable as spotty |
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
