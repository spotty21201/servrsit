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
import re
import stat
import subprocess
from datetime import datetime, timezone

from .canonical import digest_of
from .paths import PathRefused, create_directory, exists_nofollow

RUNNER = "/usr/lib/servrsit/bin/servrsit-runner"
HOST_KEY_FILES = ("/etc/ssh/ssh_host_ed25519_key.pub", "/etc/ssh/ssh_host_ecdsa_key.pub", "/etc/ssh/ssh_host_rsa_key.pub")
CHILD_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C", "LANG": "C"}

# T-090 (D-S6, D-S7): the environment of an APT commit. needrestart is
# suspended (its apt hook would otherwise restart services inside a
# package-only approval, invariant 5) and set to list-only; debconf and
# apt-listchanges never prompt; dpkg keeps a configuration file the owner
# changed (--force-confold) and takes the default for an unchanged one.
COMMIT_ENV = {
    "NEEDRESTART_SUSPEND": "1",
    "NEEDRESTART_MODE": "l",
    "DEBIAN_FRONTEND": "noninteractive",
    "DEBCONF_NONINTERACTIVE_SEEN": "true",
    "APT_LISTCHANGES_FRONTEND": "none",
    "UCF_FORCE_CONFFOLD": "1",
}
DPKG_OPTIONS = ("--force-confdef", "--force-confold")

# T-090 (D-S9): the locks apt and dpkg take. A process that holds one is using the package manager.
DPKG_LOCKS = ("/var/lib/dpkg/lock-frontend", "/var/lib/dpkg/lock", "/var/cache/apt/archives/lock", "/var/lib/apt/lists/lock")

#: Typed reasons for a package operation that ended without changing anything (Tech Spec 13).
PACKAGE_HELD = "PACKAGE_HELD"
PACKAGE_LOCKED = "PACKAGE_LOCKED"
#: T-092: a package would still ask an interactive question; refused before acceptance.
INTERACTIVE_PROMPT = "INTERACTIVE_PROMPT"
DIST_SUFFIXES = (".dpkg-dist", ".ucf-dist")
MAX_DIST_FILES = 2000
NONINTERACTIVE_FRONTEND = "/usr/share/perl5/Debconf/FrontEnd/Noninteractive.pm"


def find_dist_files(root: str) -> set[str]:
    """New-default files dpkg or ucf left beside kept configuration files, under <root>/etc.

    Walks without following symlinks, bounded. Returns absolute paths as the
    server sees them ("/etc/...").
    """
    base = os.path.join(root, "etc")
    out: set[str] = set()
    for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
        for name in filenames:
            if name.endswith(DIST_SUFFIXES):
                full = os.path.join(dirpath, name)
                rel = "/" + os.path.relpath(full, root)
                if _CONFFILE.fullmatch(rel) and not os.path.islink(full):
                    out.add(rel)
                    if len(out) >= MAX_DIST_FILES:
                        return out
    return out


def kept_files(kept: list[str], before: set[str], after: set[str]) -> list[dict]:
    """ADR-024: each kept owner file with the new default dpkg left beside it (or null), plus any other new default."""
    created = sorted(after - before)
    out = []
    for path in sorted(kept):
        new = next((d for d in created if d in (path + ".dpkg-dist", path + ".ucf-dist")), None)
        out.append({"path": path, "newDefault": new})
    paired = {k["newDefault"] for k in out if k["newDefault"] is not None}
    for d in created:
        if d not in paired:
            out.append({"path": d.rsplit(".", 1)[0], "newDefault": d})
    return out[:MAX_DIST_FILES]
LOCKED_TEXT = "another program is using the package manager (an apt or dpkg lock is held); nothing was changed, try again when it has finished"


def held_reason(names: list[str]) -> str:
    return "%s %s held on this server; ServrSit does not override holds, nothing was changed" % (", ".join(names[:10]), "is" if len(names) == 1 else "are")


def locks_free(paths: tuple[str, ...] = DPKG_LOCKS) -> bool:
    """True when no other process holds any of the package manager's locks.

    The same fcntl write locks apt and dpkg use, taken without waiting and
    released at once. A missing lock file is free. Anything else that
    stops the check counts as locked (fail closed).
    """
    import fcntl

    for path in paths:
        try:
            fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
        except FileNotFoundError:
            continue
        except OSError:
            return False
        try:
            fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.lockf(fd, fcntl.LOCK_UN)
        except OSError:
            return False
        finally:
            os.close(fd)
    return True


def is_lock_error(error: BaseException) -> bool:
    """python-apt reports a lock it cannot take as LockFailedException (or an apt_pkg error naming the lock)."""
    if type(error).__name__ == "LockFailedException":
        return True
    text = str(error).lower()
    return "lock" in text and ("could not get lock" in text or "unable to acquire" in text or "unable to lock" in text)


