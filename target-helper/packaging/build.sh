#!/bin/sh
# Build the versioned helper package and its SHA-256 (T-083). Deterministic:
# fixed file order, mtime, owner and mode, so the same source gives the same
# checksum. Usage: sh packaging/build.sh <output-dir>
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=${1:?output directory}
VERSION=$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import servrsit_helper; print(servrsit_helper.HELPER_VERSION)' "$HERE")
STAGE=$(mktemp -d)
trap 'rm -rf -- "$STAGE"' EXIT
mkdir -p "$STAGE/servrsit-helper/servrsit_helper" "$STAGE/servrsit-helper/bin" "$OUT"
cp "$HERE"/servrsit_helper/*.py "$STAGE/servrsit-helper/servrsit_helper/"
cp "$HERE"/bin/servrsit-* "$STAGE/servrsit-helper/bin/"
printf '%s\n' "$VERSION" > "$STAGE/servrsit-helper/VERSION"
NAME="servrsit-helper-$VERSION.tar.gz"
tar --sort=name --mtime='2026-01-01 00:00Z' --owner=0 --group=0 --numeric-owner --mode='go-w' \
  -C "$STAGE" -cf - servrsit-helper | gzip -n > "$OUT/$NAME"
( cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256" )
printf '%s\n' "$OUT/$NAME"
