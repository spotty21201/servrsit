"""submit and query through handle(): every refusal happens before anything runs."""

import json
import os
import unittest

from support import Env

from servrsit_helper.helper import handle

OP = "00000000-0000-4000-8000-0000000003b1"


class SubmitTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def submit(self, manifest, **kw):
        return handle(self.env.request(manifest, **kw), self.env.config, self.env.system)

    def launches(self):
        return [c for c in self.env.system.calls if c[0] == "launch"]

    def test_valid_manifest_is_accepted_once_and_the_runner_is_started(self):
        m = self.env.manifest("restart.service.v1", operationId=OP)
        r = self.submit(m)
        self.assertEqual(r["status"], "accepted")
        self.assertEqual(r["record"], {"operationId": OP, "manifestDigest": r["record"]["manifestDigest"], "state": "running", "exitCode": None})
        self.assertEqual(self.launches(), [("launch", OP)])

    def test_replay_returns_the_existing_operation_even_after_expiry_and_never_starts_it_again(self):
        m = self.env.manifest("restart.service.v1", operationId=OP)
        first = self.submit(m)
        self.env.system.clock = "2026-11-18T10:00:00.000Z"
        again = self.submit(m)
        self.assertEqual(again["status"], "existing")
        self.assertEqual(again["record"], first["record"])
        self.assertEqual(len(self.launches()), 1)

    def test_same_operation_id_with_another_digest_is_refused(self):
        self.submit(self.env.manifest("restart.service.v1", operationId=OP))
        other = self.env.manifest("reboot.host.v1", operationId=OP)
        self.assertEqual(self.submit(other), {"status": "rejected", "code": "DIGEST_MISMATCH"})
        self.assertEqual(len(self.launches()), 1)

    def test_invalid_signature_unknown_key_and_garbage_are_refused(self):
        m = self.env.manifest("reboot.host.v1", operationId=OP)
        req = json.loads(self.env.request(m))
        req["signed"]["manifest"]["scope"]["includesServiceRestart"] = True  # tamper after signing
        self.assertEqual(handle(json.dumps(req).encode(), self.env.config, self.env.system)["code"], "INVALID_SIGNATURE")
        self.assertEqual(self.submit(m, key_id="nobody")["code"], "UNKNOWN_KEY")
        req = json.loads(self.env.request(m))
        req["signed"]["signature"] = "not base64!"
        self.assertEqual(handle(json.dumps(req).encode(), self.env.config, self.env.system)["code"], "INVALID_SIGNATURE")
        self.assertEqual(self.launches(), [])

    def test_misbound_expired_future_and_unsupported_manifests_are_refused(self):
        cases = [
            (self.env.manifest("reboot.host.v1", operationId=OP, installationId="someone-else"), "MISBOUND"),
            (self.env.manifest("reboot.host.v1", operationId=OP, server={"id": "00000000-0000-4000-8000-0000000000f1", "hostKeyFingerprint": "SHA256:" + "Z" * 43}), "MISBOUND"),
            (self.env.manifest("reboot.host.v1", operationId=OP, acceptBefore="2026-11-17T09:59:59.000Z"), "EXPIRED"),
            (self.env.manifest("reboot.host.v1", operationId=OP, issuedAt="2026-11-17T10:05:00.000Z"), "EXPIRED"),
            (self.env.manifest("reboot.host.v1", operationId=OP, schemaVersion=2), "UNSUPPORTED_SCHEMA"),
            (self.env.manifest("reboot.host.v1", operationId=OP, catalogVersion=True), "UNSUPPORTED_SCHEMA"),
            (self.env.manifest("reboot.host.v1", operationId=OP, preconditionDigest="none"), "PRECONDITION_CHANGED"),
            (self.env.manifest("reboot.host.v1", operationId=OP, preconditionDigest="sha256:" + "0" * 64), "PRECONDITION_CHANGED"),
        ]
        for m, code in cases:
            with self.subTest(code=code, m=m.get("installationId")):
                self.assertEqual(self.submit(m)["code"], code)
        future = self.submit(self.env.manifest("reboot.host.v1", operationId=OP, issuedAt="2026-11-17T10:05:00.000Z"))
        self.assertIn("CLOCK_SKEW", future["detail"])
        self.assertEqual(self.launches(), [])

    def test_a_signed_but_unknown_operation_is_refused(self):
        m = self.env.manifest("reboot.host.v1", operationId=OP)
        m["operation"] = "run.shell.v1"
        self.assertEqual(self.submit(m)["code"], "UNSUPPORTED_OPERATION")

    def test_restart_only_for_units_this_server_allows(self):
        m = self.env.manifest("restart.service.v1", operationId=OP)
        m["scope"]["unit"] = m["verification"]["unit"] = "ssh.service"
        self.env.system.services["ssh.service"] = {"active": True, "activeSince": "1"}
        r = self.submit(self.env.manifest("restart.service.v1", operationId=OP, scope=m["scope"], verification=m["verification"]))
        self.assertEqual(r["code"], "UNSUPPORTED_OPERATION")

    def test_one_unresolved_mutation_per_server(self):
        self.submit(self.env.manifest("restart.service.v1", operationId=OP))
        r = self.submit(self.env.manifest("reboot.host.v1", operationId="00000000-0000-4000-8000-0000000003b2"))
        self.assertEqual(r["code"], "TARGET_BUSY")

    def test_injection_strings_never_pass_the_schema(self):
        hostile_units = ["nginx.service; rm -rf /", "$(id).service", "`id`.service", "../../etc/passwd.service", "nginx.service\nExecStart=/bin/sh", "-nginx.service", "nginx.socket"]
        for unit in hostile_units:
            m = self.env.manifest("restart.service.v1", operationId=OP, preconditionDigest="sha256:" + "0" * 64)
            m["scope"]["unit"] = m["verification"]["unit"] = unit
            with self.subTest(unit=unit):
                self.assertEqual(self.submit(m)["code"], "UNSUPPORTED_SCHEMA")
        hostile_paths = ["/srv/../etc", "/etc/sudoers.d/x", "/srv/app/.ssh", "/home/owner/.ssh", "/srv//app", "/srv/app;id", "/home/other/x", "/srv", "/proc/x"]
        for path in hostile_paths:
            m = self.env.manifest("prepare.directories.v1", operationId=OP, preconditionDigest="sha256:" + "0" * 64)
            d = {"path": path, "owner": "deploy", "group": "deploy", "mode": "0755"}
            m["scope"]["requested"] = m["scope"]["directories"] = [d]
            m["verification"]["expectDirectories"] = [d]
            with self.subTest(path=path):
                self.assertEqual(self.submit(m)["code"], "UNSUPPORTED_SCHEMA")
        for bad in ({"name": "openssl; id", "arch": "amd64", "from": "1", "to": "2"}, {"name": "openssl", "arch": "amd64", "from": "1", "to": "2 && id"},
                    {"name": "openssl", "arch": "amd64", "from": "1", "to": "2", "command": "id"}):
            m = self.env.manifest("apply.packages.v1", operationId=OP, preconditionDigest="sha256:" + "0" * 64)
            m["scope"]["packages"] = [bad]
            with self.subTest(pkg=bad):
                self.assertEqual(self.submit(m)["code"], "UNSUPPORTED_SCHEMA")
        m = self.env.manifest("reboot.host.v1", operationId=OP)
        m["command"] = "/bin/sh"
        self.assertEqual(self.submit(m)["code"], "UNSUPPORTED_SCHEMA")
        self.assertEqual(self.launches(), [])

    def test_malformed_requests_are_refused_without_echo(self):
        for raw in [b"", b"not json", b"[]", b'{"version":1,"op":"shell","cmd":"id"}', b'{"version":true,"op":"query.operation.v1","operationId":"x"}',
                    b"[" * 100000, b'{"version":1,"op":"query.operation.v1","operationId":"../../etc/shadow"}', b"x" * (256 * 1024 + 1)]:
            with self.subTest(raw=raw[:30]):
                r = handle(raw, self.env.config, self.env.system)
                self.assertEqual(r["status"], "rejected")
                self.assertEqual(r["code"], "INVALID_REQUEST")
                self.assertNotIn("etc/shadow", json.dumps(r))

    def test_a_trust_file_writable_by_others_is_not_used(self):
        os.chmod(self.env.trust_file, 0o666)
        r = self.submit(self.env.manifest("reboot.host.v1", operationId=OP))
        self.assertEqual(r["code"], "UNKNOWN_KEY")
        self.assertEqual(self.launches(), [])

    def test_if_the_runner_cannot_start_the_operation_ends_failed_and_says_nothing_changed(self):
        self.env.system.launch_code = 1
        r = self.submit(self.env.manifest("reboot.host.v1", operationId=OP))
        self.assertEqual(r["record"]["state"], "finished")
        q = handle(self.env.query(OP), self.env.config, self.env.system)
        self.assertEqual(q["outcome"], "failed")
        self.assertIn("nothing was changed", q["evidence"][-1])

    def test_query_unknown_operation(self):
        self.assertEqual(handle(self.env.query(OP), self.env.config, self.env.system)["found"], False)


if __name__ == "__main__":
    unittest.main()
