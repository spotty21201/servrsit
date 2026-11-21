"""Test support. [FIXTURE DATA] Everything here is synthetic.

FakeSystem stands in for the machine: no APT, no systemd, no reboot, no
sudo. A temporary directory is the fake root for directory work. Nothing in
the tests can reach a real server.
"""

import base64
import copy
import json
import os
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

from servrsit_helper.adapters import System
from servrsit_helper.canonical import canonical_json, digest_of
from servrsit_helper.helper import Config

HERE = Path(__file__).resolve().parent
VECTORS = json.loads((HERE / "vectors.json").read_text())
HOST_KEY = VECTORS["hostKeyFingerprint"]
INSTALLATION = VECTORS["installationId"]
NOW = "2026-11-17T10:00:00.000Z"


class FakeSystem(System):
    def __init__(self, root: str):
        self.root = root
        self.clock = NOW
        self.boot = "11111111-2222-3333-4444-555555555555"
        self.packages = {"openssl:amd64": "3.0.13-0ubuntu3.4"}
        self.services = {"nginx.service": {"active": True, "activeSince": "123"}}
        self.calls: list[tuple] = []
        self.launch_code = 0
        self.apply_ok = True
        self.changed_conffiles: list[str] = []
        self.restart_needed: list[str] | None = []
        self.audit: str | None = None

    def host_key_fingerprints(self):
        return {HOST_KEY}

    def boot_id(self):
        return self.boot

    def installed(self, keys):
        return {k: self.packages.get(k) for k in keys}

    def apply_packages(self, changes):
        self.calls.append(("apply", tuple(c["name"] for c in changes)))
        if self.apply_ok:
            for c in changes:
                self.packages["%s:%s" % (c["name"], c["arch"])] = c["to"]
        return self.apply_ok, ["fake apt"]

    def modified_conffiles(self, keys):
        self.calls.append(("verify", tuple(keys)))
        return list(self.changed_conffiles)

    def services_needing_restart(self):
        return None if self.restart_needed is None else list(self.restart_needed)

    def dpkg_audit(self):
        return self.audit

    def service_state(self, unit):
        s = self.services.get(unit)
        return None if s is None else dict(s)

    def restart(self, unit):
        self.calls.append(("restart", unit))
        self.services[unit] = {"active": True, "activeSince": str(int(self.services[unit]["activeSince"]) + 1)}
        return 0

    def reboot(self):
        self.calls.append(("reboot",))
        return 0

    def ids(self, owner, group):
        if owner not in ("deploy", "owner") or group not in ("deploy", "owner"):
            raise KeyError(owner)
        return os.getuid(), os.getgid()

    def launch_runner(self, operation_id):
        self.calls.append(("launch", operation_id))
        return self.launch_code

    def now(self):
        return self.clock


class Env:
    """A fake installation: trust file, ledger, config and fake root, in a temp dir."""

    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.key = ed25519.Ed25519PrivateKey.generate()
        pem = self.key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        self.trust_file = base / "trust.json"
        self.trust_file.write_text(json.dumps({"keys": {"test-key": {"algorithm": "ed25519", "publicKeyPem": pem}, **VECTORS["keys"]}}))
        os.chmod(self.trust_file, 0o644)
        self.ledger = base / "ledger"
        self.ledger.mkdir(mode=0o700)
        self.root = base / "root"
        (self.root / "srv").mkdir(parents=True)
        (self.root / "home" / "owner").mkdir(parents=True)
        self.system = FakeSystem(str(self.root))
        self.config = Config(
            installation_id=INSTALLATION,
            home_user="owner",
            restartable_units=["nginx.service"],
            trust_file=str(self.trust_file),
            ledger_dir=str(self.ledger),
            require_root=False,
        )

    def close(self):
        self.tmp.cleanup()

    def manifest(self, operation: str, **changes) -> dict:
        """A vector manifest of this kind, with a precondition that matches the fake system."""
        from servrsit_helper.adapters import precondition_digest

        m = copy.deepcopy(next(v["signed"]["manifest"] for v in VECTORS["manifests"] if v["signed"]["manifest"]["operation"] == operation))
        m.update(changes)
        if "preconditionDigest" not in changes:
            m["preconditionDigest"] = precondition_digest(self.system, m)
        return m

    def sign(self, manifest: dict, key_id: str = "test-key") -> dict:
        sig = self.key.sign(canonical_json(manifest).encode("utf-8"))
        return {"manifest": manifest, "keyId": key_id, "signature": base64.b64encode(sig).decode()}

    def request(self, manifest: dict, **sign_kw) -> bytes:
        return json.dumps({"version": 1, "op": "submit", "signed": self.sign(manifest, **sign_kw)}).encode()

    def query(self, operation_id: str) -> bytes:
        return json.dumps({"version": 1, "op": "query.operation.v1", "operationId": operation_id}).encode()


__all__ = ["Env", "FakeSystem", "VECTORS", "HOST_KEY", "INSTALLATION", "NOW", "digest_of"]
