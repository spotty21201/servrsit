#!/bin/sh
# T-088 on helper 0.3.0 (T-092, ADR-024), SENTANI ONLY.
#   check: installed files == source ebe0287; what is pending now
#   (c)  wget with the owner's /etc/wgetrc edit: expect updated, owner file kept, keptFiles/.dpkg-dist in evidence
#   (v)  only if the vim set is pending: expect succeeded, no INTERACTIVE_PROMPT, keptFiles empty
# Usage (from /projects/servrsit/apps/api, node 24 on PATH): sh t092.sh <checkout of ebe0287>/target-helper
set -eu
SRC=$1
H="node_modules/.bin/tsx /projects/servrsit-tester/tests/live/t088/h.mts"
A=/projects/servrsit-tester/tests/live/t088/apply.sh
S=/tmp/t088/s092; mkdir -p "$S"
$H probe installedsums 2>/dev/null > "$S/installed.txt" || true; head -n 1 "$S/installed.txt"
( cd "$SRC" && sha256sum servrsit_helper/*.py bin/* ) | LC_ALL=C sort > "$S/source.txt"
grep -E "^[0-9a-f]{64}" "$S/installed.txt" | LC_ALL=C sort | diff - "$S/source.txt" >/dev/null && echo "installed files == ebe0287 ($(wc -l < "$S/source.txt") files)" || { echo "STOP: installed helper is not ebe0287"; exit 3; }
$H probe aptsim 2>/dev/null | tee "$S/aptsim.txt" | grep -E "^Inst|upgraded"
$H probe holds 2>/dev/null | head -n 1; $H probe dpkglock 2>/dev/null | head -n 2

scope() {  # $1 out, $2.. names; from the aptsim taken above
  OUT=$1; shift
  python3 - "$OUT" "$S/aptsim.txt" "$@" <<'PY'
import re, json, sys
out, sim, names = sys.argv[1], sys.argv[2], sys.argv[3:]
rows = []
for l in open(sim):
    m = re.match(r'^Inst (\S+) \[([^\]]+)\] \((\S+) (.+?) \[([^\]]+)\]\)', l)
    if m and m.group(1) in names:
        assert 'Ubuntu:24.04/' in m.group(4), l
        rows.append({"name": m.group(1), "arch": m.group(5), "from": m.group(2), "to": m.group(3)})
if sorted(r["name"] for r in rows) != sorted(names):
    sys.exit(1)
json.dump(rows, open(out, "w"), indent=1)
print("  scope:", ", ".join("%s:%s %s->%s" % (r["name"], r["arch"], r["from"], r["to"]) for r in rows))
PY
}

if scope "$S/wget.json" wget; then
  echo "=== (c) before"; $H probe wgetrcstate 2>/dev/null | tee "$S/c-before.txt"
  $H probe services 2>/dev/null > "$S/services-before.txt"
  sh "$A" t092-c "$S/wget.json"
  echo "=== (c) after"; $H probe wgetrcstate 2>/dev/null | tee "$S/c-after.txt"
  $H probe lastop 2>/dev/null | tee "$S/c-journal.txt"
else
  echo "(c) skipped: wget is not pending"
fi
if scope "$S/vim.json" vim vim-common vim-runtime vim-tiny xxd; then
  sh "$A" t092-v "$S/vim.json"
  $H probe wgetrcstate 2>/dev/null | head -n 6
else
  echo "(v) skipped: the vim set is not pending (needs a founder downgrade)"
fi
