"""T-090: defects from test-report-sentani-001 (D-S5, D-S6, D-S7) and upgrades.

RealSystem.apply_packages runs here against a FAKE `apt`/`apt_pkg` module
(inserted into sys.modules), so the real matching and commit-policy code is
exercised without APT. [FIXTURE DATA] Package names and versions are
synthetic; the `:all` vs `:amd64` behaviour copies what the Tester observed
with python-apt on Sentani (fullname is name:<native arch> for an
Architecture: all package that is looked up as name:all).
"""

import contextlib
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path

from support import Env

import servrsit_helper
from servrsit_helper import adapters
from servrsit_helper.adapters import COMMIT_ENV, RealSystem, dpkg_name, parse_dpkg_verify, parse_needrestart, resolve_transaction
from servrsit_helper.helper import handle
from servrsit_helper.runner import run

PKG = Path(__file__).resolve().parent.parent / "packaging"
OP = "00000000-0000-4000-8000-0000000009c1"


class FakeVersion:
    def __init__(self, version, origin="Ubuntu"):
        self.version = version
        self.origins = [types.SimpleNamespace(origin=origin)]


class FakePackage:
    def __init__(self, fullname, installed, available):
        self.fullname = fullname
        self.name = fullname.split(":")[0]
        self.installed = FakeVersion(installed) if installed else None
        self.versions = {v: FakeVersion(v) for v in available}
        self.candidate = None
        self.marked = False

    def mark_install(self, auto_fix=False, from_user=False):
        self.marked = True


class FakeCache:
    """Lookup like python-apt: 'name:all' and 'name:amd64' both find an Architecture: all package."""

    instances: list = []

    def __init__(self, packages, aliases, extra_changes=()):
        self.packages = packages
        self.aliases = aliases
        self.extra = list(extra_changes)
        self.delete_count = 0
        self.commit_env = None
        self.commit_config = None
        FakeCache.instances.append(self)

    def _key(self, key):
        return self.aliases.get(key, key)

    def __contains__(self, key):
        return self._key(key) in self.packages

    def __getitem__(self, key):
        return self.packages[self._key(key)]

    @contextlib.contextmanager
    def actiongroup(self):
        yield

    def get_changes(self):
        return [p for p in self.packages.values() if p.marked] + self.extra

    def commit(self):
        self.commit_env = {k: os.environ.get(k) for k in COMMIT_ENV}
        self.commit_config = list(FAKE_APT_PKG.config.values)
        for p in self.packages.values():
            if p.marked:
                p.installed = p.candidate
        return True


class FakeConfig:
    def __init__(self):
        self.values = []

    def set(self, key, value):
        self.values.append((key, value))


FAKE_APT_PKG = types.SimpleNamespace(config=FakeConfig())


def install_fake_apt(cache_factory):
    fake_apt = types.ModuleType("apt")
    fake_apt.Cache = cache_factory
    return {"apt": fake_apt, "apt_pkg": FAKE_APT_PKG}


def sentani_like_cache(extra_changes=()):
    """vim-common and vim-runtime are Architecture: all; vim is amd64."""
    pk = {
        "vim:amd64": FakePackage("vim:amd64", "2:9.1.0016-1ubuntu7.3", ["2:9.1.0016-1ubuntu7.4"]),
        "vim-common:amd64": FakePackage("vim-common:amd64", "2:9.1.0016-1ubuntu7.3", ["2:9.1.0016-1ubuntu7.4"]),
        "vim-runtime:amd64": FakePackage("vim-runtime:amd64", "2:9.1.0016-1ubuntu7.3", ["2:9.1.0016-1ubuntu7.4"]),
    }
    return FakeCache(pk, {"vim-common:all": "vim-common:amd64", "vim-runtime:all": "vim-runtime:amd64"}, extra_changes)


CHANGES = [
    {"name": "vim", "arch": "amd64", "from": "2:9.1.0016-1ubuntu7.3", "to": "2:9.1.0016-1ubuntu7.4"},
    {"name": "vim-common", "arch": "all", "from": "2:9.1.0016-1ubuntu7.3", "to": "2:9.1.0016-1ubuntu7.4"},
    {"name": "vim-runtime", "arch": "all", "from": "2:9.1.0016-1ubuntu7.3", "to": "2:9.1.0016-1ubuntu7.4"},
]


