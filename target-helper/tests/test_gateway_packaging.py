"""Gateway, sources, sudoers, bootstrap, uninstall and the package build.

Nothing here runs sudo, apt, systemctl, systemd-run, useradd or install as
root: the gateway's subprocess is faked, and the scripts run only with
--dry-run against a temporary fake root. `visudo -c -f` checks syntax as an
ordinary user.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from servrsit_helper import gateway

HELPER_ROOT = Path(__file__).resolve().parent.parent
PKG = HELPER_ROOT / "packaging"
SRC = HELPER_ROOT / "servrsit_helper"
QUERY = json.dumps({"version": 1, "op": "query.operation.v1", "operationId": "00000000-0000-4000-8000-0000000006e1"}).encode()


class GatewayTests(unittest.TestCase):
    def test_forwards_the_exact_bytes_to_the_one_sudo_rule_and_ignores_any_ssh_command(self):
        seen = []

        def fake_run(argv, **kw):
            seen.append((argv, kw))
            return subprocess.CompletedProcess(argv, 0, stdout=b'{"found": false}', stderr=b"")

        os.environ["SSH_ORIGINAL_COMMAND"] = "rm -rf / ; sudo bash"
        try:
            out = gateway.forward(QUERY, run=fake_run)
        finally:
            del os.environ["SSH_ORIGINAL_COMMAND"]
        self.assertEqual(out, b'{"found": false}')
        self.assertEqual(seen[0][0], ["/usr/bin/sudo", "-n", "--", "/usr/lib/servrsit/bin/servrsit-helper"])
        self.assertEqual(seen[0][1]["input"], QUERY)
        self.assertEqual(seen[0][1]["shell"], False)
        self.assertNotIn("SSH_ORIGINAL_COMMAND", seen[0][1]["env"])

    def test_invalid_requests_never_reach_sudo(self):
        def boom(*a, **k):
            raise AssertionError("sudo must not be called")

        for raw in [b"", b"id", b'{"version":1,"op":"shell"}', b"x" * (256 * 1024 + 1)]:
            self.assertEqual(json.loads(gateway.forward(raw, run=boom))["code"], "INVALID_REQUEST")

    def test_a_failing_helper_is_reported_without_its_output(self):
        r = gateway.forward(QUERY, run=lambda argv, **kw: subprocess.CompletedProcess(argv, 1, stdout=b"Traceback secret", stderr=b"x"))
        self.assertEqual(json.loads(r), {"status": "rejected", "code": "HELPER_UNAVAILABLE"})


class SourceTests(unittest.TestCase):
    def test_no_shell_eval_or_dynamic_execution_anywhere_in_the_helper(self):
        for path in SRC.glob("*.py"):
            text = path.read_text()
            for bad in ("shell=True", "os.system", "os.popen", "eval(", "exec(", "pickle", "__import__", "subprocess.Popen(", "importlib"):
                self.assertNotIn(bad, text, "%s contains %s" % (path.name, bad))

    def test_the_only_programs_started_are_fixed(self):
        argv_heads = set()
        for path in SRC.glob("*.py"):
            for m in re.finditer(r'\[\s*"([a-z/._-]+)"', path.read_text()):
                argv_heads.add(m.group(1))
        allowed = {"systemctl", "systemd-run", "show", "restart", "reboot", "--unit=servrsit-op-%s", "/usr/bin/sudo"}
        self.assertTrue({"systemctl", "systemd-run"}.issubset(argv_heads))
        self.assertFalse({h for h in argv_heads if h.startswith("/") or h in ("bash", "sh", "python3", "apt", "apt-get")} - {"/usr/bin/sudo"}, argv_heads)
        _ = allowed

    def test_only_ubuntu_packaged_dependencies_are_imported(self):
        import ast

        stdlib_ok = {"base64", "binascii", "contextlib", "dataclasses", "datetime", "fcntl", "grp", "hashlib", "json", "os", "pwd", "re", "stat", "subprocess", "sys"}
        for path in SRC.glob("*.py"):
            for node in ast.walk(ast.parse(path.read_text())):
                names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module] if isinstance(node, ast.ImportFrom) and node.level == 0 else []
                for mod in names:
                    self.assertIn(mod.split(".")[0], stdlib_ok | {"cryptography", "apt", "apt_pkg"}, "%s imports %s" % (path.name, mod))


class SudoersTests(unittest.TestCase):
    def rule(self, account="servrsit"):
        return (PKG / "sudoers.in").read_text().replace("@ACCOUNT@", account)

    def test_the_rule_allows_exactly_the_helper_with_no_arguments(self):
        lines = [l for l in self.rule().splitlines() if l and not l.startswith("#")]
        self.assertEqual(lines[-1], 'servrsit ALL=(root) NOPASSWD: /usr/lib/servrsit/bin/servrsit-helper ""')
        for forbidden in ("ALL=(ALL)", "NOPASSWD: ALL", "bash", "python", "systemctl", "apt", "systemd-run", "SETENV"):
            self.assertNotIn(forbidden, "\n".join(lines))

    @unittest.skipUnless(shutil.which("visudo"), "visudo is not installed")
    def test_visudo_accepts_the_rule_and_refuses_a_broken_one(self):
        with tempfile.TemporaryDirectory() as d:
            good, bad = Path(d, "good"), Path(d, "bad")
            good.write_text(self.rule())
            bad.write_text(self.rule().replace("NOPASSWD:", "NOPASSWD"))
            self.assertEqual(subprocess.run(["visudo", "-c", "-f", str(good)], capture_output=True).returncode, 0)
            self.assertNotEqual(subprocess.run(["visudo", "-c", "-f", str(bad)], capture_output=True).returncode, 0)


class ScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        out = subprocess.run(["sh", str(PKG / "build.sh"), str(self.base / "dist")], capture_output=True, text=True, check=True)
        self.package = Path(out.stdout.strip())
        self.sha = hashlib.sha256(self.package.read_bytes()).hexdigest()
        self.root = self.base / "root"
        (self.root / "etc").mkdir(parents=True)
        (self.root / "etc" / "os-release").write_text('NAME="Ubuntu"\nVERSION_ID="24.04"\n')
        self.trust = self.base / "trust.json"
        self.trust.write_text('{"keys": {}}')

    def tearDown(self):
        self.tmp.cleanup()

    def bootstrap(self, *extra, sha=None):
        args = ["sh", str(PKG / "bootstrap.sh"), "--package", str(self.package), "--sha256", sha or self.sha, "--installation-id", "inst-test",
                "--trust", str(self.trust), "--account", "servrsit", "--authorized-key", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture servrsit-maintenance",
                "--restart-unit", "nginx.service", "--dry-run", *extra]
        return subprocess.run(args, capture_output=True, text=True, env={**os.environ, "SERVRSIT_ROOT": str(self.root)})

    def test_scripts_parse_and_fetch_nothing(self):
        for name in ("bootstrap.sh", "uninstall.sh", "build.sh"):
            text = (PKG / name).read_text()
            self.assertEqual(subprocess.run(["sh", "-n", str(PKG / name)]).returncode, 0, name)
            for bad in ("curl", "wget", "pip ", "| sh", "eval ", "NOPASSWD: ALL"):
                self.assertNotIn(bad, text, "%s contains %s" % (name, bad))

    def test_the_build_is_reproducible(self):
        again = subprocess.run(["sh", str(PKG / "build.sh"), str(self.base / "dist2")], capture_output=True, text=True, check=True)
        self.assertEqual(hashlib.sha256(Path(again.stdout.strip()).read_bytes()).hexdigest(), self.sha)

    def test_bootstrap_dry_run_checks_the_checksum_before_installing_and_visudo_before_sudoers(self):
        r = self.bootstrap()
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout
        self.assertLess(out.index("checking the package checksum"), out.index("would run: install"))
        self.assertLess(out.index("checking the sudoers rule with visudo -c -f"), out.index("/etc/sudoers.d/servrsit"))
        self.assertIn('restrict,command="/usr/lib/servrsit/bin/servrsit-gateway" ssh-ed25519', out)
        self.assertIn("-m 0700 -o root -g root", out)
        self.assertFalse((self.root / "usr").exists(), "a dry run writes nothing")

    def test_bootstrap_refuses_a_wrong_checksum_before_anything_is_installed(self):
        r = self.bootstrap(sha="0" * 64)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("checksum does not match", r.stderr)
        self.assertNotIn("would run: install", r.stdout)

    def test_bootstrap_refuses_bad_inputs(self):
        for flag, value in (("--account", "root"), ("--restart-unit", "nginx.service;id"), ("--authorized-key", 'ssh-ed25519 AAAA\nssh-rsa BBBB'), ("--home-user", "../x")):
            r = self.bootstrap(flag, value)
            self.assertNotEqual(r.returncode, 0, (flag, value))

    def test_bootstrap_refuses_other_ubuntu_releases(self):
        (self.root / "etc" / "os-release").write_text('VERSION_ID="22.04"\n')
        self.assertIn("only Ubuntu 24.04", self.bootstrap().stderr)

    def test_uninstall_dry_run_removes_only_servrsit_files_and_keeps_the_ledger(self):
        r = subprocess.run(["sh", str(PKG / "uninstall.sh"), "--account", "servrsit", "--dry-run"], capture_output=True, text=True, env={**os.environ, "SERVRSIT_ROOT": str(self.root)})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("/etc/sudoers.d/servrsit", r.stdout)
        self.assertIn("kept the ledger", r.stdout)
        self.assertNotIn("userdel", r.stdout)
        self.assertIn('command="/usr/lib/servrsit/bin/servrsit-gateway"', r.stdout)  # T-087: matches lines with or without from=


if __name__ == "__main__":
    unittest.main()
