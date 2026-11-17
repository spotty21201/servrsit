#!/usr/bin/env bash
# Adds ServrSit's dedicated public key to a server's authorized_keys.
# Run on Merauke:  bash scripts/install-servrsit-key.sh sentani
# You will be asked for your normal login (password or your usual key) on that server.
set -euo pipefail
host="${1:?usage: install-servrsit-key.sh <sentani|timika>}"
case "$host" in sentani|timika) ;; *) echo "Only sentani or timika."; exit 1 ;; esac
pub="$HOME/.ssh/servrsit/id_ed25519_${host}.pub"
[ -f "$pub" ] || { echo "Missing $pub"; exit 1; }
line="restrict,from=\"100.104.220.8\" $(cat "$pub")"
echo "Adding ServrSit key to spotty@${host} ..."
printf '%s\n' "$line" | ssh "spotty@${host}" '
  set -e
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
  read -r line
  key=$(printf "%s" "$line" | awk "{print \$3}")
  if grep -qF "$key" ~/.ssh/authorized_keys; then echo "Already installed."; else printf "%s\n" "$line" >> ~/.ssh/authorized_keys; echo "Installed."; fi
'
echo "Done for ${host}. Tell Kiro Orchestrator."
