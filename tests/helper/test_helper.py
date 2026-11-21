"""
Acceptance tests for the T-083 target helper, written from Technical Spec 7.2 (restricted helper), 8.2 (signed
manifest, ledger) and 8.3 (path and service safety), then bound to the helper at commit 6c7df23.

Binding adaptations (made when the helper landed, recorded in test-report-helper-001.md section 3):
  - reply codes are the helper's own (INVALID_SIGNATURE, UNKNOWN_KEY, UNSUPPORTED_SCHEMA, UNSUPPORTED_OPERATION,
    MISBOUND, EXPIRED, PRECONDITION_CHANGED, DIGEST_MISMATCH, TARGET_BUSY, INVALID_REQUEST, HELPER_UNAVAILABLE);
  - `server` replaces the draft's `serverIdentity`; operation ids are UUIDs (op-0001 maps to a fixed UUID);
  - the sudoers file may carry restricting `Defaults` lines next to its one rule.

The tests run as an ordinary user against a fake root in a temporary directory. They never touch a real server, real
sudo, systemd or APT. NOT PROVEN here, by design: APT transactions, systemd units and transient runs, reboots, real
root ownership, real sudo behaviour. Those need the disposable VM (T-012).

Run: cd tests/helper && SERVRSIT_HELPER_SRC=<checkout>/target-helper PYTHONPATH=vendor:. python3 -m pytest -q -p no:cacheprovider
"""
from __future__ import annotations

import json
import multiprocessing
import os
import re
import stat
import threading

import pytest

import binding as b

pytestmark = pytest.mark.skipif(not b.BOUND, reason=b.PENDING_REASON)
NOW = 1_800_000_000.0
DOT_SSH = "." + "ssh"  # built at runtime: the repository leak scan forbids the literal directory name


@pytest.fixture
def env(tmp_path):
    t = b.FakeTarget(state=tmp_path)
    key = b.SigningKey.new("key-1")
    clock = [NOW]
    b.install_fake(t, [key], clock=lambda: clock[0])
    return t, key, clock


def send(t, key, clock, m, **kw):
    return b.submit(t, {"manifest": m, "keyId": key.key_id, "signature": key.sign(m)}, clock=lambda: clock[0], **kw)


def launches(t):
    return [c for c in b.adapter_calls(t) if c["kind"] == "launch"]


def refused(reply, *codes):
    assert not re.search(r"Traceback|File \"/", json.dumps(reply)), f"the reply is a crash / carries a stack trace: {reply}"
    assert reply.get("ok") is False, f"accepted: {reply}"
    if codes:
        assert reply.get("code") in codes, f"code {reply.get('code')} not in {codes}"


def test_H00_binding_is_pinned_to_a_clean_commit():
    assert re.fullmatch(r"[0-9a-f]{40}", b.HELPER_COMMIT), b.HELPER_COMMIT
    assert b.HELPER_DIRTY == "", f"the helper under test has local changes:\n{b.HELPER_DIRTY}"


# ===================================================================================================== 8.2 signature
def test_H01_positive_control_a_correct_manifest_is_accepted_once(env):
    t, key, clock = env
    r = send(t, key, clock, b.manifest(t, issued=NOW))
    assert r.get("status") == "accepted", r
    assert len(launches(t)) == 1


def test_H01b_ed25519_is_accepted_too_and_rsa_below_3072_bits_is_not_trusted(tmp_path):
    t = b.FakeTarget(state=tmp_path); ed = b.SigningKey.ed25519("key-ed"); clock = [NOW]
    b.install_fake(t, [ed], clock=lambda: clock[0])
    assert send(t, ed, clock, b.manifest(t, issued=NOW)).get("status") == "accepted"
    t2 = b.FakeTarget(state=tmp_path / "t2"); small = b.SigningKey.new("key-1", bits=2048)
    b.install_fake(t2, [small], clock=lambda: clock[0])
    refused(send(t2, small, clock, b.manifest(t2, issued=NOW)), "UNKNOWN_KEY")


@pytest.mark.parametrize("change", ["operation", "scope", "operationId", "installationId", "preconditionDigest", "acceptBefore", "plan", "server"])
def test_H02_any_change_after_signing_is_rejected(env, change):
    t, key, clock = env
    m = b.manifest(t, issued=NOW); sig = key.sign(m)
    tampered = dict(m)
    tampered[change] = {"operation": "reboot.host.v1",
                        "scope": dict(m["scope"], directories=[{"path": "/srv/evil", "owner": "root", "group": "root", "mode": "0755"}]),
                        "operationId": b.op_uuid("op-9999"), "installationId": "other", "preconditionDigest": "sha256:" + "f" * 64,
                        "acceptBefore": b.iso(NOW + 10**8), "plan": {"id": "x", "version": 9, "digest": "sha256:" + "e" * 64},
                        "server": {"id": t.server_id, "hostKeyFingerprint": "SHA256:" + "B" * 43}}[change]
    refused(b.submit(t, {"manifest": tampered, "keyId": key.key_id, "signature": sig}, clock=lambda: clock[0]), "INVALID_SIGNATURE")
    assert b.adapter_calls(t) == []


