"""Ledger atomicity across processes, symlink refusal, crash leftovers."""

import multiprocessing
import os
import tempfile
import unittest

from servrsit_helper.ledger import Ledger, LedgerError

OP = "00000000-0000-4000-8000-0000000005d1"


def _claim(directory, digest, out):
    out.put(Ledger(directory, False).claim(OP, digest, {"m": digest}, "2026-11-17T10:00:00.000Z")[0])


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = os.path.join(self.tmp.name, "ledger")
        os.mkdir(self.dir, 0o700)

    def tearDown(self):
        self.tmp.cleanup()

    def test_racing_processes_claim_one_operation_exactly_once(self):
        q = multiprocessing.get_context("fork").Queue()
        procs = [multiprocessing.get_context("fork").Process(target=_claim, args=(self.dir, "sha256:" + "a" * 64, q)) for _ in range(12)]
        for p in procs:
            p.start()
        for p in procs:
            p.join(10)
        results = sorted(q.get(timeout=5) for _ in procs)
        self.assertEqual(results.count("accepted"), 1)
        self.assertEqual(results.count("existing"), 11)

    def test_racing_different_digests_for_one_id_yield_one_accepted_and_mismatches(self):
        q = multiprocessing.get_context("fork").Queue()
        procs = [multiprocessing.get_context("fork").Process(target=_claim, args=(self.dir, "sha256:" + ("%x" % i) * 64, q)) for i in range(6)]
        for p in procs:
            p.start()
        for p in procs:
            p.join(10)
        results = [q.get(timeout=5) for _ in procs]
        self.assertEqual(results.count("accepted"), 1)
        self.assertEqual(results.count("DIGEST_MISMATCH"), 5)

    def test_a_symlinked_record_is_not_followed(self):
        target = os.path.join(self.tmp.name, "elsewhere.json")
        with open(target, "w") as f:
            f.write('{"operationId": "x", "manifestDigest": "y", "state": "finished"}')
        os.symlink(target, os.path.join(self.dir, OP + ".json"))
        with self.assertRaises(OSError):
            Ledger(self.dir, False).get(OP)

    def test_a_leftover_temporary_file_from_a_crash_does_not_block_updates(self):
        led = Ledger(self.dir, False)
        led.claim(OP, "sha256:" + "a" * 64, {}, "t")
        with open(os.path.join(self.dir, OP + ".json.tmp"), "w") as f:
            f.write("half a rec")
        self.assertEqual(led.update(OP, state="running")["state"], "running")

    def test_an_open_ledger_directory_is_refused(self):
        os.chmod(self.dir, 0o755)
        with self.assertRaises(LedgerError):
            Ledger(self.dir, False)

    def test_evidence_is_bounded(self):
        led = Ledger(self.dir, False)
        led.claim(OP, "sha256:" + "a" * 64, {}, "t")
        rec = led.update(OP, evidence=["x" * 1000] * 80)
        self.assertEqual(len(rec["evidence"]), 50)
        self.assertEqual(len(rec["evidence"][0]), 300)


if __name__ == "__main__":
    unittest.main()
