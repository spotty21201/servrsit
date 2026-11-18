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
# Usage: sh uninstall.sh --account servrsit [--remove-ledger] [--remove-account] [--dry-run]

set -eu
ACCOUNT=""; REMOVE_LEDGER=0; REMOVE_ACCOUNT=0; DRY_RUN=0
ROOT="${SERVRSIT_ROOT:-/}"
die() { printf 'uninstall: %s\n' "$1" >&2; exit 1; }
step() { printf 'uninstall: %s\n' "$1"; }
run() { if [ "$DRY_RUN" -eq 1 ]; then printf 'uninstall: would run:'; printf ' %s' "$@"; printf '\n'; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --account) ACCOUNT=$2; shift 2 ;;
    --remove-ledger) REMOVE_LEDGER=1; shift ;;
    --remove-account) REMOVE_ACCOUNT=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) die "unknown option" ;;
  esac
done
[ "$(printf '%s' "$ACCOUNT" | wc -l)" -eq 0 ] || die "--account contains a line break"
printf '%s' "$ACCOUNT" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$' || die "--account is not a valid account name"
[ "$ACCOUNT" != "root" ] || die "--account may not be root"
if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then die "run as root"; fi

SUDOERS="${ROOT%/}/etc/sudoers.d/servrsit"
step "removing the sudoers rule"
run rm -f -- "$SUDOERS"
if [ "$DRY_RUN" -eq 0 ]; then
  [ ! -e "$SUDOERS" ] || die "the sudoers rule is still there"
  visudo -c >/dev/null || die "sudoers does not validate; check it before closing your session"
  step "verified: the sudoers rule is gone"
fi

LINE_PREFIX='restrict,command="/usr/lib/servrsit/bin/servrsit-gateway" '
if [ "$DRY_RUN" -eq 1 ]; then
  step "would remove lines starting with: $LINE_PREFIX from ~$ACCOUNT/.ssh/authorized_keys"
elif HOMEDIR=$(getent passwd "$ACCOUNT" | cut -d: -f6) && [ -n "$HOMEDIR" ] && [ -f "$HOMEDIR/.ssh/authorized_keys" ]; then
  AK="$HOMEDIR/.ssh/authorized_keys"
  [ ! -L "$AK" ] || die "$AK is a symlink; nothing was changed"
  TMP=$(mktemp)
  grep -vF -- "$LINE_PREFIX" "$AK" > "$TMP" || true
  cat "$TMP" > "$AK"; rm -f -- "$TMP"
  if grep -qF -- "$LINE_PREFIX" "$AK"; then die "ServrSit's key line is still in $AK"; fi
  step "verified: ServrSit's key line is no longer in $AK"
else
  step "no authorized_keys file for $ACCOUNT; nothing to remove there"
fi

step "removing /usr/lib/servrsit and /etc/servrsit"
run rm -rf -- "${ROOT%/}/usr/lib/servrsit" "${ROOT%/}/etc/servrsit"
if [ "$REMOVE_LEDGER" -eq 1 ]; then run rm -rf -- "${ROOT%/}/var/lib/servrsit"; else step "kept the ledger in /var/lib/servrsit (evidence of past operations)"; fi
if [ "$REMOVE_ACCOUNT" -eq 1 ]; then run userdel --remove -- "$ACCOUNT"; fi
step "done"
