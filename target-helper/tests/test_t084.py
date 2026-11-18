"""T-084: the Tester's helper-001 defects (D-H1..D-H7, O-1), reproduced and fixed.

The account-side key scripts run here as the ordinary test user against a
temporary home. bootstrap/uninstall run only with --dry-run. No sudo, no
runuser, no systemd.
"""

import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path

from support import Env

from servrsit_helper import gateway
from servrsit_helper.helper import handle

PKG = Path(__file__).resolve().parent.parent / "packaging"
OP = "00000000-0000-4000-8000-0000000007f1"
OP2 = "00000000-0000-4000-8000-0000000007f2"
DOT = "." + "ssh"
PREFIX = 'restrict,command="/usr/lib/servrsit/bin/servrsit-gateway" '


class ParsingTests(unittest.TestCase):
    """D-H1 (long integers) and D-H5 (duplicate keys): fixed codes, never a traceback."""

    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def test_long_integers_and_constants_are_refused_cleanly_by_gateway_and_helper(self):
        hostile = [
            b'{"version":1,"op":"submit","signed":' + b"1" * 5000 + b"}",
            b'{"version":1,"op":"submit","x":-' + b"9" * 4400 + b"}",
            b'{"version":' + b"1" * 5000 + b',"op":"query.operation.v1","operationId":"x"}',
            b'{"version":NaN,"op":"query.operation.v1","operationId":"x"}',
            b'{"version":1,"op":"query.operation.v1","operationId":Infinity}',
        ]
        for raw in hostile:
            with self.subTest(raw=raw[:40]):
                self.assertEqual(json.loads(gateway.forward(raw, run=None))["code"], "INVALID_REQUEST")
                self.assertEqual(handle(raw, self.env.config, self.env.system)["code"], "INVALID_REQUEST")

    def test_duplicate_keys_are_refused_at_every_level(self):
        good = json.loads(self.env.request(self.env.manifest("reboot.host.v1", operationId=OP)))
        text = json.dumps(good)
        dup_top = text.replace('"version": 1', '"version": 1, "version": 1', 1).encode()
        dup_inner = text.replace('"operation": "reboot.host.v1"', '"operation": "reboot.host.v1", "operation": "reboot.host.v1"', 1).encode()
        for raw in (dup_top, dup_inner):
            self.assertEqual(handle(raw, self.env.config, self.env.system)["code"], "INVALID_REQUEST")
            self.assertEqual(json.loads(gateway.forward(raw, run=None))["code"], "INVALID_REQUEST")
        self.assertEqual(handle(text.encode(), self.env.config, self.env.system)["status"], "accepted", "positive control")


