#!/bin/sh
# T-088 step 3a/3b on SENTANI ONLY: kill the LOCAL ssh client at a chosen moment, then retry by the rule
# "query the same operation id first; if not found, resubmit the IDENTICAL manifest; never a new id".
# Usage (from /projects/servrsit/apps/api, node 24 on PATH): sh interrupt.sh <label> <mode> <dir-name>
set -eu
LABEL=$1; MODE=$2; NAME=$3
H="node_modules/.bin/tsx /projects/servrsit-tester/tests/live/t088/h.mts"
S=/tmp/t088/s3; mkdir -p "$S"
REMOTE_HOME=/home/$(python3 -c "import json;print(json.load(open('config/test-bench.json'))['servers']['sentani']['homeUser'])")
M="$S/$LABEL.json"
$H manifest dirs "$M" "paths=$REMOTE_HOME/$NAME" "plan=t088-3-$LABEL" >/dev/null
ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['operationId'])" "$M")
p() { python3 -c "import json,sys; r=json.load(sys.stdin); print(sys.argv[1], '->', json.dumps(r['reply']), '| ssh', r['sshExit'], r['sshSignal'], '| killedAtMs', r['killedAtMs'], '| ms', r['ms'])" "$1"; }
echo "$LABEL op=$ID mode=$MODE"
$H submit "$M" "$MODE" | p "  send($MODE)"
sleep 3
Q=$($H query "$ID")
echo "$Q" | p "  retry: query first"
FOUND=$(echo "$Q" | python3 -c "import json,sys;print(json.load(sys.stdin)['reply'].get('found'))")
if [ "$FOUND" = "False" ]; then
  $H submit "$M" | p "  retry: not found -> resubmit identical manifest"
  sleep 3
  $H query "$ID" | p "  retry: query again"
else
  echo "  retry: found -> no resubmit"
fi
