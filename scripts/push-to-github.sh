#!/usr/bin/env bash
# Push the ServrSit repository to a PRIVATE GitHub repository using the dedicated deploy key.
# Usage (on Merauke):  bash scripts/push-to-github.sh git@github.com:<owner>/<repo>.git
# Before: create the private repo on github.com (no README), and add
#   ~/.ssh/servrsit/github_deploy_servrsit.pub as a Deploy key with "Allow write access".
set -euo pipefail
URL="${1:?usage: push-to-github.sh git@github.com:<owner>/<repo>.git}"
case "$URL" in git@github.com:*/*.git) ;; *) echo "Use the SSH form: git@github.com:<owner>/<repo>.git"; exit 1 ;; esac
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
KEY="$HOME/.ssh/servrsit/github_deploy_servrsit"
KH="$HOME/.ssh/servrsit/github_known_hosts"
[ -f "$KEY" ] || { echo "Missing deploy key $KEY"; exit 1; }
# Pin github.com's ED25519 host key, checked against the fingerprint GitHub publishes.
WANT=$(curl -s -m 15 https://api.github.com/meta | python3 -c 'import json,sys; print(json.load(sys.stdin)["ssh_key_fingerprints"]["SHA256_ED25519"])')
LINE=$(ssh-keyscan -t ed25519 github.com 2>/dev/null)
GOT=$(printf '%s\n' "$LINE" | ssh-keygen -lf - | awk '{print $2}')
[ "$GOT" = "SHA256:$WANT" ] || { echo "STOP: github.com host key does not match GitHub's published fingerprint."; exit 1; }
printf '%s\n' "$LINE" > "$KH"; chmod 600 "$KH"
export GIT_SSH_COMMAND="ssh -F /dev/null -o IdentitiesOnly=yes -i $KEY -o UserKnownHostsFile=$KH -o StrictHostKeyChecking=yes"
cd "$REPO"
# Refuse to push if a real secret is tracked.
if git ls-files | grep -E -i '(^|/)\.env$|\.pem$|/id_ed25519$|known_hosts$|\.db$' >/dev/null; then echo "STOP: a sensitive file is tracked."; exit 1; fi
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$URL" || git remote add origin "$URL"
git push -u origin main
git push origin --all
git push origin --tags
echo "Pushed. Default branch: main (= the running app, integration/live-v1)."
