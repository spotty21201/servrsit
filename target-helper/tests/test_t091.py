"""T-091 (D-S3): the install's root step trusts nothing in the owner's home.

[FIXTURE DATA] A fake stage (fake package, fake bootstrap.sh and uninstall.sh
that only record how they were called) in a temporary directory. The printed
founder command is run without sudo; `id` is stubbed to say root, so the real
mktemp, install and sha256sum do the work. Nothing is installed.
"""

import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packaging"))
import root_step  # noqa: E402

LINE = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixtureFixt servrsit-maintenance-sentani"


class RootStepTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.src = base / "home" / "servrsit-helper-9.9.9"
        self.src.mkdir(parents=True)
        self.calls = base / "calls"
        self.prefix = str(base / "root" / "servrsit-install.")
        (base / "root").mkdir()
        for name, body in {
            "servrsit-helper-9.9.9.tar.gz": "fake package\n",
            "servrsit-helper-9.9.9.tar.gz.sha256": "x  servrsit-helper-9.9.9.tar.gz\n",
            "trust.json": "{}\n",
            "README.md": "readme\n",
            "account-remove-key.sh": "true\n",
            "bootstrap.sh": 'printf "bootstrap %%s|%%s\\n" "$(pwd)" "$*" >> %s\n' % self.calls,
            "uninstall.sh": 'printf "uninstall %%s|%%s\\n" "$(pwd)" "$*" >> %s\n' % self.calls,
        }.items():
            (self.src / name).write_text(body)
        self.stubs = base / "stubs"
        self.stubs.mkdir()
        (self.stubs / "id").write_text("#!/bin/sh\necho 0\n")
        (self.stubs / "id").chmod(0o755)
        self.text = root_step.render(str(self.src), str(self.src), "servrsit", "inst-1", "spotty", "100.104.220.8", LINE, self.prefix)
        (self.src / "root-step.sh").write_text(self.text)
        self.digest = root_step.sha256_file(str(self.src / "root-step.sh"))

    def tearDown(self):
        self.tmp.cleanup()

    def founder(self, mode="dry-run"):
        cmd = root_step.founder_command(str(self.src), self.digest, mode, self.prefix)
        self.assertTrue(cmd.startswith("sudo sh -c '"))
        inner = cmd[len("sudo "):]
        env = {"PATH": "%s:/usr/bin:/bin" % self.stubs, "LC_ALL": "C"}
        return subprocess.run(["/bin/sh", "-c", inner], env=env, capture_output=True, text=True, timeout=60)

    def ran(self):
        return self.calls.read_text().splitlines() if self.calls.exists() else []

    def test_matching_files_run_from_the_root_copy_only(self):
        r = self.founder("dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        [call] = self.ran()
        where, args = call[len("bootstrap "):].split("|")
        self.assertTrue(where.startswith(self.prefix), where)
        self.assertIn("--dry-run", args)
        self.assertIn("--installation-id inst-1", args)
        self.assertIn("--authorized-key %s" % LINE, args)
        copies = sorted(os.listdir(where))
        self.assertIn("bootstrap.sh", copies)
        self.assertEqual(stat.S_IMODE(os.stat(where).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(where, "bootstrap.sh")).st_mode), 0o600)

    def test_install_and_uninstall_modes(self):
        self.assertEqual(self.founder("install").returncode, 0)
        self.assertEqual(self.founder("uninstall").returncode, 0)
        calls = self.ran()
        self.assertNotIn("--dry-run", calls[0])
        self.assertTrue(calls[1].startswith("uninstall ") and calls[1].endswith("|--account servrsit"))

    def test_a_changed_file_in_the_home_folder_stops_everything(self):
        for name in ("bootstrap.sh", "uninstall.sh", "trust.json", "servrsit-helper-9.9.9.tar.gz", "account-remove-key.sh"):
            original = (self.src / name).read_text()
            (self.src / name).write_text(original + "echo changed\n")
            r = self.founder("install")
            self.assertNotEqual(r.returncode, 0, name)
            self.assertIn("nothing was run", r.stderr, name)
            (self.src / name).write_text(original)
        self.assertEqual(self.ran(), [])

    def test_a_changed_root_step_never_runs(self):
        (self.src / "root-step.sh").write_text(self.text.replace("set -eu", "set -eu\ntouch %s" % self.calls))
        r = self.founder("install")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_a_symlink_or_missing_file_stops_everything(self):
        (self.src / "trust.json").unlink()
        os.symlink("/etc/hostname", self.src / "trust.json")
        self.assertNotEqual(self.founder("install").returncode, 0)
        (self.src / "trust.json").unlink()
        self.assertNotEqual(self.founder("install").returncode, 0)
        self.assertEqual(self.ran(), [])

    def test_root_step_refuses_to_run_from_the_home_folder(self):
        env = {"PATH": "%s:/usr/bin:/bin" % self.stubs}
        r = subprocess.run(["/bin/sh", str(self.src / "root-step.sh"), "install"], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("runs only from its copy", r.stderr)
        self.assertEqual(self.ran(), [])

    def test_inputs_are_validated(self):
        with self.assertRaises(ValueError):
            root_step.render(str(self.src), "/home/x/../etc", "servrsit", "inst-1", "spotty", "1.2.3.4", LINE)
        with self.assertRaises(ValueError):
            root_step.render(str(self.src), str(self.src), "servrsit;id", "inst-1", "spotty", "1.2.3.4", LINE)
        with self.assertRaises(ValueError):
            root_step.render(str(self.src), str(self.src), "servrsit", "inst-1", "spotty", "1.2.3.4", 'x" ; id "')
        with self.assertRaises(ValueError):
            root_step.founder_command(str(self.src), "abc", "install")


if __name__ == "__main__":
    unittest.main()
