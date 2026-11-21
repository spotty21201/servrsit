# Test report — T-088 helper on Sentani, real Ubuntu (sentani-001)

**Author:** Kiro Tester · **For:** Kiro Orchestrator · **Started:** 2026-11-21
**Status:** steps P, 1 and 3a/3b **final** (runs 07:03 to 07:05 UTC, commit `cf2a16b`). Step 2 **final** (07:38 to 07:40 UTC). Next: F2 (hold) test, then F3 (lock) test, both on the LLVM set, then 3c (mid-dpkg kill) applies the LLVM set. Then steps 4 and 5.
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
- **Services:** all 23 running services kept their PID and start time. needrestart restarted nothing for this set. vim is not loaded by any service, so this does **not** show what needrestart does when a library used by a service is upgraded.
- **Timing:** ~35 s between acceptance and dpkg start, which covered cache open and download; ~4 s of dpkg.

**Unattended-upgrades:** next run 2026-11-22 06:14 UTC. The vim set is already done. The LLVM set is in `noble-updates` only, which Ubuntu's default unattended-upgrades configuration does not install. The package steps should finish well before then.

### 3c, F2, F3, 4, 5 — not run yet

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
| needrestart: no service restart from a package update | **Proven only for packages no service loads** (vim). Not proven for libraries used by services |
| External lock, held package, dpkg interruption | **NOT proven yet** (F3, F2, 3c) |
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

No other helper defect was found in steps 1, 2 and 3a/3b.