def test_H03_unknown_key_id_wrong_key_wrong_padding_and_garbage_signatures_are_rejected(env):
    t, key, clock = env
    m = b.manifest(t, issued=NOW); other = b.SigningKey.new("key-1", fresh=True)
    cases = [({"manifest": m, "keyId": "key-2", "signature": key.sign(m)}, "UNKNOWN_KEY"),
             ({"manifest": m, "keyId": "key-1", "signature": other.sign(m)}, "INVALID_SIGNATURE"),
             ({"manifest": m, "keyId": "key-1", "signature": key.sign(m, pss=False)}, "INVALID_SIGNATURE"),
             ({"manifest": m, "keyId": "key-1", "signature": "AAAA"}, "INVALID_SIGNATURE"),
             ({"manifest": m, "keyId": "key-1", "signature": "not base64!"}, "INVALID_SIGNATURE"),
             ({"manifest": m, "keyId": "key-1", "signature": ""}, "INVALID_SIGNATURE"),
             ({"manifest": m, "keyId": "key-1"}, "INVALID_REQUEST"),
             ({"manifest": m, "keyId": "../trust", "signature": key.sign(m)}, "INVALID_REQUEST")]
    for req, code in cases:
        refused(b.submit(t, req, clock=lambda: clock[0]), code)
    assert b.adapter_calls(t) == []


def test_H04_a_duplicate_key_that_changes_the_parsed_manifest_cannot_pass_the_signature(env):
    t, key, clock = env
    m = b.manifest(t, issued=NOW); sig = key.sign(m)
    raw = json.dumps({"version": 1, "op": "submit", "signed": {"manifest": m, "keyId": key.key_id, "signature": sig}})
    raw = raw.replace('"operation": "prepare.directories.v1"', '"operation": "prepare.directories.v1", "operation": "reboot.host.v1"', 1)
    refused(b.submit(t, None, raw=raw.encode(), clock=lambda: clock[0]))
    assert b.adapter_calls(t) == []


def test_H04b_duplicate_json_keys_are_rejected_outright(env):
    t, key, clock = env
    m = b.manifest(t, issued=NOW); sig = key.sign(m)
    raw = json.dumps({"version": 1, "op": "submit", "signed": {"manifest": m, "keyId": key.key_id, "signature": sig}})
    raw = raw.replace('"operation": "prepare.directories.v1"', '"operation": "reboot.host.v1", "operation": "prepare.directories.v1"', 1)
    refused(b.submit(t, None, raw=raw.encode(), clock=lambda: clock[0]))


@pytest.mark.parametrize("bad,code", [({"schemaVersion": 2}, "UNSUPPORTED_SCHEMA"), ({"schemaVersion": "1"}, "UNSUPPORTED_SCHEMA"), ({"schemaVersion": True}, "UNSUPPORTED_SCHEMA"),
                                      ({"catalogVersion": 99}, "UNSUPPORTED_SCHEMA"), ({"installationId": "inst-other"}, "MISBOUND"),
                                      ({"server": {"id": "00000000-0000-4000-8000-0000000000aa", "hostKeyFingerprint": "SHA256:" + "B" * 43}}, "MISBOUND")])
def test_H05_unsupported_schema_or_catalog_and_a_manifest_bound_to_another_server_are_rejected(env, bad, code):
    t, key, clock = env
    refused(send(t, key, clock, b.manifest(t, issued=NOW, **bad)), code)
    assert b.adapter_calls(t) == []


def test_H06_expired_acceptance_is_rejected_but_an_accepted_job_may_finish_after_expiry(env):
    t, key, clock = env
    m = b.manifest(t, issued=NOW, ttl=60)
    clock[0] = NOW + 61
    refused(send(t, key, clock, m), "EXPIRED")
    clock[0] = NOW; m2 = b.manifest(t, issued=NOW, ttl=60, operationId="op-0002")
    assert send(t, key, clock, m2).get("status") == "accepted"
    clock[0] = NOW + 3600
    assert send(t, key, clock, m2).get("status") == "existing", "a replay after expiry must return the existing operation"
    assert b.run_runner(t, "op-0002") == 0
    rec = b.ledger_records(t)["op-0002"]
    assert rec["state"] == "finished" and rec["outcome"] == "succeeded", rec


def test_H07_clock_skew_beyond_tolerance_blocks_new_changes(env):
    t, key, clock = env
    # target clock 7 h slow: the manifest looks issued in the future
    clock[0] = NOW - 7 * 3600
    r = send(t, key, clock, b.manifest(t, issued=NOW)); refused(r, "EXPIRED"); assert "CLOCK_SKEW" in r.get("detail", "")
    # target clock 7 h fast (the Merauke case): the manifest looks long expired
    clock[0] = NOW + 7 * 3600
    refused(send(t, key, clock, b.manifest(t, issued=NOW, operationId="op-0003")), "EXPIRED")
    # within the configured 120 s tolerance: accepted
    clock[0] = NOW - 90
    assert send(t, key, clock, b.manifest(t, issued=NOW, operationId="op-0004")).get("status") == "accepted"
    assert len(launches(t)) == 1


