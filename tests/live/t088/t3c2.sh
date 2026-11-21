#!/bin/sh
# T-088 step 3c REDO on SENTANI ONLY: client kills must land inside dpkg's unpack/configure window.
# One submit. From acceptance until the ledger says finished, a background loop fires every second a query whose LOCAL
# ssh client is SIGKILLed at 400..700 ms (mid-request); every 4th tick also an IDENTICAL resubmit, killed the same way.
# Never a new id. Afterwards: the correct retry (query first, then the identical manifest), and the kill times are
# compared with dpkg.log by the report step. Bounded: 15 min.
# Usage (from /projects/servrsit/apps/api, node 24 on PATH): sh t3c2.sh
set -eu
H="node_modules/.bin/tsx /projects/servrsit-tester/tests/live/t088/h.mts"
S=/tmp/t088/s3c2; mkdir -p "$S"; M="$S/3c2.json"; STOP="$S/stop"; rm -f "$STOP"
p() { python3 -c "import json,sys; r=json.load(sys.stdin); print(sys.argv[1], '->', json.dumps(r['reply']), '| ssh', r['sshExit'], r['sshSignal'], '| killedAtMs', r['killedAtMs'])" "$1"; }

L=$($H probe dpkglock 2>/dev/null); echo "$L"
echo "$L" | grep -q "locks=[1-9]" && { echo "STOP: dpkg lock held"; exit 3; }
echo "$L" | grep -qx "holds=" || { echo "STOP: a package is held"; exit 3; }
$H probe aptsim 2>/dev/null > "$S/aptsim.txt"; grep -E "^Inst|upgraded" "$S/aptsim.txt"
python3 - "$S/aptsim.txt" "$S/pkgs.json" <<'EOF'
import re, json, sys
rows = []
for l in open(sys.argv[1]):
    m = re.match(r'^Inst (\S+) \[([^\]]+)\] \((\S+) (.+?) \[([^\]]+)\]\)', l)
    if m:
        assert 'Ubuntu:24.04/' in m.group(4) and m.group(5) == 'amd64', l
        rows.append({"name": m.group(1), "arch": m.group(5), "from": m.group(2), "to": m.group(3)})
assert sorted(r["name"] for r in rows) == ["libclang-cpp18", "libclang1-18", "libllvm18"], rows
assert all(r["from"] == "1:18.1.3-1" and r["to"] == "1:18.1.3-1ubuntu1" for r in rows), rows
json.dump(rows, open(sys.argv[2], "w"), indent=1)
EOF
$H probe services 2>/dev/null > "$S/services-before.txt"
$H manifest apply "$M" "pkgs=$S/pkgs.json" "plan=t088-3c-redo" 2>/dev/null
ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['operationId'])" "$M")
echo "$ID" > "$S/op-id"
date -u +"%H:%M:%S.%N submit op=$ID"
$H submit "$M" 2>/dev/null | p "  submit"

( n=0
  while [ ! -e "$STOP" ]; do
    n=$((n+1)); k=$((400 + (n * 97) % 301))
    $H query "$ID" "killafter:$k" >/dev/null 2>&1 &
    [ $((n % 4)) -eq 0 ] && $H submit "$M" "killafter:$k" >/dev/null 2>&1 &
    sleep 1
  done; wait ) &
FIRE=$!

i=0; ST=none
while [ $i -lt 300 ]; do
  ST=$($H query "$ID" 2>/dev/null | python3 -c "import json,sys;r=json.load(sys.stdin)['reply'] or {};print((r.get('record') or {}).get('state','none'))" 2>/dev/null || echo transport)
  [ "$ST" = "finished" ] && break
  i=$((i+1)); sleep 3
done
touch "$STOP"; wait "$FIRE" 2>/dev/null || true
date -u +"%H:%M:%S firing stopped; state=$ST"
$H query "$ID" 2>/dev/null | p "  retry rule: query same id first"
$H submit "$M" 2>/dev/null | p "  then identical resubmit"
