#!/bin/sh
# ServrSit target helper uninstall (T-083). REVIEW BEFORE RUNNING.
#
# The OWNER runs this as root through their own channel. It removes, in
# order: the sudoers rule (then checks sudoers with visudo -c), the ONE
# forced-command line ServrSit added to the account's authorized_keys (and
# checks it is gone), /usr/lib/servrsit and /etc/servrsit. It keeps the
# ledger (/var/lib/servrsit) unless --remove-ledger, and the account unless
# --remove-account. It reports only what it verified.
#
# T-084 (D-H7): it first looks for unfinished operations in the ledger and
# for running servrsit-op-* units, and stops if there are any (an operation
# in flight would be left with no helper to answer for it), unless --force.
# T-084 (D-H3): the key line is removed by account-remove-key.sh running AS
# the account (runuser); root never writes inside the account's home.
#
# Usage: sh uninstall.sh --account servrsit [--remove-ledger] [--remove-account] [--force] [--dry-run]

set -eu
ACCOUNT=""; REMOVE_LEDGER=0; REMOVE_ACCOUNT=0; FORCE=0; DRY_RUN=0
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT="${SERVRSIT_ROOT:-/}"
die() { printf 'uninstall: %s\n' "$1" >&2; exit 1; }
step() { printf 'uninstall: %s\n' "$1"; }
run() { if [ "$DRY_RUN" -eq 1 ]; then printf 'uninstall: would run:'; printf ' %s' "$@"; printf '\n'; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --account) ACCOUNT=$2; shift 2 ;;
    --remove-ledger) REMOVE_LEDGER=1; shift ;;
    --remove-account) REMOVE_ACCOUNT=1; shift ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) die "unknown option" ;;
  esac
done
[ "$(printf '%s' "$ACCOUNT" | wc -l)" -eq 0 ] || die "--account contains a line break"
printf '%s' "$ACCOUNT" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$' || die "--account is not a valid account name"
[ "$ACCOUNT" != "root" ] || die "--account may not be root"
if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then die "run as root"; fi

# --- unfinished work first (D-H7) --------------------------------------------
LEDGER="${ROOT%/}/var/lib/servrsit/ledger"
OPEN=""
if [ -d "$LEDGER" ]; then
  for f in "$LEDGER"/*.json; do
    [ -f "$f" ] || continue
    grep -q '"state": "finished"' "$f" || OPEN="$OPEN $(basename "$f" .json)"
  done
fi
if [ "$DRY_RUN" -eq 1 ]; then
  step "would check for running units: systemctl list-units --all --no-legend --plain servrsit-op-*"
  UNITS=""
else
  UNITS=$(systemctl list-units --all --no-legend --plain 'servrsit-op-*' 2>/dev/null | cut -d' ' -f1 | tr '\n' ' ')
fi
if [ -n "$OPEN" ] || [ -n "$(printf '%s' "$UNITS" | tr -d ' ')" ]; then
  [ -z "$OPEN" ] || step "unfinished operations in the ledger:$OPEN"
  [ -z "$(printf '%s' "$UNITS" | tr -d ' ')" ] || step "running ServrSit units: $UNITS"
  if [ "$FORCE" -eq 0 ]; then die "an operation is not finished; wait for it (or check it with ServrSit), or pass --force to remove the helper anyway"; fi
  step "--force given: removing the helper although operations are not finished; their ledger records are kept"
  REMOVE_LEDGER=0
fi

SUDOERS="${ROOT%/}/etc/sudoers.d/servrsit"
step "removing the sudoers rule"
run rm -f -- "$SUDOERS"
if [ "$DRY_RUN" -eq 0 ]; then
  [ ! -e "$SUDOERS" ] || die "the sudoers rule is still there"
  visudo -c >/dev/null || die "sudoers does not validate; check it before closing your session"
  step "verified: the sudoers rule is gone"
fi

LINE_PREFIX='command="/usr/lib/servrsit/bin/servrsit-gateway"'
if [ "$DRY_RUN" -eq 1 ]; then
  step "would run as $ACCOUNT: account-remove-key.sh, removing lines containing: $LINE_PREFIX"
elif HOMEDIR=$(getent passwd "$ACCOUNT" | cut -d: -f6) && [ -n "$HOMEDIR" ] && [ -d "$HOMEDIR" ]; then
  [ -f "$HERE/account-remove-key.sh" ] || die "account-remove-key.sh is missing next to this script"
  runuser -u "$ACCOUNT" -- /bin/sh -s -- "$HOMEDIR" < "$HERE/account-remove-key.sh" || die "the key line could not be removed as $ACCOUNT; check ~$ACCOUNT/.ssh/authorized_keys yourself"
else
  step "the account $ACCOUNT has no home directory; nothing to remove there"
fi

step "removing /usr/lib/servrsit and /etc/servrsit"
run rm -rf -- "${ROOT%/}/usr/lib/servrsit" "${ROOT%/}/etc/servrsit"
if [ "$REMOVE_LEDGER" -eq 1 ]; then run rm -rf -- "${ROOT%/}/var/lib/servrsit"; else step "kept the ledger in /var/lib/servrsit (evidence of past operations)"; fi
if [ "$REMOVE_ACCOUNT" -eq 1 ]; then run userdel --remove -- "$ACCOUNT"; fi
step "done"