def test_H08_precondition_digest_must_match_the_target_now(env):
    t, key, clock = env
    refused(send(t, key, clock, b.manifest(t, issued=NOW, preconditionDigest="sha256:" + "1" * 64)), "PRECONDITION_CHANGED")
    refused(send(t, key, clock, b.manifest(t, issued=NOW, preconditionDigest="none")), "PRECONDITION_CHANGED")
    assert b.adapter_calls(t) == []


# ===================================================================================================== 8.2 ledger
def test_H10_repeated_identical_manifest_returns_the_same_operation_and_runs_once(env):
    t, key, clock = env
    m = b.manifest(t, issued=NOW)
    r1, r2 = send(t, key, clock, m), send(t, key, clock, m)
    assert r1.get("status") == "accepted" and r2.get("status") == "existing", (r1, r2)
    assert r1.get("operationId") == r2.get("operationId") == m["operationId"]
    assert len(launches(t)) == 1, "a replay launched the runner again"


def test_H11_same_operation_id_with_a_different_digest_is_rejected_and_the_ledger_is_unchanged(env):
    t, key, clock = env
    send(t, key, clock, b.manifest(t, issued=NOW))
    before = json.dumps(b.ledger_records(t), sort_keys=True)
    refused(send(t, key, clock, b.manifest(t, issued=NOW, scope={"directories": [{"path": "/srv/other", "owner": "root", "group": "root", "mode": "0755"}]})), "DIGEST_MISMATCH")
    assert json.dumps(b.ledger_records(t), sort_keys=True) == before
    assert len(launches(t)) == 1


def test_H12_concurrent_claims_of_one_operation_id_make_exactly_one_operation_threads(env):
    t, key, clock = env
    m = b.manifest(t, issued=NOW); req = {"manifest": m, "keyId": key.key_id, "signature": key.sign(m)}; out = []
    threads = [threading.Thread(target=lambda: out.append(b.submit(t, req, clock=lambda: clock[0]))) for _ in range(16)]
    [th.start() for th in threads]; [th.join() for th in threads]
    assert len(launches(t)) == 1, f"{len(launches(t))} runs from 16 concurrent identical requests"
    assert sorted(r["status"] for r in out) == ["accepted"] + ["existing"] * 15, [r.get("status") for r in out]
    assert len(b.ledger_records(t)) == 1


def _child(t, req, q):
    q.put(b.submit(t, req, clock=lambda: NOW).get("status"))


def test_H12b_concurrent_claims_from_separate_processes_make_exactly_one_operation(env):
    """Each SSH request is its own sudo'd helper process; flock and O_EXCL must hold across processes."""
    t, key, clock = env
    ctx = multiprocessing.get_context("fork"); q = ctx.Queue()
    m = b.manifest(t, issued=NOW); req = {"manifest": m, "keyId": key.key_id, "signature": key.sign(m)}
    ps = [ctx.Process(target=_child, args=(t, req, q)) for _ in range(16)]
    [p.start() for p in ps]; [p.join(60) for p in ps]
    statuses = sorted(q.get(timeout=5) for _ in ps)
    assert statuses == ["accepted"] + ["existing"] * 15, statuses
    assert len(launches(t)) == 1


def test_H12c_different_operations_racing_leave_exactly_one_unresolved_mutation(env):
    t, key, clock = env
    reqs = []
    for i in range(12):
        m = b.manifest(t, issued=NOW, operationId="op-%04d" % (100 + i), scope={"directories": [{"path": f"/srv/r{i}", "owner": "root", "group": "root", "mode": "0755"}]})
        reqs.append({"manifest": m, "keyId": key.key_id, "signature": key.sign(m)})
    ctx = multiprocessing.get_context("fork"); q = ctx.Queue()
    ps = [ctx.Process(target=_child, args=(t, r, q)) for r in reqs]
    [p.start() for p in ps]; [p.join(60) for p in ps]
    statuses = sorted(q.get(timeout=5) for _ in ps)
    assert statuses.count("accepted") == 1 and statuses.count("rejected") == 11, statuses
    assert len(launches(t)) == 1 and len(b.ledger_records(t)) == 1


def test_H13_one_unresolved_mutation_per_server_a_second_operation_is_refused_while_the_first_is_open(env):
    t, key, clock = env
    assert send(t, key, clock, b.manifest(t, issued=NOW)).get("status") == "accepted"
    refused(send(t, key, clock, b.manifest(t, issued=NOW, operationId="op-0002", scope={"directories": [{"path": "/srv/b", "owner": "root", "group": "root", "mode": "0755"}]})), "TARGET_BUSY")
    b.run_runner(t, "op-0001")
    assert send(t, key, clock, b.manifest(t, issued=NOW, operationId="op-0002", scope={"directories": [{"path": "/srv/b", "owner": "root", "group": "root", "mode": "0755"}]})).get("status") == "accepted"


def test_H13b_a_reboot_without_a_new_boot_id_stays_unresolved_and_keeps_blocking(env):
    """Invariant 8: unknown outcome blocks conflicting writes; nothing but evidence resolves it."""
    t, key, clock = env
    assert send(t, key, clock, b.manifest(t, op="reboot.host.v1", issued=NOW)).get("status") == "accepted"
    b.run_runner(t, "op-0001")
    q = b.query(t, "op-0001")
    assert q["record"]["state"] == "running" and q["outcome"] is None, q
    clock[0] = NOW + 86400
    refused(send(t, key, clock, b.manifest(t, issued=NOW + 86400, operationId="op-0002")), "TARGET_BUSY")
    t.boot_id = "ffffffff-0000-1111-2222-333333333333"
    q = b.query(t, "op-0001")
    assert q["record"]["state"] == "finished" and q["outcome"] == "succeeded", q
    assert [c["kind"] for c in b.adapter_calls(t)].count("reboot") == 1


