"""
Binding between the spec-derived helper tests and Coder's T-083 target helper.

Bound to the helper source named by SERVRSIT_HELPER_SRC (a `target-helper/` directory). The report pins it to a
throwaway worktree of commit 6c7df23. If the variable is unset, every test is skipped with PENDING_REASON.

Independence: the signer (RSA-PSS/SHA-256, 3072-bit, salt 32, per Tech Spec 8.2 and ADR-020), the canonical form
used for signing, the precondition digests and the fake System below are the Tester's own. Nothing is imported from
Coder's tests (support.py, vectors.json). Only the product modules under test are imported.

Nothing here runs on any server. Everything runs as an ordinary user inside a temporary directory that stands in for
the target's filesystem ("fake root"). No sudo, no systemd, no APT transaction, no reboot, no chown to another user.
"""
from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding, rsa

SRC = os.environ.get("SERVRSIT_HELPER_SRC", "")
PENDING_REASON = "PENDING T-083: set SERVRSIT_HELPER_SRC to a checked-out target-helper/ directory"
BOUND = bool(SRC) and Path(SRC, "servrsit_helper", "helper.py").is_file()

if BOUND:
    sys.path.insert(0, SRC)
    from servrsit_helper import adapters, gateway, helper, ledger, paths, runner, schema  # noqa: E402
    from servrsit_helper.adapters import System  # noqa: E402

    try:
        HELPER_COMMIT = subprocess.run(["git", "-C", SRC, "rev-parse", "HEAD"], capture_output=True, text=True, check=False).stdout.strip()
        HELPER_DIRTY = subprocess.run(["git", "-C", SRC, "status", "--porcelain", "--", "."], capture_output=True, text=True, check=False).stdout.strip()
    except OSError:
        HELPER_COMMIT, HELPER_DIRTY = "unknown", ""
else:  # pragma: no cover
    System = object  # type: ignore[assignment,misc]
    HELPER_COMMIT, HELPER_DIRTY = "", ""


# --------------------------------------------------------------------------------------------- independent signer
def _js_string(s: str) -> str:
    out = ['"']
    esc = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
    for ch in s:
        if ch in esc:
            out.append(esc[ch])
        elif ord(ch) < 0x20 or 0xD800 <= ord(ch) <= 0xDFFF:
            out.append("\\u%04x" % ord(ch))
        else:
            out.append(ch)
    return "".join(out) + '"'


def canonical_json(obj: Any) -> bytes:
    """Tester's own canonical form, written from the rule text (sorted keys, no whitespace, JSON.stringify string
    escapes, UTF-8, no floats). If the helper canonicalises differently, a correctly signed manifest fails."""
    def enc(v: Any) -> str:
        if v is None:
            return "null"
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, int):
            return str(v)
        if isinstance(v, str):
            return _js_string(v)
        if isinstance(v, list):
            return "[" + ",".join(enc(x) for x in v) + "]"
        if isinstance(v, dict):
            return "{" + ",".join(_js_string(k) + ":" + enc(v[k]) for k in sorted(v)) + "}"
        raise TypeError(type(v).__name__)
    return enc(obj).encode("utf-8")


def digest_of(obj: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(obj)).hexdigest()


_RSA_CACHE: dict[int, rsa.RSAPrivateKey] = {}


def _rsa(bits: int) -> rsa.RSAPrivateKey:
    if bits not in _RSA_CACHE:
        _RSA_CACHE[bits] = rsa.generate_private_key(public_exponent=65537, key_size=bits)
    return _RSA_CACHE[bits]


@dataclass
class SigningKey:
    key_id: str
    private: Any
    algorithm: str = "rsa-pss-sha256"

    @staticmethod
    def new(key_id: str = "key-1", *, bits: int = 3072, fresh: bool = False) -> "SigningKey":
        k = rsa.generate_private_key(public_exponent=65537, key_size=bits) if fresh else _rsa(bits)
        return SigningKey(key_id, k)

    @staticmethod
    def ed25519(key_id: str = "key-ed") -> "SigningKey":
        return SigningKey(key_id, ed25519.Ed25519PrivateKey.generate(), "ed25519")

    def public_pem(self) -> str:
        return self.private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    def sign(self, manifest: Any, *, pss: bool = True) -> str:
        data = canonical_json(manifest)
        if self.algorithm == "ed25519":
            return base64.b64encode(self.private.sign(data)).decode()
        pad = padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32) if pss else padding.PKCS1v15()
        return base64.b64encode(self.private.sign(data, pad, hashes.SHA256())).decode()


