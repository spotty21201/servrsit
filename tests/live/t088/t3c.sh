#!/bin/sh
# T-088 step 3c on SENTANI ONLY: kill the LOCAL ssh client while dpkg runs a helper transaction.
# One submit. While dpkg runs: (a) a query killed before its reply, (b) a query with stdin held open, killed,
# (c) an identical resubmit killed at 400 ms (a misbehaving retry). Then the correct retry: query the same id first,
# then resubmit the IDENTICAL manifest (must be `existing`). Never a new id. Poll until finished (bounded 15 min).
# Usage (from /projects/servrsit/apps/api, node 24 on PATH): sh t3c.sh <pkgs.json>
set -eu
PKGS=$1
H="node_modules/.bin/tsx /projects/servrsit-tester/tests/live/t088/h.mts"
S=/tmp/t088/s3c; mkdir -p "$S"; M="$S/3c.json"
p() { python3 -c "import json,sys; r=json.load(sys.stdin); print(sys.argv[1], '->', json.dumps(r['reply']), '| ssh', r['sshExit'], r['sshSignal'], '| killedAtMs', r['killedAtMs'], '| ms', r['ms'])" "$1"; }

i=0; while [ $i -lt 40 ]; do L=$($H probe dpkglock 2>/dev/null); echo "$L" | grep -q "locks=[1-9]" || break; i=$((i+1)); sleep 15; done
echo "$L" | grep -q "locks=[1-9]" && { echo "STOP: dpkg lock still held after 10 min"; exit 3; }
date -u +"%H:%M:%S lock free:"; echo "$L"
$H probe aptsim 2>/dev/null | grep -E "^Inst|upgraded"
$H probe services 2>/dev/null > "$S/services-before.txt"

$H manifest apply "$M" "pkgs=$PKGS" "plan=t088-3c" 2>/dev/null
ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['operationId'])" "$M")
date -u +"%H:%M:%S submit op=$ID"
$H submit "$M" 2>/dev/null | p "  submit"

i=0; DP=""
while [ $i -lt 90 ]; do
  DP=$($H probe procs 2>/dev/null | grep -E " (dpkg|dpkg-deb) " || true)
  [ -n "$DP" ] && break
  i=$((i+1)); sleep 1
done
[ -z "$DP" ] && { echo "dpkg never seen running within ~3 min; the kills below are NOT mid-dpkg"; }
date -u +"%H:%M:%S dpkg running on Sentani:"; echo "$DP" | cut -c1-200

$H query "$ID" killafter:300 2>/dev/null | p "  (a) query, client killed before reply"
$H query "$ID" hold:1500 2>/dev/null | p "  (b) query, stdin held, client killed"
$H submit "$M" killafter:400 2>/dev/null | p "  (c) identical resubmit, client killed at 400 ms"
date -u +"%H:%M:%S still mid-dpkg?"; $H probe procs 2>/dev/null | grep -E " (dpkg|dpkg-deb) " | cut -c1-160 || echo "  (dpkg no longer running)"
$H query "$ID" 2>/dev/null | p "  (d) retry rule: query same id first"
$H submit "$M" 2>/dev/null | p "  (e) then identical resubmit"

i=0
while [ $i -lt 180 ]; do
  ST=$($H query "$ID" 2>/dev/null | python3 -c "import json,sys;r=json.load(sys.stdin)['reply'] or {};print((r.get('record') or {}).get('state','none'))" 2>/dev/null || echo transport)
  [ "$ST" = "finished" ] && break
  i=$((i+1)); sleep 5
done
date -u +"%H:%M:%S"; $H query "$ID" 2>/dev/null | p "  final query"
echo "$ID" > "$S/op-id"