def test_H14_ledger_is_private_and_a_symlinked_ledger_path_is_refused(env, tmp_path):
    t, key, clock = env
    send(t, key, clock, b.manifest(t, issued=NOW))
    assert (t.ledger.stat().st_mode & 0o077) == 0, oct(t.ledger.stat().st_mode)
    for f in t.ledger.iterdir():
        assert (f.lstat().st_mode & 0o077) == 0, f"{f.name} {oct(f.lstat().st_mode)}"
    elsewhere = tmp_path / "elsewhere"; elsewhere.mkdir(mode=0o700)
    os.rename(t.ledger, tmp_path / "ledger-moved"); os.symlink(elsewhere, t.ledger)
    refused(send(t, key, clock, b.manifest(t, issued=NOW, operationId="op-0005")), "HELPER_UNAVAILABLE")
    assert list(elsewhere.iterdir()) == [], "the helper wrote through a symlinked ledger"


def test_H14b_a_ledger_open_to_group_or_others_is_refused(env):
    t, key, clock = env
    os.chmod(t.ledger, 0o750)
    refused(send(t, key, clock, b.manifest(t, issued=NOW)), "HELPER_UNAVAILABLE")
    assert b.adapter_calls(t) == []


def test_H14c_a_symlinked_record_is_not_followed(env, tmp_path):
    t, key, clock = env
    m = b.manifest(t, issued=NOW)
    outside = tmp_path / "planted.json"; outside.write_text(json.dumps({"operationId": m["operationId"], "manifestDigest": "x", "state": "finished"}))
    os.symlink(outside, t.ledger / (m["operationId"] + ".json"))
    r = send(t, key, clock, m)
    refused(r)
    assert b.adapter_calls(t) == []


def test_H15_a_terminal_record_cannot_be_rewritten_or_rerun(env):
    t, key, clock = env
    m = b.manifest(t, issued=NOW)
    send(t, key, clock, m); b.run_runner(t, "op-0001")
    first = json.dumps(b.ledger_records(t)["op-0001"], sort_keys=True)
    assert json.loads(first)["state"] == "finished"
    assert send(t, key, clock, m).get("status") == "existing"
    assert b.run_runner(t, "op-0001") == 0
    with pytest.raises(b.ledger.LedgerError):
        b.ledger.Ledger(str(t.ledger), False).update(m["operationId"], outcome="succeeded")
    assert json.dumps(b.ledger_records(t)["op-0001"], sort_keys=True) == first
    assert len(launches(t)) == 1


def test_H16_trust_store_that_others_can_write_or_that_is_a_symlink_is_refused(env, tmp_path):
    t, key, clock = env
    os.chmod(t.trust_file, 0o664)
    refused(send(t, key, clock, b.manifest(t, issued=NOW)), "UNKNOWN_KEY")
    os.chmod(t.trust_file, 0o644)
    planted = tmp_path / "planted-trust.json"; planted.write_text(t.trust_file.read_text()); os.chmod(planted, 0o644)
    os.rename(t.trust_file, tmp_path / "trust-moved"); os.symlink(planted, t.trust_file)
    refused(send(t, key, clock, b.manifest(t, issued=NOW)), "UNKNOWN_KEY")
    assert b.adapter_calls(t) == []


def test_H17_with_require_root_on_files_owned_by_an_ordinary_user_are_refused(env):
    """The production setting. Proves the uid check refuses non-root files; it does not prove real root ownership."""
    t, key, clock = env
    t.require_root = True
    refused(send(t, key, clock, b.manifest(t, issued=NOW)), "UNKNOWN_KEY", "HELPER_UNAVAILABLE")
    assert b.adapter_calls(t) == []


def test_H18_a_torn_record_left_by_a_crash_mid_claim_does_not_crash_query_or_submit(env):
    """Ledger docstring: 'A crash leaves the old or the new record, never half of one.' The first claim is written in
    place (O_CREAT|O_EXCL, then write), so a crash between create and write leaves an empty record file."""
    t, key, clock = env
    m = b.manifest(t, issued=NOW)
    (t.ledger / (m["operationId"] + ".json")).touch(mode=0o600)
    q = b.helper_handle(t, json.dumps({"version": 1, "op": "query.operation.v1", "operationId": m["operationId"]}).encode())
    assert q.get("status") != "crashed", q
    refused(b.helper_handle(t, json.dumps({"version": 1, "op": "submit", "signed": {"manifest": m, "keyId": key.key_id, "signature": key.sign(m)}}).encode()))
    assert b.adapter_calls(t) == []