# --------------------------------------------------------------------------------------------- operation ids
def op_uuid(short: str) -> str:
    """'op-0001' -> a fixed UUID; the helper accepts only UUID operation ids."""
    if schema_ok(short):
        return short
    n = int(short.split("-")[-1]) if short.split("-")[-1].isdigit() else int(hashlib.sha256(short.encode()).hexdigest()[:8], 16)
    return "00000000-0000-4000-8000-%012x" % n


def schema_ok(op_id: str) -> bool:
    return BOUND and schema.OPERATION_ID.fullmatch(op_id) is not None


def iso(t: float) -> str:
    d = datetime.fromtimestamp(t, tz=timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)


# --------------------------------------------------------------------------------------------- the fake target
class RecordingSystem(System):  # type: ignore[misc,valid-type]
    """Tester's own stand-in for the machine. Records every action to calls.jsonl (works across processes)."""

    def __init__(self, target: "FakeTarget", clock: Callable[[], float]):
        self.target, self.clock = target, clock
        self.root = str(target.root)

    def _rec(self, **c: Any) -> None:
        with open(self.target.state / "calls.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(c) + "\n")

    def host_key_fingerprints(self) -> set[str]:
        return {self.target.host_key_fingerprint}

    def boot_id(self) -> str:
        return self.target.boot_id

    def installed(self, keys: list[str]) -> dict[str, str | None]:
        return {k: self.target.packages.get(k) for k in keys}

    def apply_packages(self, changes: list[dict]) -> tuple[bool, list[str]]:
        self._rec(kind="apply", packages=[c["name"] for c in changes])
        if self.target.raise_in_adapter:
            raise RuntimeError("fake adapter failure")
        if self.target.apply_takes_effect:
            for c in changes:
                self.target.packages["%s:%s" % (c["name"], c["arch"])] = c["to"]
        return self.target.apply_reports_ok, ["recording system"]

    def service_state(self, unit: str) -> dict | None:
        s = self.target.services.get(unit)
        return None if s is None else dict(s)

    def restart(self, unit: str) -> int:
        self._rec(kind="restart", unit=unit)
        if self.target.restart_takes_effect:
            s = self.target.services[unit]
            self.target.services[unit] = {"active": True, "activeSince": str(int(s["activeSince"]) + 1)}
        return 0

    def reboot(self) -> int:
        self._rec(kind="reboot")
        return 0

    def ids(self, owner: str, group: str) -> tuple[int, int]:
        # Ordinary user: every approved account maps to the test user. Real chown to another uid is NOT exercised.
        if owner not in self.target.accounts or group not in self.target.accounts:
            raise KeyError(owner)
        return os.getuid(), os.getgid()

    def launch_runner(self, operation_id: str) -> int:
        self._rec(kind="launch", operationId=operation_id)
        return self.target.launch_code

    def now(self) -> str:
        return iso(self.clock())


@dataclass
class FakeTarget:
    """<state>/root is the fake '/': etc/servrsit, var/lib/servrsit/ledger, srv, home/<user>. <state> holds calls.jsonl."""
    state: Path
    installation_id: str = "inst-test"
    host_key_fingerprint: str = "SHA256:" + "A" * 43
    server_id: str = "00000000-0000-4000-8000-0000000000aa"
    home_user: str = "servrsit"
    restartable_units: tuple[str, ...] = ("nginx.service",)
    accounts: tuple[str, ...] = ("root", "servrsit", "deploy")
    boot_id: str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    packages: dict = field(default_factory=lambda: {"openssl:amd64": "3.0.13-0ubuntu3.4"})
    services: dict = field(default_factory=lambda: {"nginx.service": {"active": True, "activeSince": "1000"}})
    launch_code: int = 0
    apply_takes_effect: bool = True
    apply_reports_ok: bool = True
    restart_takes_effect: bool = True
    raise_in_adapter: bool = False
    require_root: bool = False
    clock: Callable[[], float] = lambda: 0.0
    sudo_calls: list = field(default_factory=list)

    @property
    def root(self) -> Path:
        return self.state / "root"

    @property
    def ledger(self) -> Path:
        return self.root / "var/lib/servrsit/ledger"

    @property
    def trust_file(self) -> Path:
        return self.root / "etc/servrsit/trust.json"

    def config(self) -> Any:
        return helper.Config(installation_id=self.installation_id, home_user=self.home_user, restartable_units=list(self.restartable_units),
                             trust_file=str(self.trust_file), ledger_dir=str(self.ledger), require_root=self.require_root)

    def system(self) -> RecordingSystem:
        return RecordingSystem(self, self.clock)


def install_fake(target: FakeTarget, trusted: list[SigningKey], *, clock: Callable[[], float]) -> None:
    """Lay out trust store, ledger and roots under target.root with the modes bootstrap.sh uses (owner is the test user)."""
    target.clock = clock
    for d in ("etc/servrsit", "srv", "home/" + target.home_user):
        (target.root / d).mkdir(parents=True, exist_ok=True)
    target.ledger.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(target.ledger, 0o700)
    target.trust_file.write_text(json.dumps({"keys": {k.key_id: {"algorithm": k.algorithm, "publicKeyPem": k.public_pem()} for k in trusted}}))
    os.chmod(target.trust_file, 0o644)
    (target.state / "calls.jsonl").touch()


# --------------------------------------------------------------------------------------------- driving the helper
HOSTILE_KEYS = ("SSH_ORIGINAL_COMMAND", "LD_PRELOAD", "PYTHONPATH", "PATH", "PYTHONSTARTUP", "SUDO_COMMAND")
_ENV_LOCK = threading.Lock()


def _envelope(request: Any) -> Any:
    if isinstance(request, dict) and "op" not in request and "manifest" in request:
        return {"version": 1, "op": "submit", "signed": request}
    return request


def _reply(out: dict) -> dict:
    out = dict(out)
    out["ok"] = out.get("status") in ("accepted", "existing")
    rec = out.get("record") or {}
    out["operationId"] = rec.get("operationId")
    return out


def submit(target: FakeTarget, request: Any, *, clock: Callable[[], float] | None = None, env: dict[str, str] | None = None, raw: bytes | None = None) -> dict:
    """The GATEWAY path in-process: gateway.forward(raw) -> (recorded sudo call) -> helper.handle(...). The sudo hop
    is replaced by an in-process call; the recorder keeps the argv and env the gateway would have used."""
    if clock is not None:
        target.clock = clock
    data = raw if raw is not None else json.dumps(_envelope(request)).encode()

    def fake_run(argv, input=None, env=None, shell=None, **kw):  # noqa: A002
        target.sudo_calls.append({"argv": list(argv), "env": dict(env or {}), "shell": shell})
        reply = helper.handle(input, target.config(), target.system())
        return subprocess.CompletedProcess(argv, 0, json.dumps(reply).encode(), b"")

    saved: dict[str, str | None] = {}
    ctx = _ENV_LOCK if env else contextlib.nullcontext()
    with ctx:
        try:
            for k, v in (env or {}).items():
                saved[k] = os.environ.get(k)
                os.environ[k] = v
            try:
                out = gateway.forward(data, run=fake_run)
            except Exception as e:  # noqa: BLE001  the real gateway would die and print a traceback to stderr
                return {"ok": False, "status": "crashed", "code": "CRASH", "traceback": "Traceback (most recent call last): %s: %s" % (type(e).__name__, str(e)[:120])}
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
    return _reply(json.loads(out.decode()))


def helper_handle(target: FakeTarget, raw: bytes) -> dict:
    """The privileged helper directly (as sudo would start it), without the gateway in front."""
    try:
        return _reply(helper.handle(raw, target.config(), target.system()))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "status": "crashed", "code": "CRASH", "traceback": "Traceback (most recent call last): %s: %s" % (type(e).__name__, str(e)[:120])}


