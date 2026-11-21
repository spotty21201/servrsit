#!/bin/sh
# ServrSit target helper bootstrap (T-083, Technical Spec 7.2). REVIEW BEFORE RUNNING.
#
# The OWNER runs this as root, through their own trusted administration
# channel. ServrSit never runs it. It is the only way the helper gets onto a
# server, and uninstall.sh is the only way it comes off.
#
# What it does, in order (each step stops the script on failure):
#   1. checks it runs as root on Ubuntu 24.04 with python3 3.12, python3-apt
#      and python3-cryptography (it does not install them unless --install-deps)
#   2. checks the package's SHA-256 against the value you pass
#   3. installs /usr/lib/servrsit (root:root, read-only for others),
#      /etc/servrsit/{helper.json,trust.json} (root:root 0644) and
#      /var/lib/servrsit/ledger (root:root 0700)
#   4. only with --create-account: creates the system account --account
#   5. adds ONE line to that account's ~/.ssh/authorized_keys, forcing the
#      gateway: restrict,command="/usr/lib/servrsit/bin/servrsit-gateway" <key>.
#      This step runs AS the account (runuser), never as root inside its home.
#      With --from, the line also carries from="<address>", so the key works
#      only from ServrSit's own address (T-087).
#   6. writes the sudoers rule to a temporary file, checks it with
#      `visudo -c -f`, installs it 0440 as /etc/sudoers.d/servrsit, then checks
#      the whole sudoers configuration with `visudo -c` and removes the rule
#      again if that fails
# It never changes any other account, key, sudoers file, firewall or SSH
# setting, so your own access stays exactly as it was.
#
# Usage:
#   sh bootstrap.sh --package servrsit-helper-0.1.0.tar.gz --sha256 <hex> \
#     --installation-id <id> --trust trust.json --account servrsit \
#     --authorized-key "ssh-ed25519 AAAA... servrsit-maintenance" \
#     [--create-account] [--home-user <user>] [--restart-unit nginx.service]... \
#     [--from 100.104.220.8] \
#     [--install-deps] [--dry-run]
#
# --dry-run prints every step and changes nothing. SERVRSIT_ROOT (default /)
# is a prefix for tests only.

set -eu
umask 022

PACKAGE=""; SHA256=""; INSTALLATION_ID=""; TRUST=""; ACCOUNT=""; KEY=""
CREATE_ACCOUNT=0; HOME_USER=""; UNITS=""; INSTALL_DEPS=0; DRY_RUN=0; FROM=""
ROOT="${SERVRSIT_ROOT:-/}"

die() { printf 'bootstrap: %s\n' "$1" >&2; exit 1; }
step() { printf 'bootstrap: %s\n' "$1"; }
run() { if [ "$DRY_RUN" -eq 1 ]; then printf 'bootstrap: would run:'; printf ' %s' "$@"; printf '\n'; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --package) PACKAGE=$2; shift 2 ;;
    --sha256) SHA256=$2; shift 2 ;;
    --installation-id) INSTALLATION_ID=$2; shift 2 ;;
    --trust) TRUST=$2; shift 2 ;;
    --account) ACCOUNT=$2; shift 2 ;;
    --authorized-key) KEY=$2; shift 2 ;;
    --create-account) CREATE_ACCOUNT=1; shift ;;
    --home-user) HOME_USER=$2; shift 2 ;;
    --restart-unit) UNITS="$UNITS $2"; shift 2 ;;
    --install-deps) INSTALL_DEPS=1; shift ;;
    --from) FROM=$2; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) die "unknown option (see the usage at the top of this file)" ;;
  esac
done

# --- inputs ---------------------------------------------------------------
# One line each: grep checks lines, so a value with a newline could hide a second line.
for v in "$SHA256" "$INSTALLATION_ID" "$ACCOUNT" "$KEY" "$HOME_USER" "$FROM" $UNITS; do
  [ "$(printf '%s' "$v" | wc -l)" -eq 0 ] || die "an option value contains a line break"