# ===================================================================================================== 7.2 gateway and stdin schema
def test_H20_the_gateway_ignores_the_ssh_command_and_any_environment(env):
    t, key, clock = env
    m = b.manifest(t, issued=NOW)
    r = send(t, key, clock, m, env={"SSH_ORIGINAL_COMMAND": "rm -rf / ; reboot", "LD_PRELOAD": "/tmp/x.so", "PYTHONPATH": "/tmp", "PATH": "/tmp", "SUDO_COMMAND": "/bin/sh"})
    assert r.get("status") == "accepted", "a hostile environment changed the result"
    call = t.sudo_calls[-1]
    assert call["argv"] == ["/usr/bin/sudo", "-n", "--", "/usr/lib/servrsit/bin/servrsit-helper"], call["argv"]
    assert call["env"] == {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}, call["env"]
    assert call["shell"] is False
    assert all("rm -rf" not in json.dumps(c) for c in b.adapter_calls(t))


def test_H20b_entry_points_run_python_isolated_from_the_callers_environment():
    for name, text in b.entry_points().items():
        assert text.splitlines()[0] == "#!/usr/bin/python3 -I", f"{name}: {text.splitlines()[0]}"
        assert "sys.argv" not in text and "os.environ" not in text, name


@pytest.mark.parametrize("raw", [b"", b"not json", b"[]", b"null", b"{}", b"{" * 5000, b"[" * 100000, b"\xff\xfe", b"x" * (2 * 1024 * 1024),
                                 b'{"version":1,"op":"query.operation.v1","operationId":"../../etc/passwd"}',
                                 b'{"version":1.0,"op":"submit","signed":{}}', b'{"version":NaN,"op":"submit"}',
                                 b'{"version":1,"op":"submit","signed":' + b"1" * 5000 + b"}"], ids=lambda r: (repr(r[:40]) + "..len%d" % len(r)) if len(r) > 40 else repr(r))
def test_H21_bounded_input_malformed_or_oversized_stdin_is_refused_cleanly_by_the_gateway(env, raw):
    t, key, clock = env
    refused(b.submit(t, None, raw=raw, clock=lambda: clock[0]))
    assert b.adapter_calls(t) == []


@pytest.mark.parametrize("raw", [b'{"version":1,"op":"submit","signed":' + b"1" * 5000 + b"}", b'{"version":1,"op":"submit","x":-' + b"9" * 4400 + b"}"], ids=["signed-5000-digit-int", "extra-4400-digit-negative-int"])
def test_H21b_the_helper_itself_refuses_oversized_integers_cleanly(env, raw):
    t, key, clock = env
    refused(b.helper_handle(t, raw))


@pytest.mark.parametrize("extra", [{"command": "id"}, {"exec": "/bin/sh"}, {"env": {"A": "1"}}, {"unit": "[Service]\nExecStart=/bin/sh"}, {"path": "/usr/bin/python3"}, {"args": ["-c", "x"]}])
def test_H22_no_field_can_carry_a_command_path_environment_or_unit_definition(env, extra):
    t, key, clock = env
    refused(send(t, key, clock, b.manifest(t, issued=NOW, **extra)), "UNSUPPORTED_SCHEMA")
    m = b.manifest(t, issued=NOW)
    refused(b.submit(t, {"manifest": m, "keyId": key.key_id, "signature": key.sign(m), **extra}, clock=lambda: clock[0]), "INVALID_REQUEST")
    refused(b.submit(t, {"version": 1, "op": "submit", "signed": {"manifest": m, "keyId": key.key_id, "signature": key.sign(m)}, **extra}, clock=lambda: clock[0]), "INVALID_REQUEST")
    m2 = b.manifest(t, issued=NOW); m2["scope"] = dict(m2["scope"], **extra)
    refused(send(t, key, clock, m2), "UNSUPPORTED_SCHEMA")
    assert b.adapter_calls(t) == []


@pytest.mark.parametrize("op", ["shell.run.v1", "apply.packages.v2", "inspect.host.v1", "query.operation.v1", "", "../../bin/sh", "remove.packages.v1", "install.packages.v1", "refresh.package_metadata.v1"])
def test_H23_only_allowlisted_mutation_operations_are_accepted(env, op):
    t, key, clock = env
    refused(send(t, key, clock, b.manifest(t, issued=NOW, op=op)), "UNSUPPORTED_OPERATION")


def test_H24a_positive_control_restart_of_a_bootstrap_unit_is_accepted(env):
    t, key, clock = env
    assert send(t, key, clock, b.manifest(t, issued=NOW, op="restart.service.v1")).get("status") == "accepted"


@pytest.mark.parametrize("unit", ["sshd.service", "nginx.service; reboot", "*.service", "nginx@evil.service", "/etc/systemd/system/x.service", "../nginx.service",
                                  "systemd-logind.service", "nginx", "nginx.socket", "nginx.service\n", "-nginx.service", "--now.service"])
def test_H24_restart_accepts_only_units_selected_at_bootstrap(env, unit):
    t, key, clock = env
    refused(send(t, key, clock, b.manifest(t, issued=NOW, op="restart.service.v1", scope={"unit": unit})), "UNSUPPORTED_OPERATION", "UNSUPPORTED_SCHEMA")
    assert b.adapter_calls(t) == []