def query(target: FakeTarget, short: str) -> dict:
    raw = json.dumps({"version": 1, "op": "query.operation.v1", "operationId": op_uuid(short)}).encode()
    return json.loads(gateway.forward(raw, run=lambda argv, input=None, **kw: subprocess.CompletedProcess(argv, 0, json.dumps(helper.handle(input, target.config(), target.system())).encode(), b"")).decode())


def run_runner(target: FakeTarget, short: str) -> int:
    """What systemd-run would start: servrsit-runner <id>, in-process, with the recording system."""
    return runner.run(op_uuid(short), target.config(), target.system())


def calls(target: FakeTarget) -> list[dict]:
    p = target.state / "calls.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def adapter_calls(target: FakeTarget) -> list[dict]:
    """Runner launches (each accepted operation starts one) plus any system action an adapter took."""
    return calls(target)


def ledger_records(target: FakeTarget) -> dict[str, dict]:
    out = {}
    for f in sorted(target.ledger.glob("*.json")):
        rec = json.loads(f.read_text())
        oid = rec.get("operationId", f.stem)
        short = "op-%04d" % int(oid.split("-")[-1], 16) if oid.startswith("00000000-0000-4000-8000-") else oid
        out[short] = rec
    return out


# --------------------------------------------------------------------------------------------- manifests
_SEQ = [1000]


