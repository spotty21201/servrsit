# Test report — T-083 target helper (helper-001)

**Author:** Kiro Tester · **For:** Kiro Orchestrator · **Date:** 2026-11-18
**Helper under test:** `feat/coder/target-helper` at **`6c7df23`** (pinned; checked out detached in a throwaway worktree, clean, verified by test H00)
**Spec reviewed:** Technical Spec §7.2 (approved-maintenance mode), §8.1 to §8.3 (catalog, signed manifest, path and service safety); execution-security steering; ADR-020 (signing key)
**Implementation reviewed:** `target-helper/servrsit_helper/{schema,canonical,signature,ledger,paths,gateway,helper,runner,adapters}.py`, `target-helper/bin/*`, `target-helper/packaging/{bootstrap.sh,uninstall.sh,sudoers.in,build.sh}`

> ## ⚠ NOT PROVEN by this report
> **APT transactions, systemd units and transient runs (`systemd-run`), service restarts, reboots, real root ownership and chown to other users, real `sudo`/sudoers behaviour, `visudo`, sshd's forced command and `restrict`, and the execution of `bootstrap.sh` and `uninstall.sh`.**
>
> Spelling note: the account's SSH key directory is written "dot-ssh" in this report and built at runtime in the tests, because the repository leak scan forbids its literal name.
>
> These tests run as an ordinary user against a fake root in a temporary directory. `RealSystem` (the only code that touches the machine) was not run at all. All of the above needs the **disposable VM (T-012)** before any live use.
>
> Nothing was run on Sentani, Nabire, Timika, Merauke or any other server. No SSH, no sudo, no `visudo`, no `systemd-run`. The scripts were reviewed as text and never executed.

---

## Test Report

**Feature / Change:** T-083 target helper, BUILD ONLY
**Spec reviewed:** Tech Spec §7.2, §8.1 to §8.3
**Implementation reviewed:** as above, at `6c7df23`

### Result: FAIL (5 defects open: 2 Medium, 3 Low; 2 Info)

The core security mechanics hold under test:
- signature checks;
- replay and digest mismatch;
- schema and allowlist;
- one unresolved mutation per server;
- symlink and race-safe directory creation;
- postcondition checks.

The failures are robustness and install-script issues: crashes on hostile or torn input (D-H1, D-H2) and a root-follows-symlink path in `bootstrap.sh` (D-H3). No failure leads to an unapproved or duplicated mutation in the fake-root tests.

### 1. How it was tested

| Item | Choice |
|---|---|
| Runner | pytest 8.3.4 (vendored pure-Python wheels, sha256 checked against PyPI, `tests/helper/vendor-lock.txt`; `vendor/` is gitignored) on Python 3.12.3, Ubuntu `python3-cryptography` 41.0.7 |
| Command | `cd tests/helper && SERVRSIT_HELPER_SRC=<checkout of 6c7df23>/target-helper PYTHONPATH=vendor:. python3 -m pytest -q -p no:cacheprovider` |
| Signer | Tester's own: RSA-PSS/SHA-256, 3072-bit, MGF1-SHA256, salt 32 (the Tech Spec §8.2 / KMS form), plus one Ed25519 control |
| Canonical JSON | Tester's own implementation from the rule text, used only to sign. Every accepted manifest proves byte agreement with `canonical.py` for the shapes used |
| Precondition digests | Recomputed by the Tester from the fake target's state, not by calling `adapters.precondition_digest` |
| Machine | Tester's own `RecordingSystem` (implements the helper's `System` interface). It records launches, apply, restart and reboot to a file, so counting works across processes. No import from Coder's `tests/support.py` or `vectors.json` |
| Path | Each submit goes through `gateway.forward()`. The sudo hop is replaced by an in-process `helper.handle()`, and the recorder keeps the argv and env the gateway would pass to sudo. The runner is called in-process where `systemd-run` would start it |
| Ownership | `require_root=False` (ordinary user) except H17, which turns it on to prove non-root files are refused. `ids()` maps every approved account to the test user, so chown to another uid is not exercised |

### 2. Results

