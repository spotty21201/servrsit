/**
 * Dispatcher: moves an approved operation through the remote ledger.
 *
 * Rules (execution-security steering):
 *  - Before every send: check the write gate, the target kind, the stored
 *    intent record and (if not yet accepted) the plan's expiry.
 *  - Retries query the SAME operation id first (invariant 7). The id is never
 *    regenerated. A resubmission happens only after the ledger itself answers
 *    "not found", and sends the identical manifest (same issuedAt, same
 *    digest).
 *  - A transport failure is never evidence (invariant 6): while running it
 *    makes the outcome unknown, never "failed" or "cancelled".
 *  - Outcome unknown blocks conflicting writes (the store's unique index) and
 *    is left only by reconciliation against the ledger (invariant 8).
 *  - Success needs independent verification of installed versions; the exit
 *    status alone is never enough (invariant 9).
 *  - A lease is only coordination: an expired lease leads the next worker to
 *    reconcile the same operation, never to start a new one.
 */

import {
  buildManifest,
  digestOf,
  isExpired,
  signManifest,
  type Plan,
  type Signer,
} from "@servrsit/domain";
import type { CareStore, IntentStore, StoredOperation } from "@servrsit/store";
import { TransportError, type RemoteRecord, type WriteTarget } from "./target.js";

export interface DispatcherOptions {
  readonly store: CareStore;
  readonly intents: IntentStore;
  readonly targets: ReadonlyMap<string, WriteTarget>;
  /** The write gate, read from configuration on every use. */
  readonly writesEnabled: (serverId: string) => boolean;
  readonly signer: Signer;
  readonly installationId: string;
  readonly workerId: string;
  readonly now: () => Date;
  readonly leaseMs?: number;
}

export type StepResult =
  | { readonly status: "idle" }
  | { readonly status: "progress" | "final"; readonly operationId: string; readonly state: StoredOperation["state"] };

const ACTOR = (id: string) => `worker:${id}`;

export class Dispatcher {
  private readonly leaseMs: number;

  constructor(private readonly o: DispatcherOptions) {
    this.leaseMs = o.leaseMs ?? 30_000;
  }

  /** Lease one outbox entry, advance its operation one step, and release or complete it. */
  async runOnce(): Promise<StepResult> {
    const now = this.o.now();
    const entry = this.o.store.leaseOutbox(this.o.workerId, now, this.leaseMs);
    if (entry === null) return { status: "idle" };
    const op = await this.step(entry.operationId);
    if (op.state === "succeeded" || op.state === "partially_succeeded" || op.state === "failed" || op.state === "cancelled_before_start") {
      this.o.store.completeOutbox(entry.id, this.o.workerId);
      return { status: "final", operationId: op.id, state: op.state };
    }
    this.o.store.releaseOutbox(entry.id, this.o.workerId);
    return { status: "progress", operationId: op.id, state: op.state };
  }

  /** Run until the operation is final or `max` steps have passed. */
  async drain(max = 20): Promise<StepResult> {
    let last: StepResult = { status: "idle" };
    for (let i = 0; i < max; i++) {
      const r = await this.runOnce();
      if (r.status === "idle") return last;
      last = r;
      if (r.status === "final") return r;
    }
    return last;
  }

  private transition(op: StoredOperation, to: StoredOperation["state"], event: Parameters<CareStore["transition"]>[2], payload: Record<string, unknown>): StoredOperation {
    return this.o.store.transition(op.id, to, event, ACTOR(this.o.workerId), payload, this.o.now());
  }

  private event(op: StoredOperation, type: Parameters<CareStore["appendEvent"]>[1], payload: Record<string, unknown>): void {
    this.o.store.appendEvent(op.id, type, ACTOR(this.o.workerId), payload, this.o.now());
  }

  /** The first dispatch attempt's issue time, if any. Retries reuse it so the manifest is identical. */
  private firstAttempt(op: StoredOperation): string | null {
    const e = this.o.store.listEvents(op.id).find((ev) => ev.type === "dispatch_attempted");
    const at = e?.payload["issuedAt"];
    return typeof at === "string" ? at : null;
  }