class ArchitectureAllTests(unittest.TestCase):
    """D-S5: an Architecture: all package labelled :all is matched by apt's own resolution."""

    def setUp(self):
        FAKE_APT_PKG.config.values.clear()
        FakeCache.instances.clear()

    def apply(self, cache, changes=CHANGES):
        with unittest.mock.patch.dict(sys.modules, install_fake_apt(lambda: cache)):
            return RealSystem().apply_packages(changes)

    def test_a_transaction_with_all_packages_is_applied(self):
        cache = sentani_like_cache()
        ok, evidence = self.apply(cache)
        self.assertTrue(ok, evidence)
        self.assertEqual({p.fullname for p in cache.get_changes()}, {"vim:amd64", "vim-common:amd64", "vim-runtime:amd64"})
        self.assertEqual(cache.packages["vim-common:amd64"].installed.version, "2:9.1.0016-1ubuntu7.4")

    def test_the_old_comparison_would_have_refused_it(self):
        wanted_by_label = {"%s:%s" % (c["name"], c["arch"]) for c in CHANGES}
        self.assertNotEqual(wanted_by_label, {"vim:amd64", "vim-common:amd64", "vim-runtime:amd64"}, "the regression the Tester saw")

    def test_any_extra_or_removed_package_still_refuses_the_whole_transaction(self):
        extra = FakePackage("libfoo:amd64", "1", ["2"])
        cache = sentani_like_cache(extra_changes=[extra])
        ok, evidence = self.apply(cache)
        self.assertFalse(ok)
        self.assertIn("would change other packages", evidence[0])
        self.assertIsNone(cache.commit_env, "nothing was committed")
        cache2 = sentani_like_cache()
        cache2.delete_count = 1
        self.assertFalse(self.apply(cache2)[0])

    def test_unknown_or_duplicate_packages_are_refused(self):
        self.assertFalse(self.apply(sentani_like_cache(), [{"name": "nothere", "arch": "all", "from": "1", "to": "2"}])[0])
        dup = CHANGES + [{"name": "vim-common", "arch": "amd64", "from": "2:9.1.0016-1ubuntu7.3", "to": "2:9.1.0016-1ubuntu7.4"}]
        ok, ev = self.apply(sentani_like_cache(), dup)
        self.assertFalse(ok)
        self.assertIn("twice", ev[0])

    def test_resolve_keys_by_apt_fullname(self):
        resolved, reason = resolve_transaction(sentani_like_cache(), CHANGES)
        self.assertIsNone(reason)
        self.assertEqual(sorted(resolved), ["vim-common:amd64", "vim-runtime:amd64", "vim:amd64"])

    def test_dpkg_gets_the_bare_name_for_an_all_package(self):
        self.assertEqual([dpkg_name(k) for k in ("vim-common:all", "vim:amd64")], ["vim-common", "vim:amd64"])