| Run | Result |
|---|---|
| Bound, 3 consecutive runs | 119 passed, 6 failed, 1 xfailed (twice); 118 / 7 / 1 once. The extra failure is H12-threads, an intermittent symptom of D-H2. Over 8 further runs H12-threads failed 3 times |
| Unbound (no `SERVRSIT_HELPER_SRC`) | 126 skipped |
| Coder's own suite at `6c7df23` (`PYTHONPATH=..:. python3 -m unittest`, read-only) | 51 tests OK |

Failing tests (all are open defects, none are test errors):
- `test_H21_…[b'{"version":1,"op":"submit","signed":1111'..len5037]`
- `test_H21b_…[signed-5000-digit-int]`, `test_H21b_…[extra-4400-digit-negative-int]`
- `test_H18_a_torn_record_left_by_a_crash_mid_claim_does_not_crash_query_or_submit`
- `test_H12_concurrent_claims_…_threads` (intermittent)
- `test_H45_bootstrap_does_not_follow_a_symlinked_ssh_directory_in_the_accounts_home`
- `test_H46_the_sudoers_template_is_covered_by_the_package_checksum`
- XFAIL (strict): `test_H04b_duplicate_json_keys_are_rejected_outright` (D-H5, Info)

### 3. Binding adaptations made when the helper landed

The tests were written from the spec before the code existed. These changes were made when binding. None of them weakens an assertion about required behaviour.
- **Reply codes:** these are now the helper's own codes, for example `INVALID_SIGNATURE` instead of the draft's `BAD_SIGNATURE`, and `TARGET_BUSY` instead of `BUSY`.
- **Field names:** `server` replaces the draft's `serverIdentity`. Operation ids are UUIDs, and the short ids `op-NNNN` map to fixed UUIDs.
- **H40 (sudoers):** the file may carry `Defaults:<account>` lines next to its one rule. The test checks that every option is restrictive (`env_reset`, `!setenv`, `!requiretty`).
- **H04:** split into H04 (a duplicate key that changes the parsed manifest fails the signature: PASS) and H04b (outright rejection of duplicate keys). H04b is strict-xfail because Tech Spec §8.2 does not require outright rejection (D-H5).
- **H33:** I removed `0775` from the forbidden modes. That was my error. The spec says "explicitly approved values", and the helper's rule (owner has rwx, never world-writable, no setuid/setgid/sticky) allows an approved group-writable directory.
- **H41:** my first version matched the `step "...visudo -c -f"` echo line instead of the command. Fixed.

### Tests written
- `tests/helper/binding.py`: binding to the helper. Contains the independent signer, canonical JSON, precondition digests, `RecordingSystem`, gateway driver, manifest builder and pinned-commit check.
- `tests/helper/test_helper.py`: 126 tests (H00 to H55), listed below.
- `tests/helper/vendor-lock.txt`, `tests/helper/.gitignore`.

### Spec conformance

**§8.2 Signed manifest**
- [PASS] Manifest carries every listed field: schema version, installation id, server binding, unique operation id, plan id/version/digest, catalog version, exact scope, precondition digest, issue/expiry times, verification contract. No executable field. (H05, H22)
- [PASS] Signature over the canonical JSON. The Tester's RSA-PSS-3072/salt-32 signer is accepted, as is Ed25519. RSA below 3072 bits is refused as untrusted (ADR-020). (H01, H01b)
- [PASS] Any change after signing is rejected, for each of 8 fields. (H02)
- [PASS] Unknown key id, another key under the same id, PKCS#1 v1.5 padding, garbage, empty or non-base64 signature, and a missing signature are all rejected. (H03)
- [PASS] Unsupported schema or catalog version is rejected, including `"1"` and `true` for `1`. Another installation or another host key gives `MISBOUND`. (H05)
- [PASS] Expired acceptance is rejected. An accepted job finishes after expiry. A replay after expiry returns the existing operation. (H06)
- [PASS] Clock skew: a slow target sees a future `issuedAt`, so the reply is `EXPIRED` with detail `CLOCK_SKEW`. A fast target (the Merauke case, +7 h) gets `EXPIRED`. Skew within 120 s is accepted. (H07) See observation O-1.
- [PASS] A precondition digest that does not match the target now, or is `none`, gives `PRECONDITION_CHANGED`. (H08)
- [PASS] Repeated identical manifest: the second reply is `existing` with the same id, and the runner launches once. (H10)
- [PASS] Same id with a different digest gives `DIGEST_MISMATCH`, the ledger is byte-identical afterwards, and there is no second launch. (H11)
- [PASS] Atomic claim: 16 separate processes with the same manifest give exactly 1 `accepted` and 15 `existing`, with 1 launch. (H12b)
- [PASS] One unresolved mutation per server: 12 different operations racing in separate processes give 1 accepted and 11 refused. (H12c)
- [**PARTIAL**] 16 concurrent identical requests as threads give 1 launch every time, so there is never a duplicate execution. But some replies crash (`JSONDecodeError`) instead of returning `existing`. (H12, D-H2)
- [PASS] A second operation while the first is open gets `TARGET_BUSY`, and is accepted after the first finishes. (H13)
- [PASS] A reboot without a new boot id stays `running` and keeps blocking writes 24 h later. A new boot id settles it as `succeeded`. Exactly 1 reboot call. (H13b, invariant 8)
- [PASS] Ledger records are 0600 in a 0700 directory. A symlinked ledger directory, a group-readable ledger and a symlinked record are refused without writing anywhere. (H14, H14b, H14c)
- [PASS] A terminal record cannot be rewritten: `Ledger.update` raises, a replay returns `existing`, and a rerun of the runner does nothing. (H15)
- [**FAIL**] "A crash leaves the old or the new record, never half of one" (ledger docstring). The first claim is written in place, so a torn or empty record crashes query and submit. (H18, D-H2)

