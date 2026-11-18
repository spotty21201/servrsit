"""Manifest signature checks (Technical Spec 8.2, ADR-020).

The target holds only public keys, in a root-owned trust file:

    {"keys": {"<keyId>": {"algorithm": "ed25519" | "rsa-pss-sha256", "publicKeyPem": "..."}}}

A signature is over the UTF-8 canonical JSON of the manifest (canonical.py).
Unknown key ids, unknown algorithms and invalid signatures are refused.
Ed25519 is used until the controller moves to AWS KMS; RSA-PSS/SHA-256 (the
Tech Spec's KMS choice) is already accepted, so the move is a trust-file
change, not a helper change.
"""

import base64
import binascii
import json
import os
import stat

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding, rsa

from .canonical import canonical_json

ALGORITHMS = ("ed25519", "rsa-pss-sha256")
MAX_TRUST_BYTES = 64 * 1024


class TrustError(Exception):
    """The trust file is missing, malformed or not safely owned."""


def check_root_owned(path: str, require_root: bool = True) -> None:
    """Refuse files that the SSH account (or anyone but root) could change."""
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode):
        raise TrustError("%s is a symlink" % path)
    if require_root and st.st_uid != 0:
        raise TrustError("%s is not owned by root" % path)
    if st.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise TrustError("%s is writable by group or others" % path)


def load_trust(path: str, require_root: bool = True) -> dict:
    check_root_owned(path, require_root)
    with open(path, "rb") as f:
        raw = f.read(MAX_TRUST_BYTES + 1)
    if len(raw) > MAX_TRUST_BYTES:
        raise TrustError("trust file too large")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise TrustError("trust file is not JSON") from e
    keys = data.get("keys") if isinstance(data, dict) else None
    if not isinstance(keys, dict) or not keys:
        raise TrustError("trust file has no keys")
    out = {}
    for key_id, entry in keys.items():
        if not isinstance(entry, dict) or entry.get("algorithm") not in ALGORITHMS or not isinstance(entry.get("publicKeyPem"), str):
            raise TrustError("trust entry %r is malformed" % key_id)
        public = serialization.load_pem_public_key(entry["publicKeyPem"].encode("ascii"))
        if entry["algorithm"] == "ed25519" and not isinstance(public, ed25519.Ed25519PublicKey):
            raise TrustError("trust entry %r is not an Ed25519 key" % key_id)
        if entry["algorithm"] == "rsa-pss-sha256" and (not isinstance(public, rsa.RSAPublicKey) or public.key_size < 3072):
            raise TrustError("trust entry %r is not an RSA key of at least 3072 bits" % key_id)
        out[key_id] = (entry["algorithm"], public)
    return out


def verify_manifest(signed: dict, trust: dict) -> str | None:
    """None when the signature is valid; otherwise a reject code."""
    key_id = signed.get("keyId")
    entry = trust.get(key_id) if isinstance(key_id, str) else None
    if entry is None:
        return "UNKNOWN_KEY"
    algorithm, public = entry
    try:
        sig = base64.b64decode(signed.get("signature", ""), validate=True)
        data = canonical_json(signed["manifest"]).encode("utf-8")
        if algorithm == "ed25519":
            public.verify(sig, data)
        else:
            public.verify(sig, data, padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())
    except (InvalidSignature, binascii.Error, ValueError, TypeError, KeyError):
        return "INVALID_SIGNATURE"
    return None
