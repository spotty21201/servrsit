"""pytest support: put the helper package and this directory on sys.path (unittest runs set PYTHONPATH instead)."""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
for p in (HERE, HERE.parent):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