**§7.2 Restricted helper, gateway, privilege configuration**
- [PASS] The trust store is refused if group/other-writable or a symlink. With `require_root=True`, files owned by an ordinary user are refused. (H16, H17) Real root ownership: NOT PROVEN.
- [PASS] The gateway ignores `SSH_ORIGINAL_COMMAND`, `LD_PRELOAD`, `PYTHONPATH`, `PATH` and `SUDO_COMMAND`. It calls exactly `["/usr/bin/sudo","-n","--","/usr/lib/servrsit/bin/servrsit-helper"]` with env `{PATH:/usr/bin:/bin, LC_ALL:C}` and `shell=False`. (H20)
- [PASS] All three entry points use `#!/usr/bin/python3 -I` and do not read argv or environ themselves. (H20b) The runner reads its one argument from `runner.main`, and it is UUID-checked.
- [**FAIL**] Bounded input is refused cleanly: 12 of 13 hostile inputs pass, including 2 MiB, `{`×5000, `[`×100000, invalid UTF-8, NaN, float version and path-like ids. A JSON integer over 4300 digits crashes the gateway and the helper with an uncaught `ValueError`. (H21, H21b, D-H1)
- [PASS] No field can carry a command, exec, env, unit text, path or args, at the manifest, signed, request or scope level. (H22)
- [PASS] Only the 4 allowlisted mutations are accepted. 9 other ids are refused, including `query.operation.v1` used as a mutation, `remove.packages.v1` and `refresh.package_metadata.v1`. (H23)
- [PASS] Restart accepts only units listed at bootstrap. 12 hostile or unlisted names are refused (`sshd.service`, `nginx@evil.service`, globs, paths, `.socket`, newline, leading dash). (H24, H24a)
- [PASS] Separate approvals: a restart manifest cannot set `includesReboot`, a reboot manifest cannot set `includesServiceRestart`, and a package manifest carries no reboot field. (H25, invariant 5)
- [PASS] sudoers: exactly one rule, `servrsit ALL=(root) NOPASSWD: /usr/lib/servrsit/bin/servrsit-helper ""`. No shell, python, systemctl, apt or systemd-run. `Defaults` options are restrictive only. (H40, static)
- [PASS] `visudo -c -f` runs on the temporary file before install and stops on failure. `visudo -c` runs after install, and the rule is removed on failure. (H41, static; `visudo` NOT run)
- [PASS] The key line is `restrict,command="/usr/lib/servrsit/bin/servrsit-gateway" ssh-ed25519 …`, with no re-enabled forwarding or PTY. (H42, static; sshd behaviour NOT PROVEN)
- [PASS] Bootstrap appends to `authorized_keys` without overwriting it. It never touches the main sudoers, sshd_config, firewall or other accounts, and refuses `--account root`. (H43, static)
- [**FAIL**] "Preserves existing independent owner access" and root-owned, non-writable configuration: bootstrap follows a symlinked dot-ssh directory (the account's SSH key directory) as root. (H45, D-H3)
- [**FAIL**] "Versioned, checksum-verified package": the sudoers template is read from beside the script, outside the verified package. (H46, D-H4)
- [PASS] Uninstall removes the sudoers rule first and verifies it is gone (plus `visudo -c`). It removes only lines containing ServrSit's gateway prefix and verifies that with grep. It never deletes the whole `authorized_keys`. It keeps the ledger unless `--remove-ledger`. A dry run makes no "verified" claim. (H44, static) See D-H7.

**§8.3 Path and service safety**
- [PASS] Directories are created only under `/srv/<x>` or `/home/<confirmed user>/<x>`. 24 refused cases, including the dot-ssh directory, `/etc`, `/proc`, `/sys`, `/dev`, `/run`, the ledger, `..`, `.`, relative paths, NUL, newline, `//`, a trailing slash, another user's home, the roots themselves, depth over 8, a leading dash and a space. (H30)
- [PASS] Positive control: both roots are created with exactly the planned mode under `umask 077`, and the outcome is verified `succeeded`. (H30b)
- [PASS] An unknown owner or group creates nothing, and the outcome is `failed`. (H30c)
- [PASS] A symlink in an intermediate component is not followed. A symlinked last component is neither followed nor chmodded. (H31)
- [PASS] Check/use race on the primitive: over 2,000 creations under a parent that flips between directory and symlink, nothing escaped. In 3 measured runs the race was hit 1,767, 1,797 and 1,666 times (refused) and 233, 203 and 334 creations happened. The same race through the full gateway, helper and runner path (150 operations): nothing escaped. (H32, H32b)
- [PASS] Existing contents are never overwritten: an existing directory with another mode is left as it is and not reported `succeeded`. Modes 0777, 4755, 2755, 1777, 0757, 0600, 0055, `755x`, `0o755` and `07555` are refused. (H33)

**Invariant 9, verify actual postconditions (runner logic only, against the fake System)**
- [PASS] A restart with exit 0 but no new start time is `failed`. (H50)
- [PASS] A package apply that reports success but changes nothing is `failed`. (H51)
- [PASS] If the target changes between acceptance and run, the adapter is not called and the outcome is `failed`. (H52)
- [PASS] An adapter exception ends in a final `failed` record, and the raw exception text is not in the evidence. (H53)
- [PASS] If the runner cannot start, the record is `failed` and the server is unblocked. (H54)
- [PASS] A query returns bounded evidence (at most 20 items), not the manifest, and nothing from the request. (H55)

### Mutation checks

These were temporary edits in my throwaway worktree, each reverted with `git checkout`. `git status` was clean afterwards and H00 confirms it.

| Mutant | Detected by |
|---|---|
| M1 `verify_manifest` always valid | H02, H03 |
| M2 claim without the lock (O_EXCL kept) | Not detected. This is expected: O_EXCL alone still stops a second claim, and the losers get `HELPER_UNAVAILABLE`, not a second run |
| M2b claim without the lock and without O_EXCL | H12 (4 of 5 runs: 2 to 5 launches from 16 requests) |
| M3 path walk without O_NOFOLLOW | H31, H32, H32b |
| M4 no root restriction on directories | H30 |
| M5 no expiry check | H06, H07 |
| M6 restart judged by exit code only | H50 |
| M7 unit allowlist off | H24 |
| M8 one-unresolved-mutation check off | H12c, H13, H13b |
| M9 a claim-time `existing` also launches | H12 (5 of 5 runs: 2 to 7 launches) |

### Defects found

| ID | Severity | File:Line | Description | Repro |
|----|----------|-----------|-------------|-------|
| D-H1 | Low | `servrsit_helper/gateway.py` (`except (UnicodeDecodeError, json.JSONDecodeError, SchemaError, RecursionError)` in `forward`); `servrsit_helper/helper.py` (same tuple in `handle`) | Python 3.12 `json.loads` raises a plain `ValueError` ("Exceeds the limit (4300 digits)") for a long integer literal. Neither handler catches it, so the gateway (running as the SSH account) dies with a traceback on stderr, which goes back to the SSH client. This breaks the "error texts are fixed" rule at the trust boundary. No mutation happens. | `gateway.forward(b'{"version":1,"op":"submit","x":' + b'1'*5000 + b'}', run=None)` gives an uncaught `ValueError`. Tests: H21[...len5037], H21b ×2 |
| D-H2 | **Medium** | `servrsit_helper/ledger.py` `claim()` (`self._write_new(path, record)` writes the final path in place) and `_read()` (no lock in `get()`); `servrsit_helper/helper.py` `submit()` (`ledger.get()` before the locked claim), `query()`, and `handle()` (catches only `LedgerError, OSError`) | The first claim creates `<id>.json` with O_CREAT\|O_EXCL and then writes it, while `submit` and `query` read it without the lock. **(a)** A concurrent identical replay can read an empty file, raise `JSONDecodeError` and crash. In production that becomes `HELPER_UNAVAILABLE` instead of `existing` (H12-threads fails in about 1 run in 3; there is still never a second launch). **(b)** A crash or power loss between create and write leaves an empty record. After that, every query for that id crashes, and every new submit crashes too, because `unresolved()` reads every record. The helper stays stuck until someone cleans it up by hand. This contradicts the module's own claim "never half of one". | Plant an empty `<id>.json` (0600) in the ledger, then `helper.handle()` a query for it, then a submit for another id: both raise `JSONDecodeError`. Tests: H18 (deterministic), H12 (intermittent) |
| D-H3 | **Medium** | `packaging/bootstrap.sh` step 5 (`install -d -m 0700 -o "$ACCOUNT" … "$HOMEDIR/<dot-ssh>"`, `[ ! -L "$AK" ]`, `touch`/`chown`/`chmod`/`>>` on `$AK`) | Root works inside a home the account controls, but only `authorized_keys` is checked for a symlink. If the account's dot-ssh directory is a symlink (for example to root's dot-ssh directory), `install -d -o` changes the mode and owner of the link's target, and `touch`, `chown`, `chmod` and `>>` act on a file inside it. The `[ ! -L "$AK" ]` check passes, because `AK` itself is not a link. With an existing account (`--account` without `--create-account`, or a pre-existing `servrsit`), whoever controls that account can plant the link before the owner runs bootstrap, and take ownership of root's dot-ssh directory. There is also a check/use window between `[ ! -L "$AK" ]` and the following commands. `uninstall.sh` has the same pattern (`cat "$TMP" > "$AK"` through a symlinked dot-ssh directory), with lower impact. | Static review; the script was not run. Coreutils behaviour shown as an ordinary user in `/tmp`: `install -d -m 0700 link` changed the target from 0711 to 0700, and `[ -L home/<dot-ssh>/authorized_keys ]` was false while `home/<dot-ssh>` was a symlink. Test: H45 |
| D-H4 | Low | `packaging/bootstrap.sh` (`sed … "$HERE/sudoers.in"`); `packaging/build.sh` (packages only `servrsit_helper/*.py`, `bin/`, `VERSION`) | The one root-granting file is built from a template next to the script, not from the checksum-verified package. A changed `sudoers.in` would pass the `--sha256` check. `visudo -c -f` checks syntax, not content. | Test: H46 (static) |
| D-H5 | Info | `servrsit_helper/helper.py` `handle()`, `gateway.py` `forward()` (`json.loads` without `object_pairs_hook`) | Duplicate JSON keys are accepted and the last value wins. Today the verified object and the executed object are the same parse, so the signed form cannot differ from the executed form (H04 PASS). Rejecting duplicates would remove the class of bug for any future second parser. Not required by the spec. | H04b (strict xfail) |
| D-H6 | Info (not tested) | `servrsit_helper/paths.py` `create_directory()` (`if st.st_nlink != 2`) | On filesystems that report `nlink=1` for directories (btrfs), every new directory would be refused after `mkdir`. That would leave an empty root-owned 0700 directory that the evidence reports as "not created". Ubuntu 24.04's default ext4 behaves as expected (`/tmp` here is ext4). Check this on T-012 if any target uses btrfs. | Not reproduced; code reading only |
| D-H7 | Low | `packaging/uninstall.sh` | Uninstall does not check the ledger for unresolved operations or for running `servrsit-op-*` units before it removes the helper. An operation in flight would be left `running` with no helper to answer queries, and the owner is not told. Tech Spec §17.2 says disconnection must explain any remaining helper or ledger. | Static review |

