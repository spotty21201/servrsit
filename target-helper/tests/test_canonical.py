"""The helper and the controller agree byte for byte (vectors from packages/domain)."""

import json
import unittest

from support import VECTORS

from servrsit_helper.canonical import CanonicalizationError, canonical_json, digest_of
from servrsit_helper.signature import load_trust, verify_manifest


class CanonicalTests(unittest.TestCase):
    def test_controller_manifests_canonicalize_and_digest_identically(self):
        for v in VECTORS["manifests"]:
            m = v["signed"]["manifest"]
            self.assertEqual(canonical_json(m), v["canonical"], m["operation"])
            self.assertEqual(digest_of(m), v["digest"], m["operation"])

    def test_escapes_and_key_order_match_json_stringify(self):
        for v in VECTORS["canonical"]:
            self.assertEqual(canonical_json(v["value"]), v["text"])
            self.assertEqual(digest_of(v["value"]), v["digest"])

    def test_floats_and_non_ascii_keys_are_refused_not_guessed(self):
        with self.assertRaises(CanonicalizationError):
            canonical_json({"a": 1.5})
        with self.assertRaises(CanonicalizationError):
            canonical_json({"é": 1})
        with self.assertRaises(CanonicalizationError):
            canonical_json({"a": b"bytes"})

    def test_controller_signatures_verify_ed25519_and_rsa_pss(self):
        import tempfile, os

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"keys": VECTORS["keys"]}, f)
        os.chmod(f.name, 0o644)
        trust = load_trust(f.name, require_root=False)
        os.unlink(f.name)
        for v in VECTORS["manifests"]:
            self.assertIsNone(verify_manifest(v["signed"], trust), v["signed"]["manifest"]["operation"])
            rsa_signed = {"manifest": v["signed"]["manifest"], "keyId": "vector-rsa", "signature": v["rsaSignature"]}
            self.assertIsNone(verify_manifest(rsa_signed, trust))
            tampered = json.loads(json.dumps(v["signed"]))
            tampered["manifest"]["plan"]["version"] += 1
            self.assertEqual(verify_manifest(tampered, trust), "INVALID_SIGNATURE")
            self.assertEqual(verify_manifest({**v["signed"], "keyId": "vector-rsa"}, trust), "INVALID_SIGNATURE", "an Ed25519 signature under the RSA key id")


if __name__ == "__main__":
    unittest.main()