def describe_difference(wanted: set, changed: set) -> str:
    """D-S8: name what differs instead of a generic message."""
    parts = []
    extra = sorted(changed - wanted)
    missing = sorted(wanted - changed)
    if extra:
        parts.append("it would also change %s" % ", ".join(extra[:10]))
    if missing:
        parts.append("apt would not change %s" % ", ".join(missing[:10]))
    return "the transaction is not exactly the plan (%s); nothing was changed" % ("; ".join(parts) or "it would remove packages")

_UNIT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9@_.:-]{0,95}\.service$")
_CONFFILE = re.compile(r"^/etc/[A-Za-z0-9._@+/-]{1,250}$")


def dpkg_name(key: str) -> str:
    """'name:arch' for dpkg; an Architecture: all package goes by its bare name."""
    name, _, arch = key.partition(":")
    return name if arch == "all" else key


def resolve_transaction(cache, changes: list[dict]) -> tuple[dict | None, str | None]:
    """T-090 (D-S5): resolve each change through apt's own lookup.

    Returns ({resolved fullname: (key, package, change)}, None) or (None, reason). apt
    resolves "vim-common:all" to the package whose fullname is
    "vim-common:amd64"; comparing by resolved fullname on both sides means an
    Architecture: all package is matched, and nothing else is.
    """
    resolved: dict = {}
    for c in changes:
        key = "%s:%s" % (c["name"], c["arch"])
        pkg = cache[key] if key in cache else None
        if pkg is None:
            return None, "%s is not known to apt" % key
        if pkg.fullname in resolved:
            return None, "%s appears twice in the transaction" % key
        resolved[pkg.fullname] = (key, pkg, c)
    return resolved, None


def is_held(pkg, apt_pkg) -> bool:
    """D-S8: the owner put the package on hold (`apt-mark hold`). ServrSit never overrides a hold."""
    inner = getattr(pkg, "_pkg", None)
    return inner is not None and getattr(inner, "selected_state", None) == apt_pkg.SELSTATE_HOLD


def parse_needrestart(stdout: str) -> list[str]:
    """`needrestart -b` lines 'NEEDRESTART-SVC: <unit>' -> valid unit names (sorted, unique)."""
    units = set()
    for line in stdout.splitlines():
        if line.startswith("NEEDRESTART-SVC:"):
            unit = line.split(":", 1)[1].strip()
            if _UNIT.fullmatch(unit):
                units.add(unit)
    return sorted(units)


