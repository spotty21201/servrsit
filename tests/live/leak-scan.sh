#!/usr/bin/env bash
# Scan files for credential/path leakage. Exit 0 = clean, 1 = leak found.
# Usage: leak-scan.sh FILE...
# Patterns come from the task brief plus the configured key path and common
# private-key markers. Prints only the pattern name and file, never the match
# context, so a real leak is not copied into the report.
set -u
status=0
patterns=(
  'PRIVATE KEY'
  'id_ed25519'
  '/\.ssh/'
  '\.ssh'
  'BEGIN OPENSSH'
  'identityFile'
  'SESSION_SECRET'
  'dev-only-insecure-secret'
  'AKIA[0-9A-Z]{16}'
  '/home/spotty'
)
for f in "$@"; do
  for p in "${patterns[@]}"; do
    n=$(grep -cE -- "$p" "$f" 2>/dev/null || true)
    if [ "${n:-0}" != "0" ]; then
      echo "LEAK-PATTERN [$p] matched $n line(s) in $f"
      status=1
    fi
  done
done
[ $status -eq 0 ] && echo "CLEAN: no pattern matched in: $*"
exit $status
