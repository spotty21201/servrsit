"""Fixed request and manifest schemas (Technical Spec 7.2, 8.1-8.3).

Everything that reaches the helper is checked here first: exact keys, exact
types, bounded sizes, allowlisted operation ids, and the same name, path and
mode rules as packages/domain/src/actions.ts. There is no field that can carry
a command, an executable path, an environment or a unit definition.
"""

import json
import re

SCHEMA_VERSION = 1
CATALOG_VERSION = 1
REQUEST_VERSION = 1
MAX_REQUEST_BYTES = 256 * 1024

# Operations that change the target, and the read-only query.
MUTATIONS = ("apply.packages.v1", "restart.service.v1", "reboot.host.v1", "prepare.directories.v1")
QUERY = "query.operation.v1"

OPERATION_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
FINGERPRINT = re.compile(r"^SHA256:[A-Za-z0-9+/]{43}$")
KEY_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
TEXT_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
BOOT_ID = re.compile(r"^(?:[0-9a-f-]{1,64}|unknown)$")

PACKAGE = re.compile(r"^[a-z0-9][a-z0-9+.-]{0,99}$")
ARCH = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
VERSION = re.compile(r"^[A-Za-z0-9.+~:-]{1,100}$")
UNIT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9@_.:-]{0,95}\.service$")
ACCOUNT = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
MODE = re.compile(r"^0?[0-7]{3}$")
PATH_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MAX_DEPTH = 8
MAX_PACKAGES = 500
MAX_DIRECTORIES = 20


class SchemaError(ValueError):
    """The input does not match the fixed schema. The message is our own text."""


def _no_duplicates(pairs: list) -> dict:
    out = {}
    for key, value in pairs:
        if key in out:
            raise SchemaError("duplicate key")
        out[key] = value
    return out


def parse_request(raw: bytes) -> dict:
    """Bytes -> a schema-checked request, or SchemaError with our own text.

    T-084: every way json.loads can fail is caught (including the ValueError
    Python raises for integers over 4300 digits, D-H1), duplicate keys are
    refused (D-H5), and NaN/Infinity are refused.
    """
    if len(raw) > MAX_REQUEST_BYTES:
        raise SchemaError("the request is too large")
    try:
        data = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicates, parse_constant=_refuse_constant)
    except SchemaError:
        raise
    except (UnicodeDecodeError, ValueError, RecursionError) as e:
        raise SchemaError("the request is not valid JSON") from e
    return check_request(data)


def _refuse_constant(name: str) -> None:
    raise SchemaError("NaN and Infinity are not allowed")


def _exact(obj: object, keys: set, optional: set = frozenset(), where: str = "object") -> dict:
    if not isinstance(obj, dict):
        raise SchemaError("%s must be an object" % where)
    extra = set(obj) - keys - optional
    missing = keys - set(obj)
    if extra or missing:
        raise SchemaError("%s has unexpected or missing fields" % where)
    return obj


def _str(v: object, pattern: re.Pattern, where: str) -> str:
    if not isinstance(v, str) or not pattern.fullmatch(v):
        raise SchemaError("%s is not valid" % where)
    return v


def _int(v: object, where: str, lo: int = 1, hi: int = 1_000_000) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise SchemaError("%s is not valid" % where)
    return v


def _literal(v: object, value: object, where: str) -> None:
    if type(v) is not type(value) or v != value:
        raise SchemaError("%s is not valid" % where)


def directory_allowed(path: str, owner: str, group: str, mode: str, user: str | None) -> bool:
    """Same rule as directoryAllowed() on the controller."""
    if not ACCOUNT.fullmatch(owner) or not ACCOUNT.fullmatch(group) or not MODE.fullmatch(mode):
        return False
    m = int(mode, 8)
    if m > 0o777 or m & 0o002 or (m & 0o700) != 0o700:
        return False
    if not path.startswith("/") or path.endswith("/") or "//" in path:
        return False
    parts = path[1:].split("/")
    if len(parts) > MAX_DEPTH or not all(PATH_PART.fullmatch(p) for p in parts):
        return False
    under_srv = parts[0] == "srv" and len(parts) >= 2
    under_home = user is not None and ACCOUNT.fullmatch(user) is not None and parts[0] == "home" and len(parts) >= 3 and parts[1] == user
    return under_srv or under_home


def _directory(d: object, where: str, user: str | None) -> dict:
    _exact(d, {"path", "owner", "group", "mode"}, where=where)
    for k in ("path", "owner", "group", "mode"):
        if not isinstance(d[k], str):
            raise SchemaError("%s is not valid" % where)
    if not directory_allowed(d["path"], d["owner"], d["group"], d["mode"], user):
        raise SchemaError("%s is not an allowed directory" % where)
    return d


