#!/bin/sh
# T-088 apply on SENTANI ONLY: submit an apply.packages.v1 manifest, then poll query.operation.v1 on the SAME id every
# 5 s until the ledger says finished (bounded: 15 min, then stop and report; never resubmit with another id).
# Usage (from /projects/servrsit/apps/api, node 24 on PATH): sh apply.sh <label> <pkgs.json> [submit-mode]
set -eu
LABEL=$1; PKGS=$2; MODE=${3:-normal}
H="node_modules/.bin/tsx /projects/servrsit-tester/tests/live/t088/h.mts"
S=/tmp/t088/s2; mkdir -p "$S"; M="$S/$LABEL.json"
$H manifest apply "$M" "pkgs=$PKGS" "plan=t088-$LABEL" 2>/dev/null
ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['operationId'])" "$M")
p() { python3 -c "import json,sys; r=json.load(sys.stdin); print(sys.argv[1], '->', json.dumps(r['reply']), '| ssh', r['sshExit'], r['sshSignal'], '| ms', r['ms'])" "$1"; }
date -u +"%H:%M:%S submit $LABEL op=$ID mode=$MODE"
$H submit "$M" "$MODE" 2>/dev/null | p "  submit"
i=0
while [ $i -lt 180 ]; do
  sleep 5; i=$((i+1))
  Q=$($H query "$ID" 2>/dev/null)
  ST=$(echo "$Q" | python3 -c "import json,sys;r=json.load(sys.stdin)['reply'] or {};print((r.get('record') or {}).get('state','none') if r.get('found') else 'notfound')" 2>/dev/null || echo transport)
  if [ "$ST" = "finished" ]; then date -u +"%H:%M:%S"; echo "$Q" | p "  query (after $((i*5)) s)"; exit 0; fi
  [ $((i % 6)) -eq 0 ] && date -u +"%H:%M:%S  still $ST after $((i*5)) s"
done
echo "  STOP: not finished after 15 min; not intervening"; exit 3