### Observations (no defect)
- **O-1, clock skew.** On a fast target (the Merauke +7 h case), the reply is plain `EXPIRED`. The target cannot tell that apart from a late delivery. So the "time-sync finding" in Tech Spec §8.2 has to come from the controller's own inspection of target time. The helper also has no upper bound on `acceptBefore − issuedAt`. The controller's 15-minute default is the only limit, and a helper-side cap would be defence in depth.
- **O-2, defence in depth.** `create_directory` does not re-check the `/srv`/home rule itself. It relies on the schema check at submit, and a ledger manifest is root-only, so this is acceptable as built.
- **O-3, runner trust.** The runner trusts the ledger manifest without checking its signature again. This is acceptable because the ledger is root-only (0700).

### Regressions
- None detected. Coder's 51 helper tests pass at `6c7df23`. This report adds only files under `tests/helper/` and this document. The product, web and API suites were not re-run for this change. Their last full run is recorded in `test-report-next-001.md` §7 (`pnpm test` 740/740).

### Recommendations
1. **D-H2 (Medium):** write the first claim through temp-file-and-rename like `_replace`, read under the lock (or retry on a torn read), and catch `ValueError` (JSON) in `handle()` as `HELPER_UNAVAILABLE`. Decide how the helper treats an unreadable record in `unresolved()`: fail closed with a clear code, not a crash. Re-run H18 and H12 (×10).
2. **D-H3 (Medium):** in bootstrap and uninstall, refuse when `$HOMEDIR/<dot-ssh>` is a symlink or not owned by the account. Better, do the key-file work as the account (`runuser -u "$ACCOUNT" --`), or with `chown -h`/no-follow operations, so root never follows a path the account controls. Re-run H45, and prove it on T-012 with a planted link.
3. **D-H1 (Low):** add `ValueError` to both exception tuples, or set a parse hook that rejects long integers. Re-run H21 and H21b.
4. **D-H4 (Low):** ship `sudoers.in` inside the checksum-verified package and read it from `$WORK/servrsit-helper/`.
5. **D-H7 (Low):** have uninstall list unresolved ledger records and running `servrsit-op-*` units, and stop (or require `--force`) before removing the helper.
6. **T-012 (disposable VM)** must prove everything in the box at the top before any live use: APT commit and locking, `systemd-run` surviving SSH disconnect, restart and reboot verification, root ownership, the real sudoers rule with `sudo -n`, sshd's `restrict` plus forced command, and bootstrap and uninstall end to end, including the D-H3 planted-link case.
7. When D-H1 to D-H4 are fixed, I re-run this suite against the new pinned commit, with the same mutants.