def _precondition(target: FakeTarget, op: str, scope: dict) -> str:
    """The controller's precondition digests, recomputed by the Tester from the fake target's state."""
    if op == "apply.packages.v1":
        keys = sorted("%s:%s" % (c["name"], c["arch"]) for c in scope["packages"])
        return digest_of({"installed": {k: target.packages.get(k) for k in keys}})
    if op == "restart.service.v1":
        s = target.services.get(scope.get("unit"))
        return digest_of({"unit": scope.get("unit"), "service": None if s is None else dict(s)})
    if op == "reboot.host.v1":
        return digest_of({"bootId": target.boot_id})
    reqs = sorted(d["path"] for d in scope.get("requested", []) if isinstance(d, dict) and isinstance(d.get("path"), str))
    existing = []
    for p in reqs:
        with contextlib.suppress(OSError, ValueError):
            os.lstat(os.path.join(target.root, p.lstrip("/")))
            existing.append(p)
    return digest_of({"existing": existing})


def _defaults(target: FakeTarget, op: str, scope: dict | None) -> tuple[dict, dict]:
    if op == "apply.packages.v1":
        s = {"packages": [{"name": "openssl", "arch": "amd64", "from": "3.0.13-0ubuntu3.4", "to": "3.0.13-0ubuntu3.5"}]}
        s.update(scope or {})
        return s, {"expectInstalled": {"%s:%s" % (p["name"], p["arch"]): p["to"] for p in s["packages"]}}
    if op == "restart.service.v1":
        s = {"unit": "nginx.service", "includesServiceRestart": True, "includesReboot": False}
        s.update(scope or {})
        prev = (target.services.get(s["unit"]) or {}).get("activeSince") if isinstance(s["unit"], str) else None
        return s, {"unit": s["unit"], "previousActiveSince": prev}
    if op == "reboot.host.v1":
        s = {"includesServiceRestart": False, "includesReboot": True}
        s.update(scope or {})
        return s, {"previousBootId": target.boot_id}
    dirs = (scope or {}).get("directories", [{"path": "/srv/app", "owner": "root", "group": "root", "mode": "0755"}])
    s = {"requested": dirs, "directories": dirs, "existing": [], "includesServiceRestart": False, "includesReboot": False}
    s.update({k: v for k, v in (scope or {}).items() if k != "directories"})
    s["existing"] = [d["path"] for d in s["requested"] if isinstance(d, dict) and isinstance(d.get("path"), str) and os.path.lexists(os.path.join(target.root, d["path"].lstrip("/")))]
    return s, {"expectDirectories": dirs}


