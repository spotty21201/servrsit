"""Operation adapters (Technical Spec 8.1, 8.3, 10).

Each adapter knows exactly one allowlisted operation. It reads its input only
from a validated manifest, acts only through the `System` interface, and
verifies the postcondition independently (invariant 9: an exit code alone is
never success).

`RealSystem` is the only code that touches the machine. It runs fixed
argument vectors (no shell), python3-apt and descriptor-based file calls.
BUILD ONLY: no test runs RealSystem's mutating methods, so nothing here
proves APT, systemd or reboot behaviour on a real Ubuntu server.
"""

import base64
import grp
import hashlib
import os
import pwd
import stat
import subprocess
from datetime import datetime, timezone

from .canonical import digest_of
from .paths import PathRefused, create_directory, exists_nofollow

RUNNER = "/usr/lib/servrsit/bin/servrsit-runner"
HOST_KEY_FILES = ("/etc/ssh/ssh_host_ed25519_key.pub", "/etc/ssh/ssh_host_ecdsa_key.pub", "/etc/ssh/ssh_host_rsa_key.pub")
CHILD_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C", "LANG": "C"}


def now_iso() -> str:
    t = datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (t.microsecond // 1000)


def fingerprint_of_pubkey_line(line: str) -> str | None:
    parts = line.strip().split()
    if len(parts) < 2:
        return None
    try:
        blob = base64.b64decode(parts[1], validate=True)
    except ValueError:
        return None
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode("ascii").rstrip("=")


class System:
    """What the adapters may do. Tests use a fake; production uses RealSystem."""

    root = "/"

    def host_key_fingerprints(self) -> set[str]: raise NotImplementedError
    def boot_id(self) -> str: raise NotImplementedError
    def installed(self, keys: list[str]) -> dict[str, str | None]: raise NotImplementedError
    def apply_packages(self, changes: list[dict]) -> tuple[bool, list[str]]: raise NotImplementedError
    def service_state(self, unit: str) -> dict | None: raise NotImplementedError
    def restart(self, unit: str) -> int: raise NotImplementedError
    def reboot(self) -> int: raise NotImplementedError
    def ids(self, owner: str, group: str) -> tuple[int, int]: raise NotImplementedError
    def launch_runner(self, operation_id: str) -> int: raise NotImplementedError
    def now(self) -> str: return now_iso()


class RealSystem(System):
    def _run(self, argv: list[str], timeout: int = 60) -> subprocess.CompletedProcess:
        return subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, env=CHILD_ENV, shell=False, check=False)

    def host_key_fingerprints(self) -> set[str]:
        out = set()
        for path in HOST_KEY_FILES:
            try:
                with open(path, "r", encoding="ascii") as f:
                    fp = fingerprint_of_pubkey_line(f.read(16 * 1024))
            except (OSError, UnicodeDecodeError):
                continue
            if fp is not None:
                out.add(fp)
        return out

    def boot_id(self) -> str:
        with open("/proc/sys/kernel/random/boot_id", "r", encoding="ascii") as f:
            return f.read(64).strip()

    def installed(self, keys: list[str]) -> dict[str, str | None]:
        import apt  # python3-apt, Ubuntu-packaged

        cache = apt.Cache()
        out: dict[str, str | None] = {}
        for key in keys:
            pkg = cache[key] if key in cache else None
            out[key] = pkg.installed.version if pkg is not None and pkg.installed is not None else None
        return out

    def apply_packages(self, changes: list[dict]) -> tuple[bool, list[str]]:
        """Install exactly these versions from Ubuntu's archive, or nothing."""
        import apt

        cache = apt.Cache()
        evidence = []
        with cache.actiongroup():
            for c in changes:
                key = "%s:%s" % (c["name"], c["arch"])
                pkg = cache[key] if key in cache else None
                if pkg is None or pkg.installed is None or pkg.installed.version != c["from"]:
                    return False, ["%s is not installed at %s" % (key, c["from"])]
                target = pkg.versions.get(c["to"])
                if target is None or not any(o.origin == "Ubuntu" for o in target.origins):
                    return False, ["%s %s is not available from Ubuntu's archive" % (key, c["to"])]
                pkg.candidate = target
                pkg.mark_install(auto_fix=False, from_user=False)
        wanted = {"%s:%s" % (c["name"], c["arch"]) for c in changes}
        changed = {p.fullname for p in cache.get_changes()}
        if changed != wanted or cache.delete_count > 0:
            return False, ["the transaction would change other packages; nothing was changed"]
        ok = cache.commit()
        evidence.append("apt commit returned %s" % ("success" if ok else "failure"))
        return bool(ok), evidence

    def service_state(self, unit: str) -> dict | None:
        r = self._run(["systemctl", "show", "--property=LoadState", "--property=ActiveState", "--property=ActiveEnterTimestampMonotonic", unit])
        props = dict(line.split("=", 1) for line in r.stdout.decode("utf-8", "replace").splitlines() if "=" in line)
        if props.get("LoadState") != "loaded":
            return None
        since = props.get("ActiveEnterTimestampMonotonic")
        return {"active": props.get("ActiveState") == "active", "activeSince": since if since not in (None, "", "0") else None}

    def restart(self, unit: str) -> int:
        return self._run(["systemctl", "restart", unit], timeout=300).returncode

    def reboot(self) -> int:
        return self._run(["systemctl", "reboot"]).returncode

    def ids(self, owner: str, group: str) -> tuple[int, int]:
        return pwd.getpwnam(owner).pw_uid, grp.getgrnam(group).gr_gid

    def launch_runner(self, operation_id: str) -> int:
        # A transient unit outlives the SSH session (invariant 6: disconnection proves nothing).
        argv = ["systemd-run", "--unit=servrsit-op-%s" % operation_id, "--description=ServrSit operation", "--collect", "--no-block",
                "--property=Type=exec", RUNNER, operation_id]
        return self._run(argv).returncode