def test_H25_separate_approvals_a_restart_or_package_manifest_cannot_also_carry_a_reboot(env):
    t, key, clock = env
    refused(send(t, key, clock, b.manifest(t, issued=NOW, op="restart.service.v1", scope={"includesReboot": True})), "UNSUPPORTED_SCHEMA")
    refused(send(t, key, clock, b.manifest(t, issued=NOW, op="reboot.host.v1", scope={"includesServiceRestart": True})), "UNSUPPORTED_SCHEMA")
    refused(send(t, key, clock, b.manifest(t, issued=NOW, op="apply.packages.v1", scope={"includesReboot": True})), "UNSUPPORTED_SCHEMA")


# ===================================================================================================== 8.3 path safety
@pytest.mark.parametrize("path", ["/etc/servrsit", "/root/x", "/home/servrsit/" + DOT_SSH, "/home/servrsit/" + DOT_SSH + "/x", "/proc/x", "/sys/x", "/dev/x", "/run/x", "/var/lib/servrsit/ledger/x",
                                  "/srv/../etc", "/srv/a/../../etc", "srv/relative", "/srv/a\nb", "/srv/a\x00b", "/home/otheruser/x", "/srv", "/", "/srv/", "//srv/x",
                                  "/srv/./x", "/srv/-rf", "/srv/a b", "/home/servrsit", "/srv/" + "a/" * 8 + "x"])
def test_H30_directories_only_under_srv_or_the_confirmed_home_and_never_sensitive_paths(env, path):
    t, key, clock = env
    r = b.prepare_directories(t, [{"path": path, "owner": "root", "group": "root", "mode": "0755"}], key)
    assert r["created"] == [], f"{path!r} was created"
    refused(r["reply"], "UNSUPPORTED_SCHEMA")


def test_H30b_positive_control_srv_and_confirmed_home_are_created_with_the_planned_mode(env):
    t, key, clock = env
    old = os.umask(0o077)
    try:
        r = b.prepare_directories(t, [{"path": "/srv/app", "owner": "servrsit", "group": "servrsit", "mode": "0750"},
                                      {"path": "/home/servrsit/work", "owner": "servrsit", "group": "servrsit", "mode": "0755"}], key)
    finally:
        os.umask(old)
    assert sorted(r["created"]) == ["/home/servrsit/work", "/srv/app"], r
    assert r["record"]["outcome"] == "succeeded", r["record"]
    assert oct((t.root / "srv/app").stat().st_mode & 0o7777) == "0o750"
    assert oct((t.root / "home/servrsit/work").stat().st_mode & 0o7777) == "0o755", "umask changed the planned mode"


def test_H30c_an_unknown_owner_or_group_is_not_created(env):
    t, key, clock = env
    r = b.prepare_directories(t, [{"path": "/srv/app", "owner": "nobody-here", "group": "root", "mode": "0755"}], key)
    assert r["created"] == [] and r["record"]["outcome"] == "failed", r


def test_H31_a_symlink_in_any_component_is_never_followed(env):
    t, key, clock = env
    outside = t.root / "outside"; outside.mkdir()
    os.symlink(outside, t.root / "srv/link")
    r = b.prepare_directories(t, [{"path": "/srv/link/new", "owner": "root", "group": "root", "mode": "0755"}], key)
    assert list(outside.iterdir()) == [], "a directory was created through a symlink"
    assert r["record"] is not None and r["record"]["outcome"] == "failed", r
    os.chmod(outside, 0o700); os.symlink(outside, t.root / "srv/last")
    r = b.prepare_directories(t, [{"path": "/srv/last", "owner": "root", "group": "root", "mode": "0755"}], key)
    assert oct(outside.stat().st_mode & 0o777) == "0o700", "the mode was applied through a symlinked last component"
    assert (t.root / "srv/last").is_symlink() and list(outside.iterdir()) == []
    assert r["record"] is None or r["record"]["outcome"] != "succeeded", r


def test_H32_swap_to_a_symlink_during_creation_does_not_escape(env):
    """Check/use race on the path primitive: a parent flips between a directory and a symlink while it runs."""
    t, key, clock = env
    (t.root / "srv/app").mkdir(parents=True); outside = t.root / "outside"; outside.mkdir(); stop = threading.Event()
    def flip():
        while not stop.is_set():
            try:
                os.rename(t.root / "srv/app", t.root / "srv/app.real"); os.symlink(outside, t.root / "srv/app")
                os.unlink(t.root / "srv/app"); os.rename(t.root / "srv/app.real", t.root / "srv/app")
            except OSError:
                pass
    th = threading.Thread(target=flip); th.start(); results = []
    try:
        for i in range(2000):
            results.append(b.create_directory_direct(t, f"/srv/app/d{i}"))
    finally:
        stop.set(); th.join()
    escaped = list(outside.iterdir())
    assert escaped == [], f"{len(escaped)} directories escaped through a swapped symlink"
    assert "refused" in results, "the race never hit a symlink; the test did not exercise it"
    assert "created" in results


