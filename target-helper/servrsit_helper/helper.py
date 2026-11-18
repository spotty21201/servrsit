"""The privileged helper (runs as root through one sudoers rule).

Input: one JSON request on stdin (schema.py), at most 256 KiB. Output: one
JSON response on stdout. Nothing from the request is ever echoed back; error
texts are fixed. The request cannot name a command, a path to run, an
environment or a unit definition.

  submit              verify signature -> schema -> binding -> ledger replay
                      -> time -> precondition -> atomic claim -> start the
                      transient runner unit
  query.operation.v1  read the ledger (and settle a reboot by its new boot id)
"""

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from . import HELPER_VERSION
from .adapters import RealSystem, System, precondition_digest
from .canonical import CanonicalizationError, digest_of
from .ledger import FINAL, Ledger, LedgerError, UnreadableRecord
from .schema import MAX_REQUEST_BYTES, QUERY, SchemaError, check_manifest, parse_request
from .signature import TrustError, load_trust, verify_manifest

CONFIG_FILE = "/etc/servrsit/helper.json"
#: T-084 (O-1): a manifest may not ask to stay acceptable for longer than this.
MAX_ACCEPT_WINDOW = timedelta(minutes=30)
TRUST_FILE = "/etc/servrsit/trust.json"
LEDGER_DIR = "/var/lib/servrsit/ledger"


@dataclass
class Config:
    installation_id: str
    home_user: str | None = None
    restartable_units: list[str] = field(default_factory=list)
    clock_skew_tolerance_seconds: int = 120
    trust_file: str = TRUST_FILE
    ledger_dir: str = LEDGER_DIR
    require_root: bool = True


def load_config(path: str = CONFIG_FILE) -> Config:
    from .signature import check_root_owned

    check_root_owned(path)
    with open(path, "rb") as f:
        data = json.loads(f.read(64 * 1024).decode("utf-8"))
    units = data.get("restartableUnits", [])
    if not isinstance(data.get("installationId"), str) or not isinstance(units, list) or not all(isinstance(u, str) for u in units):
        raise TrustError("helper configuration is malformed")
    return Config(
        installation_id=data["installationId"],
        home_user=data.get("homeUser"),
        restartable_units=units,
        clock_skew_tolerance_seconds=int(data.get("clockSkewToleranceSeconds", 120)),
    )


def _time(iso: str) -> datetime:
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


def _rejected(code: str, detail: str | None = None) -> dict:
    out = {"status": "rejected", "code": code}
    if detail is not None:
        out["detail"] = detail
    return out


def _public(record: dict) -> dict:
    return {
        "operationId": record["operationId"],
        "manifestDigest": record["manifestDigest"],
        "state": "finished" if record["state"] == FINAL else "running",
        "exitCode": record["exitCode"],
    }


def submit(signed: dict, config: Config, system: System) -> dict:
    try:
        trust = load_trust(config.trust_file, config.require_root)
    except (TrustError, OSError, ValueError):
        return _rejected("UNKNOWN_KEY", "the trust file could not be used")
    try:
        bad = verify_manifest(signed, trust)
    except CanonicalizationError:
        return _rejected("INVALID_SIGNATURE")
    if bad is not None:
        return _rejected(bad)
    manifest = signed["manifest"]
    try:
        check_manifest(manifest, config.home_user)
    except SchemaError as e:
        code = str(e) if str(e) in ("UNSUPPORTED_SCHEMA", "UNSUPPORTED_OPERATION") else "UNSUPPORTED_SCHEMA"
        return _rejected(code)
    if manifest["installationId"] != config.installation_id or manifest["server"]["hostKeyFingerprint"] not in system.host_key_fingerprints():
        return _rejected("MISBOUND")
    if manifest["operation"] == "restart.service.v1" and manifest["scope"]["unit"] not in config.restartable_units:
        return _rejected("UNSUPPORTED_OPERATION", "this unit is not allowed on this server")

    digest = digest_of(manifest)
    ledger = Ledger(config.ledger_dir, config.require_root)
    existing = ledger.get(manifest["operationId"])
    if existing is not None:
        # A repeated manifest returns the same operation, even after expiry; another digest never does.
        return {"status": "existing", "record": _public(existing)} if existing["manifestDigest"] == digest else _rejected("DIGEST_MISMATCH")

    now = _time(system.now())
    tolerance = timedelta(seconds=config.clock_skew_tolerance_seconds)
    if _time(manifest["issuedAt"]) > now + tolerance:
        return _rejected("EXPIRED", "CLOCK_SKEW: the manifest was issued in this server's future")
    if now > _time(manifest["acceptBefore"]):
        return _rejected("EXPIRED")
    if _time(manifest["acceptBefore"]) - _time(manifest["issuedAt"]) > MAX_ACCEPT_WINDOW:
        return _rejected("EXPIRED", "the manifest's acceptance window is longer than this helper allows")
    if manifest["preconditionDigest"] == "none" or precondition_digest(system, manifest) != manifest["preconditionDigest"]:
        return _rejected("PRECONDITION_CHANGED")

    status, record = ledger.claim(manifest["operationId"], digest, manifest, system.now())
    if record is None:
        return _rejected(status)
    if status == "accepted":
        code = system.launch_runner(manifest["operationId"])
        if code != 0:
            record = ledger.update(manifest["operationId"], state=FINAL, outcome="failed", finishedAt=system.now(),
                                   evidence=["the operation could not be started (systemd-run exit %d); nothing was changed" % code])
    return {"status": status, "record": _public(record)}


def query(operation_id: str, config: Config, system: System) -> dict:
    ledger = Ledger(config.ledger_dir, config.require_root)
    record = ledger.get(operation_id)
    if record is None:
        return {"found": False, "helperVersion": HELPER_VERSION}
    m = record["manifest"]
    if m["operation"] == "reboot.host.v1" and record["state"] == "running" and record["startedAt"] is not None:
        boot = system.boot_id()
        if boot != m["verification"]["previousBootId"]:
            record = ledger.update(operation_id, state=FINAL, outcome="succeeded", exitCode=0, finishedAt=system.now(),
                                   evidence=["the server came back with a new boot id"])
    return {
        "found": True,
        "helperVersion": HELPER_VERSION,
        "record": _public(record),
        "outcome": record["outcome"],
        "evidence": record["evidence"][-20:],
    }


def handle(raw: bytes, config: Config, system: System) -> dict:
    if len(raw) > MAX_REQUEST_BYTES:
        return _rejected("INVALID_REQUEST", "the request is too large")
    try:
        req = parse_request(raw)
    except SchemaError:
        return _rejected("INVALID_REQUEST")
    try:
        if req["op"] == QUERY:
            return query(req["operationId"], config, system)
        return submit(req["signed"], config, system)
    except UnreadableRecord:
        # Fail closed (D-H2): no new change is accepted while a record cannot be read.
        return _rejected("HELPER_UNAVAILABLE", "a ledger record cannot be read; the owner must check /var/lib/servrsit/ledger")
    except (LedgerError, OSError):
        return _rejected("HELPER_UNAVAILABLE", "the helper could not read or write its ledger")


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    try:
        config = load_config()
    except (TrustError, OSError, ValueError):
        sys.stdout.write(json.dumps(_rejected("HELPER_UNAVAILABLE", "the helper configuration could not be used")))
        return 0
    sys.stdout.write(json.dumps(handle(raw, config, RealSystem())))
    return 0