def manifest(target: FakeTarget, *, op: str = "prepare.directories.v1", op_id: str = "op-0001", issued: float, ttl: float = 900.0, scope: dict | None = None, **over: Any) -> dict:
    """A well-formed manifest in the helper's schema (Tech Spec 8.2 field list). `operationId` in `over` may be short."""
    sc, ver = _defaults(target, op, scope)
    m = {
        "schemaVersion": 1, "installationId": target.installation_id,
        "server": {"id": target.server_id, "hostKeyFingerprint": target.host_key_fingerprint},
        "operationId": op_uuid(over.pop("operationId", op_id)),
        "plan": {"id": "plan-0001", "version": 1, "digest": "sha256:" + "0" * 64}, "catalogVersion": 1, "operation": op,
        "scope": sc, "preconditionDigest": "", "issuedAt": iso(issued), "acceptBefore": iso(issued + ttl), "verification": ver,
    }
    m["preconditionDigest"] = _precondition(target, op, sc)
    m.update(over)
    return m


def prepare_directories(target: FakeTarget, dirs: list[dict], key: SigningKey) -> dict:
    """Full path for prepare.directories.v1: signed manifest -> gateway -> helper -> runner (in-process).
    Returns {'created': [paths that did not exist before and are directories now], 'reply': ..., 'record': ...}."""
    before = {d["path"]: os.path.lexists(os.path.join(target.root, str(d["path"]).lstrip("/"))) for d in dirs if isinstance(d.get("path"), str)}
    _SEQ[0] += 1
    m = manifest(target, op_id="op-%04d" % _SEQ[0], issued=target.clock(), scope={"directories": dirs})
    reply = submit(target, {"manifest": m, "keyId": key.key_id, "signature": key.sign(m)})
    record = None
    if reply.get("status") == "accepted":
        run_runner(target, m["operationId"])
        record = ledger.Ledger(str(target.ledger), False).get(m["operationId"])
    created = []
    for p, existed in before.items():
        try:
            full = os.path.join(target.root, p.lstrip("/"))
            if not existed and os.path.isdir(full) and not os.path.islink(full):
                created.append(p)
        except (ValueError, OSError):
            pass
    return {"created": created, "reply": reply, "record": record}


def create_directory_direct(target: FakeTarget, path: str, mode: int = 0o755) -> str:
    """The path primitive alone (paths.create_directory), for the race test. Returns 'created'/'existing'/'refused'."""
    try:
        return paths.create_directory(str(target.root), path, os.getuid(), os.getgid(), mode)
    except paths.PathRefused:
        return "refused"


# --------------------------------------------------------------------------------------------- shipped text
def _pkg(*parts: str) -> str:
    return Path(SRC, *parts).read_text()


def sudoers_text(account: str = "servrsit") -> str:
    return _pkg("packaging", "sudoers.in").replace("@ACCOUNT@", account)


def script_text(name: str) -> str:
    return _pkg("packaging", name)


def authorized_keys_lines() -> list[str]:
    """The key line(s) bootstrap.sh can write, taken from the script itself (T-083: LINE=...; T-084: OPTIONS=... both branches)."""
    key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITEST servrsit-maintenance"
    text = script_text("bootstrap.sh")
    opts = re.findall(r'OPTIONS="((?:[^"\\]|\\.)*)"', text)
    if opts:
        return [o.replace('\\"', '"').replace("$FROM", "100.104.220.8") + " " + key for o in opts]
    for line in text.splitlines():
        if line.startswith("LINE="):
            return [line.split("=", 1)[1].strip('"').replace('\\"', '"').replace("$KEY", key)]
    raise AssertionError("bootstrap.sh has no key line")


def authorized_keys_line() -> str:
    return authorized_keys_lines()[0]


def packaging_files() -> dict[str, str]:
    return {p.name: p.read_text() for p in Path(SRC, "packaging").iterdir() if p.is_file()}


def entry_points() -> dict[str, str]:
    return {p.name: p.read_text() for p in Path(SRC, "bin").iterdir()}