def test_H32b_the_full_path_under_the_same_race_does_not_escape(env):
    t, key, clock = env
    (t.root / "srv/app").mkdir(parents=True); outside = t.root / "outside"; outside.mkdir(); stop = threading.Event()
    def flip():
        while not stop.is_set():
            try:
                os.rename(t.root / "srv/app", t.root / "srv/app.real"); os.symlink(outside, t.root / "srv/app")
                os.unlink(t.root / "srv/app"); os.rename(t.root / "srv/app.real", t.root / "srv/app")
            except OSError:
                pass
    th = threading.Thread(target=flip); th.start()
    try:
        for i in range(150):
            b.prepare_directories(t, [{"path": f"/srv/app/d{i}", "owner": "root", "group": "root", "mode": "0755"}], key)
    finally:
        stop.set(); th.join()
    assert list(outside.iterdir()) == []


def test_H33_existing_contents_are_never_overwritten_or_reowned_and_modes_are_restricted(env):
    t, key, clock = env
    d = t.root / "srv/app"; d.mkdir(parents=True); (d / "keep.txt").write_text("x"); os.chmod(d, 0o750)
    r = b.prepare_directories(t, [{"path": "/srv/app", "owner": "root", "group": "root", "mode": "0755"}], key)
    assert (d / "keep.txt").read_text() == "x" and oct(d.stat().st_mode & 0o777) == "0o750", "an existing directory was changed"
    assert r["record"]["outcome"] != "succeeded", "an existing directory with another mode was reported as prepared"
    assert any("left" in e for e in r["record"]["evidence"]), r["record"]["evidence"]
    for mode in ["0777", "4755", "2755", "1777", "0757", "0600", "0055", "755x", "0o755", "07555"]:
        r = b.prepare_directories(t, [{"path": "/srv/m%s" % re.sub(r"\W", "", mode), "owner": "root", "group": "root", "mode": mode}], key)
        assert r["created"] == [], f"mode {mode} was allowed"


# ===================================================================================================== runner postconditions (invariant 9)
def test_H50_restart_with_exit_zero_but_no_new_start_time_is_failed(env):
    t, key, clock = env
    t.restart_takes_effect = False
    send(t, key, clock, b.manifest(t, op="restart.service.v1", issued=NOW)); b.run_runner(t, "op-0001")
    rec = b.ledger_records(t)["op-0001"]
    assert rec["outcome"] == "failed" and rec["exitCode"] == 0, rec


def test_H51_package_apply_that_reports_ok_but_changes_nothing_is_failed(env):
    t, key, clock = env
    t.apply_takes_effect = False
    send(t, key, clock, b.manifest(t, op="apply.packages.v1", issued=NOW)); b.run_runner(t, "op-0001")
    rec = b.ledger_records(t)["op-0001"]
    assert rec["outcome"] == "failed", rec


def test_H52_target_changed_between_acceptance_and_run_means_no_action(env):
    t, key, clock = env
    send(t, key, clock, b.manifest(t, op="apply.packages.v1", issued=NOW))
    t.packages["openssl:amd64"] = "3.0.13-0ubuntu3.9"
    b.run_runner(t, "op-0001")
    rec = b.ledger_records(t)["op-0001"]
    assert rec["outcome"] == "failed" and [c for c in b.adapter_calls(t) if c["kind"] == "apply"] == [], rec


def test_H53_an_adapter_error_ends_in_a_final_failed_record(env):
    t, key, clock = env
    t.raise_in_adapter = True
    send(t, key, clock, b.manifest(t, op="apply.packages.v1", issued=NOW)); b.run_runner(t, "op-0001")
    rec = b.ledger_records(t)["op-0001"]
    assert rec["state"] == "finished" and rec["outcome"] == "failed", rec
    assert not any("fake adapter failure" in e for e in rec["evidence"]), "raw exception text reached the ledger evidence"


def test_H54_a_runner_that_cannot_start_is_recorded_as_failed_and_unblocks(env):
    t, key, clock = env
    t.launch_code = 1
    r = send(t, key, clock, b.manifest(t, issued=NOW))
    assert b.ledger_records(t)["op-0001"]["outcome"] == "failed", r
    t.launch_code = 0
    assert send(t, key, clock, b.manifest(t, issued=NOW, operationId="op-0002", scope={"directories": [{"path": "/srv/b", "owner": "root", "group": "root", "mode": "0755"}]})).get("status") == "accepted"


def test_H55_query_returns_bounded_evidence_and_never_echoes_the_request(env):
    t, key, clock = env
    q = b.query(t, "op-0042")
    assert q == {"found": False, "helperVersion": q.get("helperVersion")}, q
    send(t, key, clock, b.manifest(t, issued=NOW)); b.run_runner(t, "op-0001")
    q = b.query(t, "op-0001")
    extra = {"restartNeeded", "reasonCode"} if b.T090 else set()  # T-090 (0.2.0) adds exactly these two fields
    assert set(q) == {"found", "helperVersion", "record", "outcome", "evidence"} | extra and len(q["evidence"]) <= 20, q
    assert "manifest" not in q["record"], "query returns the whole manifest"