class CommitPolicyTests(unittest.TestCase):
    """D-S6 (needrestart never restarts) and D-S7 (no prompts, keep the owner's configuration)."""

    def setUp(self):
        FAKE_APT_PKG.config.values.clear()

    def test_the_commit_runs_with_needrestart_suspended_and_no_prompts_and_the_environment_is_restored(self):
        os.environ.pop("NEEDRESTART_SUSPEND", None)
        os.environ["DEBIAN_FRONTEND"] = "readline"
        cache = sentani_like_cache()
        try:
            with unittest.mock.patch.dict(sys.modules, install_fake_apt(lambda: cache)):
                ok, evidence = RealSystem().apply_packages(CHANGES)
            self.assertTrue(ok)
            self.assertEqual(cache.commit_env["NEEDRESTART_SUSPEND"], "1")
            self.assertEqual(cache.commit_env["NEEDRESTART_MODE"], "l")
            self.assertEqual(cache.commit_env["DEBIAN_FRONTEND"], "noninteractive")
            self.assertEqual(cache.commit_env["APT_LISTCHANGES_FRONTEND"], "none")
            self.assertIn(("DPkg::Options::", "--force-confdef"), cache.commit_config)
            self.assertIn(("DPkg::Options::", "--force-confold"), cache.commit_config)
            self.assertNotIn("NEEDRESTART_SUSPEND", os.environ, "restored after the commit")
            self.assertEqual(os.environ["DEBIAN_FRONTEND"], "readline")
            self.assertIn("needrestart suspended", evidence[0])
        finally:
            os.environ.pop("DEBIAN_FRONTEND", None)

    def test_needrestart_and_dpkg_verify_are_run_list_only_with_fixed_argv(self):
        seen = []

        def fake_run(argv, timeout=60):
            seen.append(argv)
            out = b"NEEDRESTART-VER: 3.6\nNEEDRESTART-SVC: nginx.service\nNEEDRESTART-SVC: ssh.service\n" if argv[0] == "needrestart" else b"??5?????? c /etc/vim/vimrc\n"
            return subprocess.CompletedProcess(argv, 0, stdout=out, stderr=b"")

        rs = RealSystem()
        rs._run = fake_run
        self.assertEqual(rs.services_needing_restart(), ["nginx.service", "ssh.service"])
        self.assertEqual(rs.modified_conffiles(["vim-common:all", "vim:amd64"]), ["/etc/vim/vimrc"])
        self.assertEqual(seen, [["needrestart", "-b", "-r", "l"], ["dpkg", "--verify", "vim-common", "vim:amd64"]])

    def test_parsers_ignore_anything_unexpected(self):
        self.assertEqual(parse_needrestart("NEEDRESTART-SVC: nginx.service\nNEEDRESTART-SVC: $(id).service\nNEEDRESTART-SVC: x.socket\nNEEDRESTART-KSTA: 1"), ["nginx.service"])
        self.assertEqual(parse_dpkg_verify("??5?????? c /etc/a.conf\n??5??????   /usr/bin/x\n?????????? c /etc/b\n??5?????? c /etc/../x y\nmissing   c /etc/gone"), ["/etc/a.conf"])


class RunnerAndSubmitTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def accept(self):
        r = handle(self.env.request(self.env.manifest("apply.packages.v1", operationId=OP)), self.env.config, self.env.system)
        self.assertEqual(r["status"], "accepted", r)

    def query(self):
        return handle(self.env.query(OP), self.env.config, self.env.system)

    def test_D_S6_services_that_need_a_restart_are_reported_and_never_restarted(self):
        self.env.system.restart_needed = ["nginx.service"]
        self.accept()
        run(OP, self.env.config, self.env.system)
        q = self.query()
        self.assertEqual(q["outcome"], "succeeded")
        self.assertEqual(q["restartNeeded"], ["nginx.service"])
        self.assertTrue(any("not restarted; needs a separate restart approval" in e for e in q["evidence"]))
        self.assertFalse([c for c in self.env.system.calls if c[0] in ("restart", "reboot")])

    def test_D_S6_an_unknown_restart_state_is_said_not_hidden(self):
        self.env.system.restart_needed = None
        self.accept()
        run(OP, self.env.config, self.env.system)
        q = self.query()
        self.assertEqual(q["restartNeeded"], [])
        self.assertIn("ServrSit could not check which services need a restart", q["evidence"])

    def test_D_S7_a_changed_configuration_file_is_refused_before_acceptance(self):
        self.env.system.changed_conffiles = ["/etc/vim/vimrc"]
        r = handle(self.env.request(self.env.manifest("apply.packages.v1", operationId=OP)), self.env.config, self.env.system)
        self.assertEqual(r["code"], "CONFFILE_MODIFIED")
        self.assertIn("/etc/vim/vimrc", r["detail"])
        self.assertFalse([c for c in self.env.system.calls if c[0] in ("launch", "apply")])

    def test_D_S7_a_configuration_file_changed_after_acceptance_stops_the_runner_before_apt(self):
        self.accept()
        self.env.system.changed_conffiles = ["/etc/vim/vimrc"]
        run(OP, self.env.config, self.env.system)
        q = self.query()
        self.assertEqual(q["outcome"], "failed")
        self.assertFalse([c for c in self.env.system.calls if c[0] == "apply"])

    def test_D_S7_a_half_configured_package_after_the_commit_is_not_success(self):
        self.env.system.audit = "The following packages are only half configured: vim"
        self.accept()
        run(OP, self.env.config, self.env.system)
        q = self.query()
        self.assertNotEqual(q["outcome"], "succeeded")
        self.assertTrue(any("not fully configured" in e for e in q["evidence"]))