done
[ -n "$PACKAGE" ] && [ -f "$PACKAGE" ] || die "--package must name the helper package file"
printf '%s' "$SHA256" | grep -Eq '^[0-9a-f]{64}$' || die "--sha256 must be 64 lowercase hex characters"
printf '%s' "$INSTALLATION_ID" | grep -Eq '^[A-Za-z0-9._:-]{1,128}$' || die "--installation-id is not valid"
[ -n "$TRUST" ] && [ -f "$TRUST" ] || die "--trust must name the trust file (public keys only)"
printf '%s' "$ACCOUNT" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$' || die "--account is not a valid account name"
[ "$ACCOUNT" != "root" ] || die "--account may not be root"
printf '%s' "$KEY" | grep -Eq '^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [A-Za-z0-9._@-]{1,64})?$' || die "--authorized-key must be one ssh-ed25519 public key line"
[ -z "$HOME_USER" ] || printf '%s' "$HOME_USER" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$' || die "--home-user is not valid"
# T-087: the key works only from ServrSit's own address (an IPv4 address, CIDR or plain host name; no wildcards, no lists).
[ -z "$FROM" ] || printf '%s' "$FROM" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$|^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$' || die "--from must be one IPv4 address, CIDR or host name"
for u in $UNITS; do printf '%s' "$u" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9@_.:-]{0,95}\.service$' || die "--restart-unit must be a plain .service unit"; done

# --- 1. platform ------------------------------------------------------------
if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then die "run as root through your own administration channel"; fi
grep -q '^VERSION_ID="24.04"$' "${ROOT%/}/etc/os-release" 2>/dev/null || die "only Ubuntu 24.04 is supported"
if ! python3 -c 'import sys, apt, cryptography; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)' 2>/dev/null; then
  if [ "$INSTALL_DEPS" -eq 1 ]; then
    step "installing python3-apt and python3-cryptography from Ubuntu's archive"
    run apt-get install -y --no-install-recommends python3-apt python3-cryptography
  else
    die "needs python3 3.12, python3-apt and python3-cryptography (apt-get install python3-apt python3-cryptography, or pass --install-deps)"
  fi
fi

# --- 2. checksum --------------------------------------------------------------
step "checking the package checksum"
ACTUAL=$(sha256sum -- "$PACKAGE" | cut -d' ' -f1)
[ "$ACTUAL" = "$SHA256" ] || die "the package checksum does not match; nothing was installed"

