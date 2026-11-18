#!/bin/sh
# Runs AS THE SERVRSIT ACCOUNT, never as root (T-084, D-H3). bootstrap.sh
# starts it with `runuser -u <account> --`. It adds ServrSit's one
# forced-command key line (the second argument) to the account's
# authorized_keys, once. Because it runs as the account, a symlink the
# account planted can only lead to files the account could change anyway;
# it is still refused, so nothing is followed at all.
#
# Usage: sh account-add-key.sh <home-directory> "<key line>"
# (bootstrap feeds this script on stdin to `sh -s`, so the account never needs
# to read a file from root's temporary directory)
set -eu
umask 077
HOMEDIR=${1:?home directory}
D="$HOMEDIR/.ssh"
F="$D/authorized_keys"
fail() { printf 'add-key: %s\n' "$1" >&2; exit 3; }
[ ! -L "$HOMEDIR" ] || fail "the home directory is a symlink; nothing was changed"
[ "$(stat -c %u "$HOMEDIR")" = "$(id -u)" ] || fail "the home directory is not owned by this account; nothing was changed"
if [ -e "$D" ] || [ -L "$D" ]; then
  [ ! -L "$D" ] || fail "$D is a symlink; nothing was changed"
  [ -d "$D" ] || fail "$D is not a directory; nothing was changed"
  [ "$(stat -c %u "$D")" = "$(id -u)" ] || fail "$D is not owned by this account; nothing was changed"
else
  mkdir -m 0700 "$D"
fi
chmod 0700 "$D"
if [ -e "$F" ] || [ -L "$F" ]; then
  [ ! -L "$F" ] || fail "$F is a symlink; nothing was changed"
  [ -f "$F" ] || fail "$F is not a regular file; nothing was changed"
fi
LINE=${2:-}
[ -n "$LINE" ] || fail "no key line was given"
[ "$(printf '%s' "$LINE" | wc -l)" -eq 0 ] || fail "the key line contains a line break"
touch "$F"
chmod 0600 "$F"
grep -qxF -- "$LINE" "$F" || printf '%s\n' "$LINE" >> "$F"
grep -qxF -- "$LINE" "$F" || fail "the key line was not written"
printf 'add-key: the key line is in %s\n' "$F"
