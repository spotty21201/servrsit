#!/bin/sh
# T-088 step 4 on SENTANI ONLY: reboot.host.v1 with return verification.
# Submit once; poll every 5 s as spotty (read-only boot id) and as the helper (query, same id); 10-minute return window
# (Tech Spec 9.x); then the identical manifest again (must be `existing`, never a second reboot).
# Usage (from /projects/servrsit/apps/api, node 24 on PATH): sh t4.sh
set -eu
H="node_modules/.bin/tsx /projects/servrsit-tester/tests/live/t088/h.mts"
S=/tmp/t088/s4; mkdir -p "$S"; M="$S/reboot.json"
p() { python3 -c "import json,sys; r=json.load(sys.stdin); print(sys.argv[1], '->', json.dumps(r['reply']), '| ssh', r['sshExit'])" "$1"; }

L=$($H probe dpkglock 2>/dev/null); echo "$L"; echo "$L" | grep -q "locks=[1-9]" && { echo "STOP: dpkg lock held"; exit 3; }
$H probe base 2>/dev/null | tee "$S/base-before.txt"
B0=$(sed -n 's/^boot_id=//p' "$S/base-before.txt"); [ -n "$B0" ] || { echo "STOP: no boot id"; exit 3; }
$H probe services 2>/dev/null > "$S/services-before.txt"
$H probe bootlist 2>/dev/null > "$S/boots-before.txt"; tail -n 2 "$S/boots-before.txt"

$H manifest reboot "$M" "bootId=$B0" "plan=t088-reboot" 2>/dev/null
ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['operationId'])" "$M"); echo "$ID" > "$S/op-id"
date -u +"%H:%M:%S submit reboot op=$ID previousBootId=$B0"
$H submit "$M" 2>/dev/null | p "  submit"

T0=$(date +%s); DOWN=""; UP=""; B1=""
while :; do
  NOW=$(date +%s); [ $((NOW - T0)) -gt 600 ] && { echo "STOP: Sentani not back within 10 min; not intervening"; exit 4; }
  B=$($H probe base 2>/dev/null | sed -n 's/^boot_id=//p' || true)
  if [ -z "$B" ]; then
    [ -z "$DOWN" ] && DOWN=$(date -u +%H:%M:%S) && echo "  $DOWN SSH as spotty failing (down)"
  elif [ "$B" != "$B0" ]; then
    UP=$(date -u +%H:%M:%S); B1=$B; echo "  $UP SSH as spotty back, boot_id=$B1"; break
  else
    echo "  $(date -u +%H:%M:%S) still old boot id"
  fi
  sleep 5
done

i=0
while [ $i -lt 24 ]; do
  R=$($H query "$ID" 2>/dev/null || true)
  ST=$(echo "$R" | python3 -c "import json,sys;r=json.load(sys.stdin)['reply'] or {};print((r.get('record') or {}).get('state','none'),r.get('outcome'))" 2>/dev/null || echo "transport")
  echo "  $(date -u +%H:%M:%S) helper query: $ST"
  case "$ST" in finished*) break ;; esac
  i=$((i+1)); sleep 5
done
echo "$R" | p "  helper query after return"
$H submit "$M" 2>/dev/null | p "  identical reboot manifest again (must be existing, no second reboot)"
sleep 20
$H probe base 2>/dev/null | tee "$S/base-after.txt"
$H probe bootlist 2>/dev/null > "$S/boots-after.txt"; tail -n 3 "$S/boots-after.txt"
$H probe services 2>/dev/null > "$S/services-after.txt"
echo "DOWN=$DOWN UP=$UP B0=$B0 B1=$B1"