class LedgerCompatibilityTests(unittest.TestCase):
    def test_a_record_written_by_0_1_0_is_still_answered_after_the_upgrade(self):
        env = Env()
        try:
            rec = {"operationId": OP, "manifestDigest": "sha256:" + "a" * 64, "manifest": env.manifest("reboot.host.v1", operationId=OP), "state": "finished",
                   "outcome": "succeeded", "exitCode": 0, "acceptedAt": "t", "startedAt": "t", "finishedAt": "t", "evidence": ["old"]}
            p = Path(env.config.ledger_dir) / (OP + ".json")
            p.write_text(json.dumps(rec, sort_keys=True))
            os.chmod(p, 0o600)
            q = handle(env.query(OP), env.config, env.system)
            self.assertEqual((q["found"], q["outcome"], q["restartNeeded"], q["helperVersion"]), (True, "succeeded", [], "0.2.0"))
        finally:
            env.close()


class VersionAndUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        out = subprocess.run(["sh", str(PKG / "build.sh"), str(base / "dist")], capture_output=True, text=True, check=True)
        self.package = Path(out.stdout.strip())
        import hashlib

        self.sha = hashlib.sha256(self.package.read_bytes()).hexdigest()
        self.root = base / "root"
        (self.root / "etc").mkdir(parents=True)
        (self.root / "etc" / "os-release").write_text('VERSION_ID="24.04"\n')
        (base / "trust.json").write_text('{"keys": {}}')
        self.trust = base / "trust.json"

    def tearDown(self):
        self.tmp.cleanup()

    def bootstrap(self):
        return subprocess.run(
            ["sh", str(PKG / "bootstrap.sh"), "--package", str(self.package), "--sha256", self.sha, "--installation-id", "servrsit-merauke-founder-1",
             "--trust", str(self.trust), "--account", "servrsit", "--create-account", "--home-user", "spotty", "--install-deps", "--from", "100.104.220.8",
             "--authorized-key", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture servrsit-maintenance-sentani", "--dry-run"],
            capture_output=True, text=True, env={**os.environ, "SERVRSIT_ROOT": str(self.root)},
        )

    def test_the_version_is_0_2_0_and_the_package_is_named_for_it(self):
        self.assertEqual(servrsit_helper.HELPER_VERSION, "0.2.0")
        self.assertEqual(self.package.name, "servrsit-helper-0.2.0.tar.gz")

    def test_a_fresh_install_says_so(self):
        r = self.bootstrap()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("installing helper 0.2.0", r.stdout)

    def test_installing_over_0_1_0_is_an_upgrade_that_replaces_the_code_and_keeps_the_ledger(self):
        lib = self.root / "usr" / "lib" / "servrsit"
        (lib / "servrsit_helper").mkdir(parents=True)
        (lib / "VERSION").write_text("0.1.0\n")
        led = self.root / "var" / "lib" / "servrsit" / "ledger"
        led.mkdir(parents=True)
        (led / (OP + ".json")).write_text(json.dumps({"operationId": OP, "state": "finished"}, sort_keys=True))
        r = self.bootstrap()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("upgrading the helper from 0.1.0 to 0.2.0 (the ledger is kept)", r.stdout)
        self.assertIn("would run: rm -rf -- %s/servrsit_helper %s/bin" % (lib, lib), r.stdout)
        self.assertNotIn("var/lib/servrsit/ledger\n", [l for l in r.stdout.splitlines() if "rm -rf" in l])

    def test_an_upgrade_is_refused_while_an_operation_is_unfinished(self):
        lib = self.root / "usr" / "lib" / "servrsit"
        lib.mkdir(parents=True)
        (lib / "VERSION").write_text("0.1.0\n")
        led = self.root / "var" / "lib" / "servrsit" / "ledger"
        led.mkdir(parents=True)
        (led / (OP + ".json")).write_text(json.dumps({"operationId": OP, "state": "running"}, sort_keys=True))
        r = self.bootstrap()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("is not finished", r.stderr)
        self.assertNotIn("would run: install", r.stdout)


import unittest.mock  # noqa: E402 - used above via unittest.mock.patch

if __name__ == "__main__":
    unittest.main()