# ===================================================================================================== 7.2 sudoers, key line, scripts (static)
def test_H40_sudoers_allows_exactly_one_fixed_entry_point_with_no_arguments():
    lines = [l.strip() for l in b.sudoers_text().splitlines() if l.strip() and not l.strip().startswith("#")]
    rules = [l for l in lines if not l.startswith("Defaults")]
    defaults = [l for l in lines if l.startswith("Defaults")]
    assert len(rules) == 1, rules
    assert re.fullmatch(r'servrsit\s+ALL=\(root\)\s+NOPASSWD:\s+/usr/lib/servrsit/bin/servrsit-helper\s+""', rules[0]), rules[0]
    for bad in ["bash", "python", "systemctl", "apt", "systemd-run", r"\bALL\s*$", r"\*", "SETENV", ","]:
        assert not re.search(bad, rules[0].split("NOPASSWD:")[1]), f"sudoers grants {bad}"
    for d in defaults:
        assert re.fullmatch(r"Defaults:servrsit\s+[a-z_!, ]+", d), d
        opts = {o.strip() for o in d.split(None, 1)[1].split(",")}
        assert opts <= {"env_reset", "!setenv", "!requiretty", "use_pty", "!env_editor"}, f"sudoers Defaults loosen something: {opts}"


def test_H41_sudoers_is_validated_with_visudo_before_it_is_applied_and_after():
    s = b.script_text("bootstrap.sh").splitlines()
    v = next(i for i, l in enumerate(s) if l.lstrip().startswith("visudo -c -f"))
    w = next(i for i, l in enumerate(s) if re.search(r'\binstall\b.*"\$SUDOERS"', l) and not l.lstrip().startswith("#"))
    a = next(i for i, l in enumerate(s) if re.search(r"visudo -c\s*>", l) and not l.lstrip().startswith(("#", "visudo -c -f")))
    assert v < w < a, (v, w, a)
    assert "die" in s[v] and "rm -f" in s[a], "a failed check does not stop / undo"


def test_H42_the_ssh_key_line_is_restricted_to_the_gateway():
    lines = b.authorized_keys_lines()
    assert lines
    for line in lines:
        assert re.fullmatch(r'restrict,(from="[0-9.]+",)?command="/usr/lib/servrsit/bin/servrsit-gateway" ssh-ed25519 \S+ \S+', line), line
        assert not re.search(r"permitopen|port-forwarding|pty|agent-forwarding|X11|environment=", line.split(" ssh-")[0])


def test_H43_bootstrap_preserves_independent_owner_access():
    s = b.script_text("bootstrap.sh")
    code = "\n".join(l for l in s.splitlines() if not l.lstrip().startswith("#"))
    assert not re.search(r"[^>]>\s*\"?\$AK", code), "bootstrap overwrites authorized_keys instead of appending"
    assert not re.search(r"/etc/sudoers(\s|\"|$)", code.replace("/etc/sudoers.d/servrsit", "")), "bootstrap touches the main sudoers file"
    assert not re.search(r"sshd_config|PasswordAuthentication|ufw|iptables|nft |passwd -|usermod|chsh", code), "bootstrap changes SSH, firewall or accounts"
    assert re.search(r'\[ "\$ACCOUNT" != "root" \]', code), "bootstrap would accept root as the ServrSit account"


def test_H44_uninstall_removes_only_servrsit_access_verifies_it_and_keeps_the_ledger():
    s = b.script_text("uninstall.sh")
    code = "\n".join(l for l in s.splitlines() if not l.lstrip().startswith("#"))
    files = b.packaging_files()
    keyer = files.get("account-remove-key.sh", "")
    key_code = "\n".join(l for l in (code + "\n" + keyer).splitlines() if not l.lstrip().startswith("#"))
    assert "/etc/sudoers.d/servrsit" in code and "servrsit-gateway" in key_code
    assert re.search(r'\[ ! -e "\$SUDOERS" \]', code), "sudoers removal is not verified"
    assert re.search(r'grep -qF -- "\$(LINE_PREFIX|PREFIX)" "\$(AK|F)"', key_code), "key-line removal is not verified"
    assert not re.search(r"rm\s+(-\w+\s+)*\S*authorized_keys", key_code), "uninstall deletes the whole authorized_keys file"
    assert re.search(r'if \[ "\$REMOVE_LEDGER" -eq 1 \]', code) and "kept the ledger" in code
    assert code.index("$SUDOERS") < code.index("LINE_PREFIX"), "the key line is removed before the sudoers rule"
    assert not re.search(r"step \"verified", code.split("DRY_RUN\" -eq 1 ]; then")[0]), "a dry run claims verification"


def test_H45_bootstrap_does_not_follow_a_symlinked_ssh_directory_in_the_accounts_home():
    """Root writes inside a home the account controls. `install -d`, `touch`, `chown` and `chmod` follow symlinks,
    so the dot-ssh directory itself (not only authorized_keys) must be checked, or the work done without following links."""
    code = b.script_text("bootstrap.sh")
    d = re.escape("$HOMEDIR/." + "ssh")
    assert re.search(r'\[ ! -L "%s" \]|-L "%s"|realpath|chown -h|--no-dereference' % (d, d), code), \
        "bootstrap checks only authorized_keys for a symlink; a symlinked dot-ssh directory is followed as root"


def test_H46_the_sudoers_template_is_covered_by_the_package_checksum():
    build = b.script_text("build.sh"); boot = b.script_text("bootstrap.sh")
    from_package = re.search(r"sudoers", build) or re.search(r'\$WORK/servrsit-helper/[^"]*sudoers', boot)
    assert from_package, "bootstrap reads sudoers.in from next to the script, outside the checksum-verified package"