---

## Addendum A — T-084 status check (2026-11-18)

**Status: PENDING. T-084 has not landed on integration/next. D-H1 to D-H7 all remain OPEN.**

- **Where T-084 stands:** T-084 exists only as a task-board line (`53d5fa5`, on `integration/live-v1`), with status `todo`. No helper code has changed: `git diff 6c7df23 42b490e -- target-helper` is empty.
- **Re-run on the integration/next head `42b490e`** (throwaway worktree, removed afterwards): 118 passed, 7 failed, 1 xfailed. The failures are the same tests as in §2: H18, H21, H21b ×2, H45 and H46, plus the intermittent H12-threads (D-H2). H04b is the strict xfail (D-H5).

| Defect | Status at `42b490e` | Evidence |
|---|---|---|
| D-H1 | Open | H21 [5,000-digit integer], H21b ×2 |
| D-H2 | Open | H18; H12-threads failed in this run |
| D-H3 | Open | H45 |
| D-H4 | Open | H46 |
| D-H5 | Open (Info) | H04b strict xfail |
| D-H6 | Open (Info, not tested) | code reading only |
| D-H7 | Open | static review |

**Next:** when T-084 is merged to integration/next, I re-run against that pinned commit, repeat H12 ×10 and the 10 mutants, and record the close or re-open decision for each defect in Addendum B.