def check_scope(operation: str, scope: object, verification: object, home_user: str | None) -> None:
    if operation == "apply.packages.v1":
        _exact(scope, {"packages"}, where="scope")
        pk = scope["packages"]
        if not isinstance(pk, list) or not 1 <= len(pk) <= MAX_PACKAGES:
            raise SchemaError("scope.packages is not valid")
        for i, p in enumerate(pk):
            w = "scope.packages[%d]" % i
            _exact(p, {"name", "arch", "from", "to"}, where=w)
            _str(p["name"], PACKAGE, w)
            _str(p["arch"], ARCH, w)
            _str(p["from"], VERSION, w)
            _str(p["to"], VERSION, w)
        _exact(verification, {"expectInstalled"}, where="verification")
        exp = verification["expectInstalled"]
        if not isinstance(exp, dict) or not all(isinstance(k, str) and isinstance(v, str) and VERSION.fullmatch(v) for k, v in exp.items()):
            raise SchemaError("verification.expectInstalled is not valid")
    elif operation == "restart.service.v1":
        _exact(scope, {"unit", "includesServiceRestart", "includesReboot"}, where="scope")
        _str(scope["unit"], UNIT, "scope.unit")
        _literal(scope["includesServiceRestart"], True, "scope.includesServiceRestart")
        _literal(scope["includesReboot"], False, "scope.includesReboot")
        _exact(verification, {"unit", "previousActiveSince"}, where="verification")
        if verification["unit"] != scope["unit"]:
            raise SchemaError("verification.unit does not match scope.unit")
        if verification["previousActiveSince"] is not None and not isinstance(verification["previousActiveSince"], str):
            raise SchemaError("verification.previousActiveSince is not valid")
    elif operation == "reboot.host.v1":
        _exact(scope, {"includesServiceRestart", "includesReboot"}, where="scope")
        _literal(scope["includesServiceRestart"], False, "scope.includesServiceRestart")
        _literal(scope["includesReboot"], True, "scope.includesReboot")
        _exact(verification, {"previousBootId"}, where="verification")
        _str(verification["previousBootId"], BOOT_ID, "verification.previousBootId")
    elif operation == "prepare.directories.v1":
        _exact(scope, {"requested", "directories", "existing", "includesServiceRestart", "includesReboot"}, where="scope")
        _literal(scope["includesServiceRestart"], False, "scope.includesServiceRestart")
        _literal(scope["includesReboot"], False, "scope.includesReboot")
        for key in ("requested", "directories"):
            if not isinstance(scope[key], list) or len(scope[key]) > MAX_DIRECTORIES:
                raise SchemaError("scope.%s is not valid" % key)
            for i, d in enumerate(scope[key]):
                _directory(d, "scope.%s[%d]" % (key, i), home_user)
        if not scope["directories"]:
            raise SchemaError("scope.directories is empty")
        if not isinstance(scope["existing"], list) or not all(isinstance(p, str) and len(p) <= 600 for p in scope["existing"]):
            raise SchemaError("scope.existing is not valid")
        _exact(verification, {"expectDirectories"}, where="verification")
        if verification["expectDirectories"] != scope["directories"]:
            raise SchemaError("verification.expectDirectories does not match scope.directories")
    else:
        raise SchemaError("unsupported operation")


def check_manifest(m: object, home_user: str | None) -> dict:
    """Shape only. Binding, time and signature are checked by the helper."""
    _exact(
        m,
        {"schemaVersion", "installationId", "server", "operationId", "operation", "catalogVersion", "plan", "scope",
         "preconditionDigest", "issuedAt", "acceptBefore", "verification"},
        where="manifest",
    )
    if m["schemaVersion"] != SCHEMA_VERSION or isinstance(m["schemaVersion"], bool):
        raise SchemaError("UNSUPPORTED_SCHEMA")
    if m["catalogVersion"] != CATALOG_VERSION or isinstance(m["catalogVersion"], bool):
        raise SchemaError("UNSUPPORTED_SCHEMA")
    if m["operation"] not in MUTATIONS:
        raise SchemaError("UNSUPPORTED_OPERATION")
    _str(m["installationId"], TEXT_ID, "installationId")
    _exact(m["server"], {"id", "hostKeyFingerprint"}, where="server")
    _str(m["server"]["id"], OPERATION_ID, "server.id")
    _str(m["server"]["hostKeyFingerprint"], FINGERPRINT, "server.hostKeyFingerprint")
    _str(m["operationId"], OPERATION_ID, "operationId")
    _exact(m["plan"], {"id", "version", "digest"}, where="plan")
    _str(m["plan"]["id"], TEXT_ID, "plan.id")
    _int(m["plan"]["version"], "plan.version")
    _str(m["plan"]["digest"], DIGEST, "plan.digest")
    if not isinstance(m["preconditionDigest"], str) or not (DIGEST.fullmatch(m["preconditionDigest"]) or m["preconditionDigest"] == "none"):
        raise SchemaError("preconditionDigest is not valid")
    _str(m["issuedAt"], ISO, "issuedAt")
    _str(m["acceptBefore"], ISO, "acceptBefore")
    check_scope(m["operation"], m["scope"], m["verification"], home_user)
    return m


def check_request(req: object) -> dict:
    """The gateway's request: submit a signed manifest, or query one operation."""
    if not isinstance(req, dict) or req.get("version") != REQUEST_VERSION or isinstance(req.get("version"), bool):
        raise SchemaError("request version is not supported")
    if req.get("op") == "submit":
        _exact(req, {"version", "op", "signed"}, where="request")
        _exact(req["signed"], {"manifest", "keyId", "signature"}, where="signed")
        _str(req["signed"]["keyId"], KEY_ID, "signed.keyId")
        if not isinstance(req["signed"]["signature"], str) or len(req["signed"]["signature"]) > 1024:
            raise SchemaError("signed.signature is not valid")
        if not isinstance(req["signed"]["manifest"], dict):
            raise SchemaError("signed.manifest is not valid")
        return req
    if req.get("op") == QUERY:
        _exact(req, {"version", "op", "operationId"}, where="request")
        _str(req["operationId"], OPERATION_ID, "operationId")
        return req
    raise SchemaError("unsupported request")
