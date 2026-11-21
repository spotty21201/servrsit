#!/usr/bin/env bash
# Copy the ServrSit target helper to Sentani for the founder to install (T-087, ADR-021).
#
# Run on Merauke, as yourself, from the repository:
#     bash scripts/sentani-helper-install.sh
#
# What it does:
#   1. builds the helper package and its SHA-256 (target-helper/dist, gitignored)
#   2. makes, once, ServrSit's manifest signing key and Sentani's maintenance
#      SSH key in apps/api/.data/helper (0600, gitignored). It prints only
#      public keys; the private keys never leave Merauke.
#   3. shows every file it will copy, and asks you to confirm
#   4. copies them with scp to spotty@sentani:servrsit-helper-<version>/
#      (your own login; you may be asked for it)
#   5. PRINTS (does not run) the commands to run on Sentani: a --dry-run
#      first, then the real install. Nothing is installed until you run them.
#
# It never runs anything on Sentani itself, never uses sudo, and changes no
# ServrSit setting (writes stay disabled).
#
# Options: --yes (skip the question)  --no-copy (show and print only; no scp)
set -euo pipefail

SERVER=sentani
YES=0; COPY=1
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    --no-copy) COPY=0 ;;
    *) echo "unknown option: $a (use --yes or --no-copy)"; exit 2 ;;
  esac
done
[ "$(id -u)" -ne 0 ] || { echo "Run this as yourself, not as root."; exit 1; }

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
API="$REPO/apps/api"
TSX="$API/node_modules/.bin/tsx"
NODE_DIR="${SERVRSIT_NODE_DIR:-$HOME/.local/node24/bin}"
export PATH="$NODE_DIR:$PATH"
[ -x "$TSX" ] || { echo "Missing $TSX: run pnpm install in $REPO first."; exit 1; }
command -v python3 >/dev/null || { echo "python3 is needed."; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm is needed (it is in $NODE_DIR)."; exit 1; }

VERSION=$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import servrsit_helper; print(servrsit_helper.HELPER_VERSION)' "$REPO/target-helper")
NAME="servrsit-helper-$VERSION"
DIST="$REPO/target-helper/dist"
STAGE="$DIST/$SERVER/$NAME"

echo "== 1. Building the helper package $NAME"
rm -rf -- "$DIST/$SERVER"
mkdir -p "$STAGE"
sh "$REPO/target-helper/packaging/build.sh" "$STAGE" >/dev/null
SHA=$(cut -d' ' -f1 < "$STAGE/$NAME.tar.gz.sha256")
for f in bootstrap.sh uninstall.sh account-remove-key.sh; do cp "$REPO/target-helper/packaging/$f" "$STAGE/"; done
cp "$REPO/target-helper/README.md" "$STAGE/README.md"

( cd "$REPO" && pnpm --filter "@servrsit/api^..." run build >/dev/null ) || { echo "Could not build the workspace packages (pnpm). Nothing was copied."; exit 1; }

echo "== 2. Keys (made once; only public keys are shown)"
FACTS=$(cd "$API" && "$TSX" src/helper-bench/prepare.ts "$SERVER" "$STAGE")
fact() { python3 -c 'import json, sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$FACTS" "$1"; }
INSTALLATION_ID=$(fact installationId)
KEY_ID=$(fact keyId)
PUBLIC_LINE=$(fact maintenancePublicLine)
TARGET=$(fact founderSshTarget)
ACCOUNT=$(fact account)
HOME_USER=$(fact homeUser)
FROM=$(fact from)
[ "$(fact signingKeyCreated)" = "True" ] && echo "   made the manifest signing key (first run)" || echo "   using the existing manifest signing key"
[ "$(fact maintenanceKeyCreated)" = "True" ] && echo "   made the maintenance key for $SERVER (first run)" || echo "   using the existing maintenance key for $SERVER"
echo "   signing key id:       $KEY_ID"
echo "   installation id:      $INSTALLATION_ID"
echo "   maintenance key line: $PUBLIC_LINE"
if grep -q "PRIVATE KEY" "$STAGE"/* 2>/dev/null; then echo "STOP: a private key ended up in the copy folder. Nothing was copied."; exit 1; fi

echo
echo "== 3. Files that will be copied to $TARGET:$NAME/"
( cd "$STAGE" && for f in *; do printf '   %-40s %8s bytes  sha256 %s\n' "$f" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -c1-16)…"; done )
echo "   trust.json holds ONLY the public key $KEY_ID."
echo "   The package checksum is $SHA"

CMD_EARLY="sh bootstrap.sh --package $NAME.tar.gz --sha256 $SHA --installation-id $INSTALLATION_ID --trust trust.json --account $ACCOUNT --create-account --home-user $HOME_USER --install-deps --from $FROM --authorized-key \"$PUBLIC_LINE\""
# Short wrappers so the founder never has to paste a long line (pastes split in the founder's terminal).
printf '#!/bin/sh\n# ServrSit helper: DRY RUN (changes nothing). Run: sudo sh dry-run.sh\nset -eu\ncd "$(dirname "$0")"\n%s --dry-run\n' "$CMD_EARLY" > "$STAGE/dry-run.sh"
printf '#!/bin/sh\n# ServrSit helper: REAL INSTALL. Run: sudo sh install.sh\nset -eu\ncd "$(dirname "$0")"\n%s\n' "$CMD_EARLY" > "$STAGE/install.sh"

if [ "$COPY" -eq 1 ]; then
  if [ "$YES" -ne 1 ]; then
    printf '\nCopy these files to %s now? [y/N] ' "$TARGET"
    read -r answer
    [ "$answer" = "y" ] || [ "$answer" = "Y" ] || { echo "Nothing was copied."; exit 0; }
  fi
  echo
  echo "== 4. Copying with scp (your own login to $SERVER)"
  scp -r -- "$STAGE" "$TARGET:"
  echo "   copied to $TARGET:$NAME/"
else
  echo
  echo "== 4. --no-copy: nothing was copied"
fi

CMD="sh bootstrap.sh --package $NAME.tar.gz --sha256 $SHA --installation-id $INSTALLATION_ID --trust trust.json --account $ACCOUNT --create-account --home-user $HOME_USER --install-deps --from $FROM --authorized-key \"$PUBLIC_LINE\""
echo
echo "== 5. On $SERVER, run these yourself (log in as $TARGET; nothing has been installed yet)"
echo
echo "   Short version (recommended):  cd ~/$NAME   then   sudo sh dry-run.sh   then   sudo sh install.sh"
echo
echo "   First, the dry run (prints every step, changes nothing):"
echo
echo "     cd ~/$NAME && sudo $CMD --dry-run"
echo
echo "   Then, if the dry run looks right, the real install:"
echo
echo "     cd ~/$NAME && sudo $CMD"
echo
echo "   To remove it later (keeps the ledger):"
echo
echo "     cd ~/$NAME && sudo sh uninstall.sh --account $ACCOUNT"
echo
echo "Tell Kiro Orchestrator when the install has finished. ServrSit writes stay disabled until the Tester's gates pass (T-088)."
