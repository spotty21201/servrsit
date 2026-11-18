"""Canonical JSON, byte-identical to packages/domain/src/canonical.ts.

Rules (the same tested specification on both sides):
  - object keys sorted; keys must be ASCII so code-point order equals the
    controller's UTF-16 order
  - arrays keep their order; no whitespace
  - strings escaped as JavaScript's JSON.stringify does
  - only None, bool, int, str, list and dict. Floats are refused: manifests
    carry no fractional numbers, and float formatting differs between
    languages, so refusing is the only way two sides cannot disagree.
"""

import hashlib


class CanonicalizationError(ValueError):
    pass


_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


def _string(s: str) -> str:
    out = ['"']
    for ch in s:
        code = ord(ch)
        if ch in _ESCAPES:
            out.append(_ESCAPES[ch])
        elif code < 0x20:
            out.append("\\u%04x" % code)
        elif 0xD800 <= code <= 0xDFFF:
            # A lone surrogate: JSON.stringify writes it escaped.
            out.append("\\u%04x" % code)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _encode(value: object, path: str) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        raise CanonicalizationError("a float at %s" % path)
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, list):
        return "[" + ",".join(_encode(v, "%s[%d]" % (path, i)) for i, v in enumerate(value)) + "]"
    if isinstance(value, dict):
        parts = []
        for key in sorted(value.keys()):
            if not isinstance(key, str) or not key.isascii():
                raise CanonicalizationError("a non-ASCII or non-string key at %s" % path)
            parts.append(_string(key) + ":" + _encode(value[key], path + "." + key))
        return "{" + ",".join(parts) + "}"
    raise CanonicalizationError("a %s at %s" % (type(value).__name__, path))


def canonical_json(value: object) -> str:
    return _encode(value, "$")


def digest_of(value: object) -> str:
    """'sha256:<hex>' of the canonical JSON, as digestOf() on the controller."""
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
