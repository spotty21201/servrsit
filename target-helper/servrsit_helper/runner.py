"""The transient-unit runner: `servrsit-runner <operationId>`, started only by
the helper through systemd-run, as root, for an operation the helper already
accepted. It survives the SSH session ending (invariant 6).

It rechecks the precondition just before acting, runs the one adapter for the
manifest's operation, and records the verified outcome. A finished record is
never changed again.
"""

import sys

from .adapters import RealSystem, System, precondition_digest, run_operation
from .helper import Config, load_config
from .ledger import FINAL, Ledger
from .schema import OPERATION_ID


def run(operation_id: str, config: Config, system: System) -> int:
    if not OPERATION_ID.fullmatch(operation_id):
        return 2
    ledger = Ledger(config.ledger_dir, config.require_root)
    record = ledger.get(operation_id)
    if record is None or record["state"] != "accepted":
        # Started twice, or already done: never act again.
        return 0
    manifest = record["manifest"]
    ledger.update(operation_id, state="running", startedAt=system.now())
    if precondition_digest(system, manifest) != manifest["preconditionDigest"]:
        ledger.update(operation_id, state=FINAL, outcome="failed", finishedAt=system.now(),
                      evidence=["the server changed after the plan was accepted; nothing was changed"])
        return 0
    try:
        result = run_operation(system, manifest, config.restartable_units)
    except Exception as e:  # noqa: BLE001 - every failure must end in a final ledger record
        ledger.update(operation_id, state=FINAL, outcome="failed", finishedAt=system.now(),
                      evidence=["the adapter stopped with an error (%s); check the server before trying again" % type(e).__name__])
        return 1
    if result["outcome"] is None:
        # Reboot: settled by query once a new boot id is seen.
        ledger.update(operation_id, exitCode=result["exitCode"], evidence=result["evidence"])
        return 0
    ledger.update(operation_id, state=FINAL, outcome=result["outcome"], exitCode=result["exitCode"], finishedAt=system.now(),
                  restartNeeded=result.get("restartNeeded", []), evidence=result["evidence"])
    return 0


def main() -> int:
    if len(sys.argv) != 2:
        return 2
    return run(sys.argv[1], load_config(), RealSystem())