class LedgerRobustnessTests(unittest.TestCase):
    """D-H2: no reader sees half a record; a damaged record fails closed instead of crashing."""

    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def plant(self, op_id, content):
        p = Path(self.env.config.ledger_dir) / (op_id + ".json")
        p.write_bytes(content)
        os.chmod(p, 0o600)

    def test_a_damaged_record_gives_fixed_codes_and_blocks_new_changes(self):
        for content in (b"", b"{", b'"a string"', b"\xff\xfe"):
            with self.subTest(content=content):
                self.plant(OP, content)
                q = handle(self.env.query(OP), self.env.config, self.env.system)
                self.assertEqual((q["status"], q["code"]), ("rejected", "HELPER_UNAVAILABLE"))
                s = handle(self.env.request(self.env.manifest("reboot.host.v1", operationId=OP2)), self.env.config, self.env.system)
                self.assertEqual(s["status"], "rejected")
                self.assertIn(s["code"], ("TARGET_BUSY", "HELPER_UNAVAILABLE"), "fail closed: no new change while a record is unreadable")
        self.assertEqual([c for c in self.env.system.calls if c[0] == "launch"], [])

    def test_concurrent_identical_replays_never_crash_and_launch_once(self):
        for round_ in range(10):
            op_id = "00000000-0000-4000-8000-00000000%04x" % (0x8000 + round_)
            raw = self.env.request(self.env.manifest("reboot.host.v1", operationId=op_id))
            replies, errors = [], []

            def go():
                try:
                    replies.append(handle(raw, self.env.config, self.env.system))
                except Exception as e:  # noqa: BLE001 - the test counts any crash
                    errors.append(e)

            threads = [threading.Thread(target=go) for _ in range(16)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            self.assertEqual(errors, [], round_)
            statuses = sorted(r["status"] for r in replies)
            self.assertEqual(statuses.count("accepted"), 1, (round_, statuses))
            self.assertEqual(statuses.count("existing"), 15, (round_, statuses))
            launches = [c for c in self.env.system.calls if c == ("launch", op_id)]
            self.assertEqual(len(launches), 1)
            # Finish it so the next round is not TARGET_BUSY.
            from servrsit_helper.ledger import FINAL, Ledger

            Ledger(self.env.config.ledger_dir, False).update(op_id, state=FINAL, outcome="failed")

    def test_the_first_claim_is_written_by_rename_never_in_place(self):
        src = (Path(__file__).resolve().parent.parent / "servrsit_helper" / "ledger.py").read_text()
        claim = src[src.index("def claim"):src.index("def update")]
        self.assertIn("self._replace(path, record)", claim)
        self.assertNotIn("self._write_new(path, record)", claim)


class WindowTests(unittest.TestCase):
    """O-1: the helper caps how long a manifest may stay acceptable."""

    def test_an_overlong_acceptance_window_is_refused(self):
        env = Env()
        try:
            r = handle(env.request(env.manifest("reboot.host.v1", operationId=OP, acceptBefore="2026-11-18T10:00:00.000Z")), env.config, env.system)
            self.assertEqual(r["code"], "EXPIRED")
            self.assertIn("window", r["detail"])
        finally:
            env.close()


class AccountKeyScriptTests(unittest.TestCase):
    """D-H3: the key line is written as the account, and no symlink is followed."""

    LINE = PREFIX + "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture servrsit-maintenance"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        self.home.mkdir(mode=0o750)
        self.victim = Path(self.tmp.name) / "victim"
        self.victim.mkdir(mode=0o711)
        (self.victim / "authorized_keys").write_text("root-owner-key\n")

    def tearDown(self):
        self.tmp.cleanup()

    def add(self, line=None):
        return subprocess.run(["sh", str(PKG / "account-add-key.sh"), str(self.home), line or self.LINE], capture_output=True, text=True)

    def remove(self):
        return subprocess.run(["sh", str(PKG / "account-remove-key.sh"), str(self.home)], capture_output=True, text=True)

    def test_adds_the_line_once_with_private_modes(self):
        self.assertEqual(self.add().returncode, 0)
        self.assertEqual(self.add().returncode, 0)
        ak = self.home / DOT / "authorized_keys"
        self.assertEqual(ak.read_text().count(self.LINE), 1)
        self.assertEqual(os.stat(self.home / DOT).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(ak).st_mode & 0o777, 0o600)

    def test_a_symlinked_key_directory_is_refused_and_its_target_is_untouched(self):
        os.symlink(self.victim, self.home / DOT)
        r = self.add()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("symlink", r.stderr)
        self.assertEqual((self.victim / "authorized_keys").read_text(), "root-owner-key\n")
        self.assertEqual(os.stat(self.victim).st_mode & 0o777, 0o711, "mode of the link target unchanged")
        self.assertNotEqual(self.remove().returncode, 0)
        self.assertEqual((self.victim / "authorized_keys").read_text(), "root-owner-key\n")

    def test_a_symlinked_key_file_is_refused(self):
        (self.home / DOT).mkdir(mode=0o700)
        os.symlink(self.victim / "authorized_keys", self.home / DOT / "authorized_keys")
        self.assertNotEqual(self.add().returncode, 0)
        self.assertEqual((self.victim / "authorized_keys").read_text(), "root-owner-key\n")

    def test_a_line_with_a_line_break_is_refused(self):
        self.assertNotEqual(self.add(self.LINE + "\nssh-ed25519 AAAA other").returncode, 0)

    def test_removal_keeps_every_other_line_and_verifies(self):
        (self.home / DOT).mkdir(mode=0o700)
        (self.home / DOT / "authorized_keys").write_text("owner-key-1\n" + self.LINE + "\nowner-key-2\n")
        r = self.remove()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("verified", r.stdout)
        self.assertEqual((self.home / DOT / "authorized_keys").read_text(), "owner-key-1\nowner-key-2\n")

    def test_root_never_writes_in_the_accounts_home_in_bootstrap_or_uninstall(self):
        for name in ("bootstrap.sh", "uninstall.sh"):
            text = (PKG / name).read_text()
            self.assertIn("runuser -u \"$ACCOUNT\" -- /bin/sh -s --", text, name)
            self.assertNotRegex(text, r'install -d[^\n]*\.ssh', name)
            self.assertNotIn('>> "$AK"', text, name)
            self.assertNotIn('> "$AK"', text, name)


class PackageAndUninstallTests(unittest.TestCase):
    """D-H4 (sudoers from the verified package) and D-H7 (uninstall checks for unfinished work)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        out = subprocess.run(["sh", str(PKG / "build.sh"), str(self.base / "dist")], capture_output=True, text=True, check=True)
        self.package = Path(out.stdout.strip())
        import hashlib

        self.sha = hashlib.sha256(self.package.read_bytes()).hexdigest()
        self.root = self.base / "root"
        (self.root / "etc").mkdir(parents=True)
        (self.root / "etc" / "os-release").write_text('VERSION_ID="24.04"\n')
        (self.base / "trust.json").write_text('{"keys": {}}')

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_package_carries_the_sudoers_template_and_key_scripts(self):
        with tarfile.open(self.package) as t:
            names = t.getnames()
        for n in ("servrsit-helper/packaging/sudoers.in", "servrsit-helper/packaging/account-add-key.sh", "servrsit-helper/packaging/account-remove-key.sh"):
            self.assertIn(n, names)

    def test_a_changed_template_beside_the_script_has_no_effect(self):
        evil = self.base / "evil"
        evil.mkdir()
        shutil.copy(PKG / "bootstrap.sh", evil / "bootstrap.sh")
        (evil / "sudoers.in").write_text("@ACCOUNT@ ALL=(ALL) NOPASSWD: ALL\n")
        r = subprocess.run(
            ["sh", str(evil / "bootstrap.sh"), "--package", str(self.package), "--sha256", self.sha, "--installation-id", "inst-test", "--trust", str(self.base / "trust.json"),
             "--account", "servrsit", "--authorized-key", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture x", "--dry-run"],
            capture_output=True, text=True, env={**os.environ, "SERVRSIT_ROOT": str(self.root)},
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('the sudoers rule from the package: servrsit ALL=(root) NOPASSWD: /usr/lib/servrsit/bin/servrsit-helper ""', r.stdout)
        self.assertNotIn("NOPASSWD: ALL", r.stdout)

    def uninstall(self, *extra):
        return subprocess.run(["sh", str(PKG / "uninstall.sh"), "--account", "servrsit", "--dry-run", *extra], capture_output=True, text=True,
                              env={**os.environ, "SERVRSIT_ROOT": str(self.root)})

    def test_uninstall_stops_while_an_operation_is_unfinished_unless_forced(self):
        led = self.root / "var" / "lib" / "servrsit" / "ledger"
        led.mkdir(parents=True)
        (led / (OP + ".json")).write_text(json.dumps({"operationId": OP, "state": "running"}, sort_keys=True))
        r = self.uninstall("--remove-ledger")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(OP, r.stdout)
        self.assertIn("not finished", r.stderr)
        forced = self.uninstall("--remove-ledger", "--force")
        self.assertEqual(forced.returncode, 0, forced.stderr)
        self.assertIn("kept the ledger", forced.stdout, "with unfinished work the ledger is never removed")
        (led / (OP + ".json")).write_text(json.dumps({"operationId": OP, "state": "finished"}, sort_keys=True))
        self.assertEqual(self.uninstall().returncode, 0)


if __name__ == "__main__":
    unittest.main()