# --- 3. files -----------------------------------------------------------------
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
tar -xzf "$PACKAGE" -C "$WORK" --no-same-owner --no-same-permissions
[ -f "$WORK/servrsit-helper/VERSION" ] || die "the package is not a ServrSit helper package"
# T-084 (D-H4): everything below comes from the verified package, not from beside this script.
PKG="$WORK/servrsit-helper/packaging"
for f in sudoers.in account-add-key.sh; do [ -f "$PKG/$f" ] && [ ! -L "$PKG/$f" ] || die "the package has no $f; nothing was installed"; done
LIB="${ROOT%/}/usr/lib/servrsit"; ETC="${ROOT%/}/etc/servrsit"; VAR="${ROOT%/}/var/lib/servrsit"
NEW_VERSION=$(cat "$WORK/servrsit-helper/VERSION")
# T-090: installing over an existing helper (an upgrade) is supported. It
# replaces the code and configuration, keeps the ledger and the account, and
# is refused while an operation is unfinished (it must not change the code
# under a running job).
if [ -f "$LIB/VERSION" ]; then
  step "upgrading the helper from $(cat "$LIB/VERSION") to $NEW_VERSION (the ledger is kept)"
  if [ -d "$VAR/ledger" ]; then
    for f in "$VAR"/ledger/*.json; do
      [ -f "$f" ] || continue
      grep -q '"state": "finished"' "$f" || die "operation $(basename "$f" .json) is not finished; wait for it before upgrading. Nothing was changed."
    done
  fi
  run rm -rf -- "$LIB/servrsit_helper" "$LIB/bin"
else
  step "installing helper $NEW_VERSION"
fi
step "installing the helper into $LIB"
run install -d -m 0755 -o root -g root "$LIB" "$LIB/bin" "$LIB/servrsit_helper"
for f in "$WORK"/servrsit-helper/servrsit_helper/*.py; do run install -m 0644 -o root -g root "$f" "$LIB/servrsit_helper/"; done
for f in "$WORK"/servrsit-helper/bin/*; do run install -m 0755 -o root -g root "$f" "$LIB/bin/"; done
run install -m 0644 -o root -g root "$WORK/servrsit-helper/VERSION" "$LIB/VERSION"
step "writing the configuration and trust files into $ETC"
run install -d -m 0755 -o root -g root "$ETC"
UNITS_JSON=$(for u in $UNITS; do printf '"%s",' "$u"; done | sed 's/,$//')
HOME_JSON=$( [ -n "$HOME_USER" ] && printf '"%s"' "$HOME_USER" || printf 'null' )
printf '{"installationId":"%s","homeUser":%s,"restartableUnits":[%s],"clockSkewToleranceSeconds":120}\n' "$INSTALLATION_ID" "$HOME_JSON" "$UNITS_JSON" > "$WORK/helper.json"
if [ "$DRY_RUN" -eq 1 ]; then step "helper.json will be: $(cat "$WORK/helper.json")"; fi
run install -m 0644 -o root -g root "$WORK/helper.json" "$ETC/helper.json"
run install -m 0644 -o root -g root "$TRUST" "$ETC/trust.json"
step "creating the ledger directory $VAR/ledger"
run install -d -m 0700 -o root -g root "$VAR" "$VAR/ledger"

# --- 4. account (only when asked) ---------------------------------------------
if [ "$CREATE_ACCOUNT" -eq 1 ] && ! id -u "$ACCOUNT" >/dev/null 2>&1; then
  step "creating the system account $ACCOUNT"
  run useradd --system --create-home --shell /bin/sh -- "$ACCOUNT"
fi
if [ "$DRY_RUN" -eq 0 ]; then id -u "$ACCOUNT" >/dev/null 2>&1 || die "the account $ACCOUNT does not exist (pass --create-account to create it)"; fi

# --- 5. the forced-command key ------------------------------------------------
# T-084 (D-H3): root never writes inside the account's home. The key line is
# added by account-add-key.sh running AS the account (runuser), which refuses
# symlinks and anything the account does not own.
if [ -n "$FROM" ]; then OPTIONS="restrict,from=\"$FROM\",command=\"/usr/lib/servrsit/bin/servrsit-gateway\""; else OPTIONS="restrict,command=\"/usr/lib/servrsit/bin/servrsit-gateway\""; fi
LINE="$OPTIONS $KEY"
if [ "$DRY_RUN" -eq 1 ]; then
  step "would run as $ACCOUNT: account-add-key.sh <home> with the line: $LINE"
else
  HOMEDIR=$(getent passwd "$ACCOUNT" | cut -d: -f6)
  [ -n "$HOMEDIR" ] && [ -d "$HOMEDIR" ] && [ ! -L "$HOMEDIR" ] || die "the account has no plain home directory"
  [ ! -L "$HOMEDIR/.ssh" ] || die "$HOMEDIR/.ssh is a symlink; nothing was changed"
  runuser -u "$ACCOUNT" -- /bin/sh -s -- "$HOMEDIR" "$LINE" < "$PKG/account-add-key.sh" || die "the key line could not be added as $ACCOUNT"
fi

# --- 6. sudoers, validated before and after -----------------------------------
SUDOERS="${ROOT%/}/etc/sudoers.d/servrsit"
sed "s/@ACCOUNT@/$ACCOUNT/g" "$PKG/sudoers.in" > "$WORK/sudoers"
if [ "$DRY_RUN" -eq 1 ]; then step "the sudoers rule from the package: $(grep -v '^#' "$WORK/sudoers" | tail -n 1)"; fi
step "checking the sudoers rule with visudo -c -f"
visudo -c -f "$WORK/sudoers" >/dev/null || die "the sudoers rule did not validate; nothing was installed"
run install -m 0440 -o root -g root "$WORK/sudoers" "$SUDOERS"
if [ "$DRY_RUN" -eq 0 ]; then
  if ! visudo -c >/dev/null; then rm -f -- "$SUDOERS"; die "the sudoers configuration did not validate with the rule; the rule was removed again"; fi
fi

step "done. Your own access was not changed. Remove everything with uninstall.sh."
