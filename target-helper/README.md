# ServrSit target helper (T-083) — BUILD ONLY

**Not installed on any server.** Nothing in this directory has been copied to,
installed on or run on Sentani, Nabire, Timika or Merauke, and it must not be
until the disposable-target gates pass and the founder authorises the specific
installation (execution-security invariants 11 and 12, D-HELPER-01).

## What it is

A small, explicitly installed program that lets ServrSit make one approved
change at a time on an Ubuntu 24.04 server (Technical Spec 7.2, 8). It has no
listening port, no polling loop and no model. It runs only:

- when ServrSit's dedicated SSH key connects (the **gateway**), and
- for a job it already accepted (the **runner**, as a transient systemd unit).

| Part | Runs as | Does |
|---|---|---|
| `servrsit-gateway` | the ServrSit SSH account (forced command) | Ignores the requested command, reads one bounded JSON request, checks it, passes it to the helper through the one sudoers rule. |
| `servrsit-helper` | root, via `sudo -n` (no arguments) | Verifies the manifest signature, schema, installation and host-key binding, expiry and preconditions, claims the operation id in the ledger, and starts the runner. Answers `query.operation.v1` from the ledger. |
| `servrsit-runner <id>` | root, as `servrsit-op-<id>.service` (systemd-run) | Rechecks the precondition, runs the one adapter for the operation, verifies the result independently and records it. |

Operations: `apply.packages.v1`, `restart.service.v1` (only units listed at
bootstrap), `reboot.host.v1`, `prepare.directories.v1`, plus `query.operation.v1`.
There is no field that can carry a command, a path to run, an environment or a
unit definition.

## Files it installs (bootstrap.sh)

| Path | Owner, mode | Content |
|---|---|---|
| `/usr/lib/servrsit/` | root:root 0755, files 0644/0755 | the helper code and the three entry points |
| `/etc/servrsit/helper.json` | root:root 0644 | installation id, home user, restartable units, clock tolerance |
| `/etc/servrsit/trust.json` | root:root 0644 | ServrSit's **public** signing key(s), by key id |
| `/var/lib/servrsit/ledger/` | root:root 0700 | one JSON record per operation |
| `/etc/sudoers.d/servrsit` | root:root 0440 | `<account> ALL=(root) NOPASSWD: /usr/lib/servrsit/bin/servrsit-helper ""` — validated with `visudo -c -f` before install and `visudo -c` after |
| `~<account>/.ssh/authorized_keys` | the account, 0600 | one added line: `restrict,command="/usr/lib/servrsit/bin/servrsit-gateway" ssh-ed25519 …`, written by `account-add-key.sh` running **as the account** (never by root inside its home; symlinks refused) |

The sudoers template and both account-side key scripts are inside the
checksum-verified package; bootstrap reads them only from there.
`uninstall.sh` stops if the ledger has an unfinished operation or a
`servrsit-op-*` unit is running, unless `--force` (and then keeps the ledger).

Package updates (helper 0.2.0, T-090):
- **Architecture: all packages** are matched by apt's own name resolution.
- **No service restarts during an update.** The commit runs with needrestart suspended and in list-only mode. Services that need a restart afterwards are reported (`restartNeeded`) for a separate restart approval.
- **Prompts and configuration files.** The commit runs with no prompts (`DEBIAN_FRONTEND=noninteractive`) and with `--force-confdef --force-confold`. An update touching a configuration file the owner changed is refused before acceptance (`CONFFILE_MODIFIED`).
- **Unfinished packages.** `dpkg --audit` must be clean after the commit, or the operation is not reported as succeeded.
- **Holds and locks.** A held package (`apt-mark hold`) is refused with `PACKAGE_HELD` and its name; holds are never overridden. If another program holds an apt or dpkg lock, the operation ends `failed` with `reasonCode: PACKAGE_LOCKED` and "nothing was changed, try again".

Installing a newer version over an older one is an upgrade. It replaces the code, keeps the ledger, the account and the key, and is refused while an operation is unfinished.

Dependencies, from Ubuntu's archive only: `python3` (3.12), `python3-apt`,
`python3-cryptography`. Nothing from pip. The package is a reproducible
tarball with a SHA-256 that bootstrap checks before installing anything.

Your own accounts, keys, sudoers files, firewall and SSH settings are not
changed. `uninstall.sh` removes the sudoers rule, ServrSit's one key line
(and checks both are gone), `/usr/lib/servrsit` and `/etc/servrsit`; it keeps
the ledger unless asked.

## Tests

    cd target-helper/tests && PYTHONPATH=..:. python3 -m unittest -v
    # or, where pytest is installed:  cd target-helper && python3 -m pytest tests

**What the tests do not prove.** They run as an ordinary user with a fake
system: no APT transaction, no systemd unit, no reboot, no sudo, no real
root-owned files. They prove the checks, the ledger, the directory code and
the scripts' logic. APT, systemd and reboot behaviour must be proven on a
disposable target (T-012) before any live use.
