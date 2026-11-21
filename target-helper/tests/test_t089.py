"""T-089: the controller's previewDigest for a real-target package plan equals the
helper's precondition rule (adapters.precondition_digest for apply.packages.v1).

[FIXTURE DATA] The plan, manifest and installed versions come from vectors.json,
made by make_vectors.mts from the controller's own packages/domain and
packages/ssh code (apt-get -s and dpkg-query output in Ubuntu 24.04 format).
"""

import tempfile
import unittest

from support import VECTORS, FakeSystem

from servrsit_helper.adapters import precondition_digest


class PreconditionDigestTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.vector = VECTORS["preconditions"][0]
        self.manifest = self.vector["manifest"]

    def tearDown(self):
        self.tmp.cleanup()

    def system(self, installed):
        s = FakeSystem(self.tmp.name)
        s.packages = dict(installed)
        return s

    def test_controller_preview_digest_equals_helper_rule_including_architecture_all(self):
        keys = sorted("%s:%s" % (c["name"], c["arch"]) for c in self.manifest["scope"]["packages"])
        self.assertIn("vim-common:all", keys)
        self.assertEqual(self.manifest["preconditionDigest"], self.vector["previewDigest"])
        self.assertEqual(precondition_digest(self.system(self.vector["installed"]), self.manifest), self.manifest["preconditionDigest"])

    def test_packages_outside_the_plan_do_not_change_the_digest(self):
        installed = dict(self.vector["installed"])
        installed["docker-ce:amd64"] = "5:99"
        installed["unrelated:amd64"] = "1.0"
        self.assertEqual(precondition_digest(self.system(installed), self.manifest), self.manifest["preconditionDigest"])

    def test_any_change_to_a_planned_package_changes_the_digest(self):
        for key in ("wget:amd64", "vim-common:all"):
            changed = dict(self.vector["installed"])
            changed[key] = "9.9"
            self.assertNotEqual(precondition_digest(self.system(changed), self.manifest), self.manifest["preconditionDigest"], key)
            removed = {k: v for k, v in self.vector["installed"].items() if k != key}
            self.assertNotEqual(precondition_digest(self.system(removed), self.manifest), self.manifest["preconditionDigest"], key)


if __name__ == "__main__":
    unittest.main()