  async step(operationId: string): Promise<StoredOperation> {
    const op = this.o.store.getOperation(operationId);
    if (op === null) throw new Error("operation not found");
    const plan = this.o.store.getPlan(op.planId, op.planVersion);
    if (plan === null) throw new Error("plan not found");

    switch (op.state) {
      case "queued":
        return this.dispatch(op, plan);
      case "running":
      case "outcome_unknown":
        return this.observe(op);
      case "verifying":
        return this.verify(op, plan);
      default:
        return op;
    }
  }

  private async dispatch(op: StoredOperation, plan: Plan): Promise<StoredOperation> {
    const target = this.o.targets.get(op.serverId);
    const issuedAt = this.firstAttempt(op);
    const attempted = issuedAt !== null;

    // Gate, target and kind: refuse before anything is sent.
    if (!this.o.writesEnabled(op.serverId) || target === undefined || target.kind !== op.targetKind || target.kind !== "simulated") {
      if (!attempted) {
        return this.transition(op, "cancelled_before_start", "cancelled", {
          code: "WRITES_DISABLED",
          effects: "none: nothing was sent",
        });
      }
      return this.transition(op, "outcome_unknown", "outcome_unknown", {
        code: "WRITES_DISABLED",
        reason: "a previous attempt may have reached the target; it cannot be queried",
      });
    }

    // A previous attempt may have reached the target: ask the ledger first.
    if (attempted) {
      try {
        const q = await target.query(op.id);
        if (q.found) return this.accepted(op, q.record, "reconciled-before-retry");
      } catch (error) {
        if (!(error instanceof TransportError)) throw error;
        return this.transition(op, "outcome_unknown", "outcome_unknown", {
          reason: "a previous attempt may have reached the target and the ledger cannot be queried",
        });
      }
      // The ledger says it never claimed this id: resubmit the identical manifest below.
    } else if (isExpired(plan, this.o.now())) {
      return this.transition(op, "cancelled_before_start", "cancelled", { code: "PLAN_EXPIRED", effects: "none: nothing was sent" });
    }

    // Intent record must be durable before dispatch (Technical Spec §9.2).
    const intent = { operationId: op.id, approvalId: op.approvalId, plan: { id: plan.id, version: plan.version, digest: plan.digest } };
    this.o.intents.put(op.id, digestOf(intent), intent);

    const issued = issuedAt ?? this.o.now().toISOString();
    const { manifest, digest } = buildManifest({
      installationId: this.o.installationId,
      operationId: op.id,
      plan,
      hostKeyFingerprint: target.hostKeyFingerprint,
      issuedAt: new Date(issued),
    });
    const signed = signManifest(manifest, this.o.signer);
    this.event(op, "dispatch_attempted", { issuedAt: issued, manifestDigest: digest, retry: attempted });

    let result;
    try {
      result = await target.submit(signed);
    } catch (error) {
      if (!(error instanceof TransportError)) throw error;
      this.event(op, "transport_error", { during: "submit" });
      // The send may or may not have arrived. Query the same id now.
      try {
        const q = await target.query(op.id);
        if (q.found) return this.accepted(op, q.record, "lost-ack");
        return this.o.store.getOperation(op.id) as StoredOperation;
      } catch (queryError) {
        if (!(queryError instanceof TransportError)) throw queryError;
        return this.transition(op, "outcome_unknown", "outcome_unknown", { reason: "submit and query both failed" });
      }
    }

    if (result.status === "rejected") {
      return this.transition(op, "failed", "remote_rejected", { code: result.code, effects: "none: the target did not accept the operation" });
    }
    return this.accepted(op, result.record, result.status);
  }

  private accepted(op: StoredOperation, record: RemoteRecord, how: string): StoredOperation {
    this.o.store.setRemoteOperationId(op.id, record.operationId, this.o.now());
    const current = this.o.store.getOperation(op.id) as StoredOperation;
    if (current.state === "queued") {
      return this.transition(current, "running", "remote_accepted", { how, remoteState: record.state });
    }
    return current;
  }

  private async observe(op: StoredOperation): Promise<StoredOperation> {
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

  private async verify(op: StoredOperation, plan: Plan): Promise<StoredOperation> {
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
}
