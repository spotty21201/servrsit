#!/bin/sh
# T-088 helper 0.2.0 re-run on SENTANI ONLY. Phases are detected read-only (apt-mark showhold, /proc/locks).
#   (d1) while vim-common is held:   submit the vim set        -> expect rejected PACKAGE_HELD naming vim-common
#   (d2) while the dpkg lock is held: submit the vim set        -> expect accepted, then failed, reasonCode PACKAGE_LOCKED
#   (a)  no hold, no lock:            submit the vim set (all)  -> expect succeeded, 5 of 5, dpkg verified
#   (b)                               submit libaio1t64         -> expect succeeded; multipathd PID/start unchanged; restartNeeded lists it
#   (c)  /etc/wgetrc owner-edited:    submit wget               -> CURRENT behaviour: rejected CONFFILE_MODIFIED; file and version unchanged
# Every manifest's from/to/arch come from a fresh `apt-get -s upgrade` (Inst lines), labelled exactly as apt prints them.
# Usage (from /projects/servrsit/apps/api, node 24 on PATH): sh t090.sh
set -eu
H="node_modules/.bin/tsx /projects/servrsit-tester/tests/live/t088/h.mts"
A=/projects/servrsit-tester/tests/live/t088/apply.sh
S=/tmp/t088/s090; mkdir -p "$S"
p() { python3 -c "import json,sys; r=json.load(sys.stdin); print(sys.argv[1], '->', json.dumps(r['reply']), '| ssh', r['sshExit'])" "$1"; }

scope() {  # $1 = out file, $2.. = package names; from a fresh apt-get -s upgrade, arch exactly as apt prints it
  OUT=$1; shift
  $H probe aptsim 2>/dev/null > "$S/aptsim-$(date +%s).txt"
  python3 - "$OUT" "$(ls -t "$S"/aptsim-*.txt | head -n 1)" "$@" <<'EOF'
import re, json, sys
out, sim, names = sys.argv[1], sys.argv[2], sys.argv[3:]
rows = []
for l in open(sim):
    m = re.match(r'^Inst (\S+) \[([^\]]+)\] \((\S+) (.+?) \[([^\]]+)\]\)', l)
    if m and m.group(1) in names:
        assert 'Ubuntu:24.04/' in m.group(4), l
        rows.append({"name": m.group(1), "arch": m.group(5), "from": m.group(2), "to": m.group(3)})
assert sorted(r["name"] for r in rows) == sorted(names), (rows, names)
json.dump(rows, open(out, "w"), indent=1)
print("  scope:", ", ".join("%s:%s %s->%s" % (r["name"], r["arch"], r["from"], r["to"]) for r in rows))
EOF
}
VIM="vim vim-common vim-runtime vim-tiny xxd"
wait_for() {  # $1 = description, $2 = shell test on $L (dpkglock probe output); bounded 15 min
  i=0; while [ $i -lt 60 ]; do L=$($H probe dpkglock 2>/dev/null); if eval "$2"; then date -u +"%H:%M:%S $1:"; echo "$L"; return 0; fi; i=$((i+1)); sleep 15; done
  echo "STOP: $1 not seen within 15 min"; exit 3
}

$H probe pre090 2>/dev/null | tee "$S/pre.txt"

# (d1) held
# While vim-common is held, apt keeps back vim-common and the packages that depend on it, so the scope is the PLANNED set
# (observed before the hold), not apt's current offer. This is what a controller would send for an approved plan.
scope "$S/vim.json" $VIM
wait_for "hold on vim-common seen" 'echo "$L" | grep -q "^holds=.*vim-common"'
$H manifest apply "$S/d1.json" "pkgs=$S/vim.json" "plan=t090-d1" 2>/dev/null
$H submit "$S/d1.json" 2>/dev/null | p "  (d1) submit while held"

# (d2) lock
wait_for "dpkg lock held, no hold" 'echo "$L" | grep -q "lock-frontend .* locks=[1-9]" && echo "$L" | grep -qx "holds="'
sh "$A" t090-d2 "$S/vim.json"

# (a) Architecture: all, labelled as apt prints them
wait_for "lock free, no hold" '! echo "$L" | grep -q "locks=[1-9]" && echo "$L" | grep -qx "holds="'
$H probe services 2>/dev/null > "$S/services-before-a.txt"
scope "$S/vim.json" $VIM
sh "$A" t090-a "$S/vim.json"
$H probe dpkg 2>/dev/null > "$S/dpkg-after-a.txt"; grep -E "^(vim|vim-common|vim-runtime|vim-tiny|xxd) " "$S/dpkg-after-a.txt"

# (b) needrestart: library used by a running service
$H probe pre090 2>/dev/null | tail -n 1 | tee "$S/multipathd-before.txt"
scope "$S/aio.json" libaio1t64
sh "$A" t090-b "$S/aio.json"
$H probe pre090 2>/dev/null | tee "$S/post-b.txt"
$H probe services 2>/dev/null > "$S/services-after-b.txt"

# (c) owner-changed configuration file (CURRENT 0.2.0 behaviour: refuse)
scope "$S/wget.json" wget
$H manifest apply "$S/c.json" "pkgs=$S/wget.json" "plan=t090-c" 2>/dev/null
$H submit "$S/c.json" 2>/dev/null | p "  (c) submit with /etc/wgetrc changed by the owner"
$H probe pre090 2>/dev/null | tee "$S/post-c.txt"
$H probe procs 2>/dev/null | grep -vE "thermald|unattended-upgrade-shutdown" || echo "  no apt/dpkg process (nothing hanging)"
