/**
 * Reconciler: brings an operation record in line with the target's own ledger
 * and its installed state. READ-ONLY toward the target: it only queries the
 * ledger and inspects installed versions. It never submits, retries or stops
 * anything (T-055, Tech Spec §13, FR-17).
 *
 * The Dispatcher uses it for every non-dispatch step; the API's reconcile
 * route uses it directly, so a reconcile request can never start a mutation.
 */

import type { Plan } from "@servrsit/domain";
import type { CareStore, StoredOperation } from "@servrsit/store";
import { TransportError, type RemoteRecord, type WriteTarget } from "./target.js";

export interface ReconcilerOptions {
  readonly store: CareStore;
  readonly targets: ReadonlyMap<string, WriteTarget>;
  /** Who is recorded on events, for example "worker:w1" or "owner:api". */
  readonly actor: string;
  readonly now: () => Date;
}

export class Reconciler {
  constructor(private readonly o: ReconcilerOptions) {}

  private transition(op: StoredOperation, to: StoredOperation["state"], event: Parameters<CareStore["transition"]>[2], payload: Record<string, unknown>): StoredOperation {
    return this.o.store.transition(op.id, to, event, this.o.actor, payload, this.o.now());
  }

  private event(op: StoredOperation, type: Parameters<CareStore["appendEvent"]>[1], payload: Record<string, unknown>): void {
    this.o.store.appendEvent(op.id, type, this.o.actor, payload, this.o.now());
  }

  /** The ledger shows the target accepted the operation. */
  accepted(op: StoredOperation, record: RemoteRecord, how: string): StoredOperation {
    this.o.store.setRemoteOperationId(op.id, record.operationId, this.o.now());
    const current = this.o.store.getOperation(op.id) as StoredOperation;
    if (current.state === "queued") {
      return this.transition(current, "running", "remote_accepted", { how, remoteState: record.state });
    }
    return current;
  }

  /** Running or outcome unknown: follow the ledger. */
  async observe(op: StoredOperation): Promise<StoredOperation> {
    const target = this.o.targets.get(op.serverId);
    if (target === undefined) return op;
    let q;
    try {
      q = await target.query(op.id);
    } catch (error) {
      if (!(error instanceof TransportError)) throw error;
      // Invariant 6: a lost connection is not evidence the work stopped.
      if (op.state === "running") {
        return this.transition(op, "outcome_unknown", "outcome_unknown", { reason: "the ledger could not be queried" });
      }
      this.event(op, "transport_error", { during: "reconcile" });
      return op;
    }

    if (!q.found) {
      if (op.state === "running") {
        return this.transition(op, "outcome_unknown", "outcome_unknown", { reason: "the ledger has no record of an accepted operation" });
      }
      return op;
    }

    const record = q.record;
    if (record.state === "running") {
      if (op.state === "outcome_unknown") return this.transition(op, "running", "reconciled", { remoteState: "running" });
      this.event(op, "remote_progress", { remoteState: "running" });
      return op;
    }
    const via = op.state === "outcome_unknown" ? "reconciled" : "remote_finished";
    return this.transition(op, "verifying", via, { remoteState: "finished", exitCode: record.exitCode });
  }

  /** Verifying: check installed versions independently (invariant 9). */
  async verify(op: StoredOperation, plan: Plan): Promise<StoredOperation> {
    const target = this.o.targets.get(op.serverId);
    if (target === undefined) return op;
    const expected = plan.verification.expectInstalled;
    const keys = Object.keys(expected);
    let actual;
    try {
      actual = await target.inspectInstalled(keys);
    } catch (error) {
      if (!(error instanceof TransportError)) throw error;
      this.event(op, "transport_error", { during: "verification" });
      return op;
    }
    const verified = keys.filter((k) => actual[k] === expected[k]);
    const notVerified = keys.filter((k) => actual[k] !== expected[k]);
    const exitCode = this.lastExitCode(op);
    const payload = { verified, notVerified, exitCode };
    if (notVerified.length === 0 && exitCode === 0) return this.transition(op, "succeeded", "verification_recorded", payload);
    if (verified.length === 0) return this.transition(op, "failed", "verification_recorded", payload);
    return this.transition(op, "partially_succeeded", "verification_recorded", payload);
  }

  private lastExitCode(op: StoredOperation): number | null {
    const events = this.o.store.listEvents(op.id);
    for (let i = events.length - 1; i >= 0; i--) {
      const code = events[i]?.payload["exitCode"];
      if (typeof code === "number") return code;
    }
    return null;
  }

  /**
   * One read-only reconciliation step for any operation. A queued operation is
   * only looked up in the ledger: if the target already holds it, it becomes
   * running; if not, it stays queued (nothing is sent from here). A final
   * operation is returned unchanged; later evidence would be an appended event.
   */
  async reconcile(operationId: string): Promise<StoredOperation> {
    const op = this.o.store.getOperation(operationId);
    if (op === null) throw new Error("operation not found");
    const plan = this.o.store.getPlan(op.planId, op.planVersion);
    if (plan === null) throw new Error("plan not found");
    switch (op.state) {
      case "queued": {
        const target = this.o.targets.get(op.serverId);
        if (target === undefined) return op;
        try {
          const q = await target.query(op.id);
          return q.found ? this.accepted(op, q.record, "reconciled") : op;
        } catch (error) {
          if (!(error instanceof TransportError)) throw error;
          this.event(op, "transport_error", { during: "reconcile" });
          return op;
        }
      }
      case "running":
      case "outcome_unknown":
        return this.observe(op);
      case "verifying":
        return this.verify(op, plan);
      default:
        return op;
    }
  }
}
