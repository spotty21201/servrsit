#!/bin/sh
# Runs AS THE SERVRSIT ACCOUNT, never as root (T-084, D-H3). uninstall.sh
# starts it with `runuser -u <account> --`. It removes only the lines that
# force ServrSit's gateway, keeps every other line, and checks they are gone.
#
# Usage: sh account-remove-key.sh <home-directory>
set -eu
umask 077
HOMEDIR=${1:?home directory}
D="$HOMEDIR/.ssh"
F="$D/authorized_keys"
PREFIX='restrict,command="/usr/lib/servrsit/bin/servrsit-gateway" '
fail() { printf 'remove-key: %s\n' "$1" >&2; exit 3; }
[ ! -L "$HOMEDIR" ] || fail "the home directory is a symlink; nothing was changed"
if [ ! -e "$F" ] && [ ! -L "$F" ]; then printf 'remove-key: no authorized_keys file; nothing to remove\n'; exit 0; fi
[ ! -L "$D" ] || fail "$D is a symlink; nothing was changed"
[ ! -L "$F" ] || fail "$F is a symlink; nothing was changed"
[ -f "$F" ] || fail "$F is not a regular file; nothing was changed"
TMP="$D/.authorized_keys.servrsit.$$"
grep -vF -- "$PREFIX" "$F" > "$TMP" || true
chmod 0600 "$TMP"
mv -f -- "$TMP" "$F"
if grep -qF -- "$PREFIX" "$F"; then fail "ServrSit's key line is still in $F"; fi
printf 'remove-key: verified: ServrSit'"'"'s key line is no longer in %s\n' "$F"