# ---------------------------------------------------------------------------
# Precondition digests (same rules as the controller's previews)
# ---------------------------------------------------------------------------


def precondition_digest(system: System, manifest: dict) -> str:
    op = manifest["operation"]
    scope = manifest["scope"]
    if op == "apply.packages.v1":
        keys = sorted("%s:%s" % (c["name"], c["arch"]) for c in scope["packages"])
        return digest_of({"installed": system.installed(keys)})
    if op == "restart.service.v1":
        return digest_of({"unit": scope["unit"], "service": system.service_state(scope["unit"])})
    if op == "reboot.host.v1":
        return digest_of({"bootId": system.boot_id()})
    if op == "prepare.directories.v1":
        paths = sorted(d["path"] for d in scope["requested"])
        return digest_of({"existing": [p for p in paths if exists_nofollow(system.root, p)]})
    raise ValueError("unsupported operation")


# ---------------------------------------------------------------------------
# Execution and independent verification
# ---------------------------------------------------------------------------


def run_operation(system: System, manifest: dict, allowed_units: list[str]) -> dict:
    """Returns {outcome, exitCode, evidence}. Outcome is set only by verification."""
    op = manifest["operation"]
    scope = manifest["scope"]
    verification = manifest["verification"]
    evidence: list[str] = []

    if op == "apply.packages.v1":
        ok, ev = system.apply_packages(scope["packages"])
        evidence += ev
        expect = verification["expectInstalled"]
        found = system.installed(sorted(expect))
        matched = [k for k, v in expect.items() if found.get(k) == v]
        evidence.append("%d of %d packages at the planned version" % (len(matched), len(expect)))
        outcome = "succeeded" if len(matched) == len(expect) else ("partially_succeeded" if matched else "failed")
        return {"outcome": outcome, "exitCode": 0 if ok else 1, "evidence": evidence}

    if op == "restart.service.v1":
        unit = scope["unit"]
        if unit not in allowed_units:
            return {"outcome": "failed", "exitCode": None, "evidence": ["%s is not a unit this server allows ServrSit to restart" % unit]}
        before = system.service_state(unit)
        code = system.restart(unit)
        after = system.service_state(unit)
        restarted = after is not None and after["active"] and after["activeSince"] != (before or {}).get("activeSince")
        evidence.append("restart exit status %d; unit %s" % (code, "active with a new start time" if restarted else "not verified as restarted"))
        return {"outcome": "succeeded" if restarted else "failed", "exitCode": code, "evidence": evidence}

    if op == "reboot.host.v1":
        # The outcome is established later by query: a new boot id (helper.py).
        code = system.reboot()
        return {"outcome": None, "exitCode": code, "evidence": ["reboot requested (exit status %d); waiting for a new boot id" % code]}

    if op == "prepare.directories.v1":
        created, left = 0, 0
        for d in scope["directories"]:
            try:
                uid, gid = system.ids(d["owner"], d["group"])
                result = create_directory(system.root, d["path"], uid, gid, int(d["mode"], 8))
            except (PathRefused, KeyError) as e:
                evidence.append("%s: not created (%s)" % (d["path"], e if isinstance(e, PathRefused) else "unknown owner or group"))
                continue
            if result == "created":
                created += 1
            else:
                left += 1
                evidence.append("%s already exists and was left as it is" % d["path"])
        ok_paths = [d for d in verification["expectDirectories"] if _directory_matches(system, d)]
        total = len(verification["expectDirectories"])
        evidence.append("%d created, %d left alone; %d of %d verified with the planned owner and mode" % (created, left, len(ok_paths), total))
        outcome = "succeeded" if len(ok_paths) == total else ("partially_succeeded" if ok_paths else "failed")
        return {"outcome": outcome, "exitCode": 0, "evidence": evidence}

    raise ValueError("unsupported operation")


def _directory_matches(system: System, d: dict) -> bool:
    try:
        st = os.lstat(os.path.join(system.root, d["path"].lstrip("/")))
        uid, gid = system.ids(d["owner"], d["group"])
    except (OSError, KeyError):
        return False
    return stat.S_ISDIR(st.st_mode) and (st.st_mode & 0o7777) == int(d["mode"], 8) and st.st_uid == uid and st.st_gid == gid
