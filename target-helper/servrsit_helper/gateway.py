"""The restricted SSH gateway (Technical Spec 7.2).

The dedicated key's authorized_keys line forces this program:

    restrict,command="/usr/lib/servrsit/bin/servrsit-gateway" ssh-ed25519 AAAA... servrsit-maintenance

It runs as the SSH account. Whatever command the client asked for
(SSH_ORIGINAL_COMMAND) is ignored. It reads one bounded request from stdin,
checks its schema, and passes the same bytes to the helper through the one
sudoers rule. It never runs anything else and never reads arguments.
"""

import json
import subprocess
import sys

from .schema import MAX_REQUEST_BYTES, SchemaError, check_request

HELPER = "/usr/lib/servrsit/bin/servrsit-helper"
SUDO = "/usr/bin/sudo"
MAX_RESPONSE_BYTES = 256 * 1024


def forward(raw: bytes, run=subprocess.run) -> bytes:
    if len(raw) > MAX_REQUEST_BYTES:
        return json.dumps({"status": "rejected", "code": "INVALID_REQUEST", "detail": "the request is too large"}).encode()
    try:
        check_request(json.loads(raw.decode("utf-8")))
    except (UnicodeDecodeError, json.JSONDecodeError, SchemaError, RecursionError):
        return json.dumps({"status": "rejected", "code": "INVALID_REQUEST"}).encode()
    try:
        r = run([SUDO, "-n", "--", HELPER], input=raw, capture_output=True, timeout=120, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"}, shell=False, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return json.dumps({"status": "rejected", "code": "HELPER_UNAVAILABLE"}).encode()
    out = r.stdout[:MAX_RESPONSE_BYTES]
    if r.returncode != 0 or not out:
        return json.dumps({"status": "rejected", "code": "HELPER_UNAVAILABLE"}).encode()
    return out


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    sys.stdout.buffer.write(forward(raw))
    return 0
