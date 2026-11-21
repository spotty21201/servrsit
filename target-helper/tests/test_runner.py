"""Runner and adapters on FakeSystem (no APT, no systemd): verified outcomes,
no repeat, precondition recheck, directory safety including symlink races."""

import os
import stat
import unittest

from support import Env

from servrsit_helper.helper import handle
from servrsit_helper.ledger import Ledger, LedgerError
from servrsit_helper.paths import PathRefused, create_directory
from servrsit_helper.runner import run

OP = "00000000-0000-4000-8000-0000000004c1"


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def accept(self, operation, **changes):
        r = handle(self.env.request(self.env.manifest(operation, operationId=OP, **changes)), self.env.config, self.env.system)
        self.assertEqual(r["status"], "accepted", r)

    def query(self):
        return handle(self.env.query(OP), self.env.config, self.env.system)

    def test_packages_succeed_only_when_the_planned_versions_are_installed(self):
        self.accept("apply.packages.v1")
        self.assertEqual(run(OP, self.env.config, self.env.system), 0)
        q = self.query()
        self.assertEqual((q["record"]["state"], q["outcome"]), ("finished", "succeeded"))
        self.assertIn("1 of 1 packages at the planned version", q["evidence"])

    def test_exit_code_zero_is_not_success(self):
        self.accept("apply.packages.v1")
        self.env.system.apply_packages = lambda changes: (True, ["fake apt said yes"], None)  # claims success, changes nothing
        run(OP, self.env.config, self.env.system)
        q = self.query()
        self.assertEqual((q["record"]["exitCode"], q["outcome"]), (0, "failed"))

    def test_restart_is_verified_by_a_new_start_time(self):
        self.accept("restart.service.v1")
        run(OP, self.env.config, self.env.system)
        self.assertEqual(self.query()["outcome"], "succeeded")
        self.assertIn(("restart", "nginx.service"), self.env.system.calls)

    def test_reboot_is_settled_by_query_once_a_new_boot_id_is_seen(self):
        self.accept("reboot.host.v1")
        run(OP, self.env.config, self.env.system)
        q = self.query()
        self.assertEqual((q["record"]["state"], q["outcome"]), ("running", None), "the old boot id: not done yet")
        self.env.system.boot = "99999999-2222-3333-4444-555555555555"
        q = self.query()
        self.assertEqual((q["record"]["state"], q["outcome"]), ("finished", "succeeded"))

    def test_the_runner_never_acts_twice(self):
        self.accept("restart.service.v1")
        run(OP, self.env.config, self.env.system)
        run(OP, self.env.config, self.env.system)
        self.assertEqual([c for c in self.env.system.calls if c[0] == "restart"], [("restart", "nginx.service")])

    def test_a_change_between_acceptance_and_start_stops_the_work(self):
        self.accept("restart.service.v1")
        self.env.system.services["nginx.service"]["activeSince"] = "999"
        run(OP, self.env.config, self.env.system)
        q = self.query()
        self.assertEqual(q["outcome"], "failed")
        self.assertNotIn(("restart", "nginx.service"), self.env.system.calls)

    def test_a_finished_record_is_final(self):
        self.accept("restart.service.v1")
        run(OP, self.env.config, self.env.system)
        with self.assertRaises(LedgerError):
            Ledger(self.env.config.ledger_dir, False).update(OP, outcome="succeeded")

    def test_directories_are_created_with_exact_mode_and_existing_ones_are_left_alone(self):
        os.mkdir(self.env.root / "srv" / "app", 0o711)
        self.accept("prepare.directories.v1")
        run(OP, self.env.config, self.env.system)
        self.assertEqual(stat.S_IMODE(os.lstat(self.env.root / "srv" / "app").st_mode), 0o711, "existing: untouched")
        self.assertEqual(stat.S_IMODE(os.lstat(self.env.root / "home" / "owner" / "projects").st_mode), 0o700)
        q = self.query()
        self.assertEqual(q["outcome"], "partially_succeeded", "the existing one does not have the planned mode")
        self.assertTrue(any("left as it is" in e for e in q["evidence"]))

    def test_directories_succeed_when_all_are_created(self):
        self.accept("prepare.directories.v1")
        old = os.umask(0o077)
        try:
            run(OP, self.env.config, self.env.system)
        finally:
            os.umask(old)
        self.assertEqual(stat.S_IMODE(os.lstat(self.env.root / "srv" / "app").st_mode), 0o755, "the umask does not change the mode")
        self.assertEqual(self.query()["outcome"], "succeeded")


class SymlinkTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.outside = self.env.root.parent / "outside"
        self.outside.mkdir()

    def tearDown(self):
        self.env.close()

    def test_a_symlinked_parent_is_refused_and_nothing_is_created_through_it(self):
        os.rmdir(self.env.root / "srv")
        os.symlink(self.outside, self.env.root / "srv")
        with self.assertRaises(PathRefused):
            create_directory(str(self.env.root), "/srv/app", os.getuid(), os.getgid(), 0o755)
        self.assertEqual(os.listdir(self.outside), [])

    def test_a_symlink_at_the_final_path_is_never_followed_or_replaced(self):
        os.symlink(self.outside, self.env.root / "srv" / "app")
        with self.assertRaises(PathRefused):
            create_directory(str(self.env.root), "/srv/app", os.getuid(), os.getgid(), 0o755)
        self.assertTrue(os.path.islink(self.env.root / "srv" / "app"))

    def test_a_parent_swapped_for_a_symlink_mid_walk_is_refused(self):
        # Simulate the race: the walk opens /srv, then /srv/a is replaced by a symlink before it is opened.
        os.mkdir(self.env.root / "srv" / "a")
        import servrsit_helper.paths as paths

        real_open = paths._open_dir

        def racing_open(name, dir_fd):
            if name == "a":
                os.rmdir(self.env.root / "srv" / "a")
                os.symlink(self.outside, self.env.root / "srv" / "a")
            return real_open(name, dir_fd)

        paths._open_dir = racing_open
        try:
            with self.assertRaises(PathRefused):
                create_directory(str(self.env.root), "/srv/a/b", os.getuid(), os.getgid(), 0o755)
        finally:
            paths._open_dir = real_open
        self.assertEqual(os.listdir(self.outside), [])

    def test_a_missing_parent_is_refused_not_created(self):
        with self.assertRaises(PathRefused):
            create_directory(str(self.env.root), "/srv/missing/child", os.getuid(), os.getgid(), 0o755)
        self.assertFalse((self.env.root / "srv" / "missing").exists())


if __name__ == "__main__":
    unittest.main()
