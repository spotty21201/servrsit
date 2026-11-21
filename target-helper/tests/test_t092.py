"""T-092 (ADR-024): helper 0.3.0 updates a package whose configuration file
the owner changed, keeps the owner's file, and records the kept file and the
new default (.dpkg-dist). It refuses only when a package would still ask a
question. [FIXTURE DATA] The fake root and file contents are synthetic.
"""

import os
import tempfile
import unittest
from pathlib import Path

from support import Env

import servrsit_helper
from servrsit_helper import adapters
from servrsit_helper.adapters import find_dist_files, kept_files
from servrsit_helper.helper import handle
from servrsit_helper.runner import run

OP = "00000000-0000-4000-8000-00000000a092"


class ConffileFakeRootTests(unittest.TestCase):
    """A fake root with an owner-modified /etc file; the fake apt behaves like dpkg --force-confold."""

    def setUp(self):
        self.env = Env()
        self.etc = self.env.root / "etc" / "ssl"
        self.etc.mkdir(parents=True)
        self.owner_file = self.etc / "openssl.cnf"
        self.owner_file.write_text("# the owner's own settings\n")
        system = self.env.system
        system.changed_conffiles = ["/etc/ssl/openssl.cnf"]
        real_apply = system.apply_packages

        def confold_apply(changes):
            # What dpkg does with --force-confold for a changed conffile: keep it, write the new default beside it.
            (self.etc / "openssl.cnf.dpkg-dist").write_text("# the package's new default\n")
            return real_apply(changes)

        system.apply_packages = confold_apply

    def tearDown(self):
        self.env.close()

    def test_the_update_runs_keeps_the_owners_file_and_records_the_new_default(self):
        r = handle(self.env.request(self.env.manifest("apply.packages.v1", operationId=OP)), self.env.config, self.env.system)
        self.assertEqual(r["status"], "accepted", "an owner-modified configuration file no longer refuses the update")
        run(OP, self.env.config, self.env.system)
        q = handle(self.env.query(OP), self.env.config, self.env.system)
        self.assertEqual(q["outcome"], "succeeded")
        self.assertEqual(q["keptFiles"], [{"path": "/etc/ssl/openssl.cnf", "newDefault": "/etc/ssl/openssl.cnf.dpkg-dist"}])
        self.assertIn("your file was kept: /etc/ssl/openssl.cnf; the new default is at /etc/ssl/openssl.cnf.dpkg-dist", q["evidence"])
        self.assertEqual(self.owner_file.read_text(), "# the owner's own settings\n", "the owner's file is untouched")
        self.assertIsNone(q["reasonCode"])

    def test_a_kept_file_without_a_new_default_is_said_so(self):
        def apply_without_new_default(changes):
            for c in changes:
                self.env.system.packages["%s:%s" % (c["name"], c["arch"])] = c["to"]
            return True, ["fake apt"], None

        self.env.system.apply_packages = apply_without_new_default
        handle(self.env.request(self.env.manifest("apply.packages.v1", operationId=OP)), self.env.config, self.env.system)
        run(OP, self.env.config, self.env.system)
        q = handle(self.env.query(OP), self.env.config, self.env.system)
        self.assertEqual(q["keptFiles"], [{"path": "/etc/ssl/openssl.cnf", "newDefault": None}])
        self.assertTrue(any("no new default" in e for e in q["evidence"]))

    def test_a_new_default_that_existed_before_is_not_claimed_as_new(self):
        (self.etc / "openssl.cnf.dpkg-dist").write_text("old leftover\n")
        before = find_dist_files(str(self.env.root))
        self.assertEqual(kept_files(["/etc/ssl/openssl.cnf"], before, before), [{"path": "/etc/ssl/openssl.cnf", "newDefault": None}])

    def test_other_new_defaults_are_recorded_too(self):
        out = kept_files([], set(), {"/etc/nginx/nginx.conf.dpkg-dist", "/etc/x.ucf-dist"})
        self.assertEqual(out, [{"path": "/etc/nginx/nginx.conf", "newDefault": "/etc/nginx/nginx.conf.dpkg-dist"}, {"path": "/etc/x", "newDefault": "/etc/x.ucf-dist"}])

    def test_the_dist_file_walk_does_not_follow_symlinks_or_leave_etc(self):
        outside = Path(self.env.root.parent) / "outside"
        outside.mkdir()
        (outside / "evil.dpkg-dist").write_text("x")
        os.symlink(outside, self.env.root / "etc" / "link")
        os.symlink(outside / "evil.dpkg-dist", self.etc / "linked.dpkg-dist")
        (self.etc / "real.dpkg-dist").write_text("x")
        self.assertEqual(find_dist_files(str(self.env.root)), {"/etc/ssl/real.dpkg-dist"})


class PromptTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def test_a_package_that_would_still_ask_a_question_is_refused_before_acceptance(self):
        self.env.system.prompting = ["openssl:amd64"]
        r = handle(self.env.request(self.env.manifest("apply.packages.v1", operationId=OP)), self.env.config, self.env.system)
        self.assertEqual(r["code"], "INTERACTIVE_PROMPT")
        self.assertIn("openssl:amd64", r["detail"])
        self.assertFalse([c for c in self.env.system.calls if c[0] in ("launch", "apply")])

    def test_an_unanswerable_prompt_check_refuses_too(self):
        self.env.system.prompting = None
        r = handle(self.env.request(self.env.manifest("apply.packages.v1", operationId=OP)), self.env.config, self.env.system)
        self.assertEqual(r["code"], "PRECONDITION_CHANGED")

    def test_real_prompt_risk_depends_on_debconfs_noninteractive_frontend(self):
        with tempfile.TemporaryDirectory() as d:
            present = Path(d) / "Noninteractive.pm"
            present.write_text("1;")
            old = adapters.NONINTERACTIVE_FRONTEND
            try:
                adapters.NONINTERACTIVE_FRONTEND = str(present)
                self.assertEqual(adapters.RealSystem().prompt_risk(["a:amd64"]), [])
                adapters.NONINTERACTIVE_FRONTEND = str(Path(d) / "missing.pm")
                self.assertEqual(adapters.RealSystem().prompt_risk(["a:amd64"]), ["a:amd64"])
            finally:
                adapters.NONINTERACTIVE_FRONTEND = old


class VersionTests(unittest.TestCase):
    def test_the_version_is_0_3_0(self):
        self.assertEqual(servrsit_helper.HELPER_VERSION, "0.3.0")

    def test_the_commit_still_keeps_owner_files(self):
        self.assertEqual(adapters.DPKG_OPTIONS, ("--force-confdef", "--force-confold"))
        self.assertEqual(adapters.COMMIT_ENV["UCF_FORCE_CONFFOLD"], "1")


if __name__ == "__main__":
    unittest.main()