def parse_dpkg_verify(stdout: str) -> list[str]:
    """`dpkg --verify` lines like '??5?????? c /etc/x' -> changed configuration files."""
    out = set()
    for line in stdout.splitlines():
        parts = line.split()
        if len(parts) == 3 and parts[1] == "c" and len(parts[0]) == 9 and parts[0][2] == "5" and _CONFFILE.fullmatch(parts[2]):
            out.add(parts[2])
    return sorted(out)


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
    def apply_packages(self, changes: list[dict]) -> tuple[bool, list[str], str | None]: raise NotImplementedError
    def held_packages(self, keys: list[str]) -> list[str] | None: raise NotImplementedError
    def package_locks_free(self) -> bool: raise NotImplementedError
    def modified_conffiles(self, keys: list[str]) -> list[str] | None: raise NotImplementedError
    def prompt_risk(self, keys: list[str]) -> list[str] | None: raise NotImplementedError
    def dist_files(self) -> set[str]: return find_dist_files(self.root)
    def services_needing_restart(self) -> list[str] | None: raise NotImplementedError
    def dpkg_audit(self) -> str | None: raise NotImplementedError
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

    def apply_packages(self, changes: list[dict]) -> tuple[bool, list[str], str | None]:
        """Install exactly these versions from Ubuntu's archive, or nothing. Returns (ok, evidence, reason code)."""
        import apt
        import apt_pkg

        cache = apt.Cache()
        resolved, reason = resolve_transaction(cache, changes)
        if resolved is None:
            return False, [reason], None
        held = sorted(key for key, pkg, _c in resolved.values() if is_held(pkg, apt_pkg))
        if held:
            return False, [held_reason(held)], PACKAGE_HELD
        with cache.actiongroup():
            for key, pkg, c in resolved.values():
                if pkg.installed is None or pkg.installed.version != c["from"]:
                    return False, ["%s is not installed at %s; nothing was changed" % (key, c["from"])], None
                target = pkg.versions.get(c["to"])
                if target is None or not any(o.origin == "Ubuntu" for o in target.origins):
                    return False, ["%s %s is not available from Ubuntu's archive; nothing was changed" % (key, c["to"])], None
                pkg.candidate = target
                pkg.mark_install(auto_fix=False, from_user=False)
        changed = {p.fullname for p in cache.get_changes()}
        if changed != set(resolved) or cache.delete_count > 0:
            return False, [describe_difference(set(resolved), changed)], None
        if not self.package_locks_free():
            return False, [LOCKED_TEXT], PACKAGE_LOCKED
        for opt in DPKG_OPTIONS:
            apt_pkg.config.set("DPkg::Options::", opt)
        apt_pkg.config.set("Dpkg::Use-Pty", "0")
        saved = {k: os.environ.get(k) for k in COMMIT_ENV}
        os.environ.update(COMMIT_ENV)
        try:
            ok = cache.commit()
        except Exception as e:  # noqa: BLE001 - only a lock failure becomes a typed result; anything else propagates
            if is_lock_error(e):
                return False, [LOCKED_TEXT], PACKAGE_LOCKED
            raise
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        return bool(ok), ["apt commit returned %s (needrestart suspended, no prompts, your changed configuration files kept)" % ("success" if ok else "failure")], None

    def held_packages(self, keys: list[str]) -> list[str] | None:
        import apt
        import apt_pkg

        cache = apt.Cache()
        return sorted(k for k in keys if k in cache and is_held(cache[k], apt_pkg))

    def package_locks_free(self) -> bool:
        return locks_free()

    def prompt_risk(self, keys: list[str]) -> list[str] | None:
        """T-092: packages that could still ask a question. With debconf's non-interactive
        frontend present, debconf, dpkg (confdef/confold) and ucf (UCF_FORCE_CONFFOLD) all
        answer without asking; without it, any package could prompt."""
        return [] if os.path.isfile(NONINTERACTIVE_FRONTEND) else list(keys)

    def modified_conffiles(self, keys: list[str]) -> list[str] | None:
        # Names are schema-checked (start with a letter or digit), so none can look like an option.
        r = self._run(["dpkg", "--verify", *[dpkg_name(k) for k in keys]], timeout=120)
        if r.returncode not in (0, 1):
            return None
        return parse_dpkg_verify(r.stdout.decode("utf-8", "replace"))

    def services_needing_restart(self) -> list[str] | None:
        # -b batch output, -r l list only: needrestart never restarts anything here.
        try:
            r = self._run(["needrestart", "-b", "-r", "l"], timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            return None
        if r.returncode != 0:
            return None
        return parse_needrestart(r.stdout.decode("utf-8", "replace"))

    def dpkg_audit(self) -> str | None:
        r = self._run(["dpkg", "--audit"], timeout=60)
        out = r.stdout.decode("utf-8", "replace").strip()
        return None if r.returncode == 0 and out == "" else (out[:300] or "dpkg --audit reported a problem")

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
        keys = sorted("%s:%s" % (c["name"], c["arch"]) for c in scope["packages"])
        # T-092 (ADR-024): files the owner changed are kept (dpkg --force-confold); the update still runs.
        kept_before = system.modified_conffiles(keys)
        if kept_before is None:
            return {"outcome": "failed", "exitCode": None, "restartNeeded": [], "keptFiles": [],
                    "evidence": ["the changed configuration files could not be checked; nothing was changed"]}
        dist_before = system.dist_files()
        ok, ev, reason_code = system.apply_packages(scope["packages"])
        evidence += ev
        if reason_code is not None:
            # D-S8 / D-S9: refused before apt changed anything, with a typed reason.
            return {"outcome": "failed", "exitCode": None, "restartNeeded": [], "keptFiles": [], "reasonCode": reason_code, "evidence": evidence}
        kept = kept_files(kept_before, dist_before, system.dist_files())
        for k in kept[:20]:
            evidence.append(
                "your file was kept: %s; the new default is at %s" % (k["path"], k["newDefault"])
                if k["newDefault"] is not None
                else "your file was kept: %s (this version brought no new default for it)" % k["path"]
            )
        expect = verification["expectInstalled"]
        found = system.installed(sorted(expect))
        matched = [k for k, v in expect.items() if found.get(k) == v]
        evidence.append("%d of %d packages at the planned version" % (len(matched), len(expect)))
        audit = system.dpkg_audit()
        if audit is not None:
            evidence.append("dpkg reports packages that are not fully configured: %s" % audit)
        # D-S6: services are never restarted here; the ones that now need it are reported for a separate restart plan.
        restart = system.services_needing_restart()
        if restart is None:
            evidence.append("ServrSit could not check which services need a restart")
        elif restart:
            evidence.append("services that need a restart (not restarted; needs a separate restart approval): %s" % ", ".join(restart[:20]))
        else:
            evidence.append("no service needs a restart")
        all_ok = len(matched) == len(expect) and audit is None
        outcome = "succeeded" if all_ok else ("partially_succeeded" if matched else "failed")
        return {"outcome": outcome, "exitCode": 0 if ok else 1, "evidence": evidence, "restartNeeded": (restart or [])[:20], "keptFiles": kept}

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
