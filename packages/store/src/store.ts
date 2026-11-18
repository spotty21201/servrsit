/**
 * Care-loop repository interface (ADR-015). Implementations: SqliteCareStore.
 * A PostgreSQL implementation can replace it without changing callers.
 */

import type { EventType, OperationId, OpState, Plan } from "@servrsit/domain";

export type TargetKind = "simulated" | "ssh";

export interface StoredOperation {
  readonly id: string;
  readonly approvalId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly serverId: string;
  readonly operation: OperationId;
  readonly targetKind: TargetKind;
  readonly state: OpState;
  readonly stopRequested: boolean;
  readonly remoteOperationId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OperationEvent {
  readonly operationId: string;
  readonly seq: number;
  readonly type: EventType;
  readonly at: string;
  readonly actor: string;
  readonly fromState: OpState | null;
  readonly toState: OpState | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface OutboxEntry {
  readonly id: string;
  readonly operationId: string;
  /** Digest of the intent record this entry dispatches. */
  readonly intentDigest: string;
  readonly status: "pending" | "leased" | "done";
  readonly attempts: number;
  readonly leaseOwner: string | null;
  readonly leaseUntil: string | null;
}

export type ApprovalRejection =
  | "PLAN_NOT_FOUND"
  | "PLAN_CHANGED"
  | "PLAN_EXPIRED"
  | "PLAN_BLOCKED"
  | "WRITES_DISABLED"
  | "ACK_REQUIRED"
  | "TARGET_BUSY"
  | "OUTCOME_UNKNOWN"
  | "ALREADY_APPROVED";

export interface ApproveInput {
  readonly planId: string;
  readonly planVersion: number;
  readonly planDigest: string;
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly acknowledgements: readonly string[];
  /** Current value of the server's write gate, from configuration (never from the request). */
  readonly writesEnabled: boolean;
  readonly targetKind: TargetKind;
  readonly now: Date;
  readonly newId: () => string;
}

export type ApproveResult =
  | { readonly kind: "created"; readonly operation: StoredOperation }
  | { readonly kind: "replayed"; readonly operation: StoredOperation }
  | { readonly kind: "rejected"; readonly code: ApprovalRejection; readonly blockers?: readonly string[] };

export interface CareStore {
  insertPlan(plan: Plan): void;
  /** Latest version of a plan, or a specific version. */
  getPlan(id: string, version?: number): Plan | null;
  /** The single unresolved operation for a server, if any. */
  unresolvedFor(serverId: string): StoredOperation | null;
  /**
   * One transaction: checks, approval, operation (queued), "created" event and
   * dispatch-outbox entry. All or nothing.
   */
  approve(input: ApproveInput): ApproveResult;
  /** Whether this plan version already has an approval (a repeat request is then an idempotent replay). */
  hasApproval(planId: string, planVersion: number): boolean;
  getOperation(id: string): StoredOperation | null;
  listEvents(operationId: string): OperationEvent[];
  /** Validated state change plus its event, atomically. Throws TransitionError. */
  transition(
    operationId: string,
    to: OpState,
    event: EventType,
    actor: string,
    payload: Record<string, unknown>,
    now: Date,
  ): StoredOperation;
  /** An event with no state change (evidence, progress, attempts). */
  appendEvent(operationId: string, event: EventType, actor: string, payload: Record<string, unknown>, now: Date): void;
  setRemoteOperationId(operationId: string, remoteId: string, now: Date): void;
  /** Lease one dispatchable entry (pending, or leased with an expired lease). */
  leaseOutbox(worker: string, now: Date, leaseMs: number): OutboxEntry | null;
  completeOutbox(id: string, worker: string): void;
  /** Give a leased entry back for another round (the work is not finished). */
  releaseOutbox(id: string, worker: string): void;
  close(): void;
}

/**
 * Write-once store for approval/intent records. Technical Spec §9.2 puts these
 * off-instance (S3 with conditional writes). Locally it is a separate
 * directory with exclusive-create files (ADR-015).
 */
export interface IntentStore {
  /** Create once. Returns "exists" if the same key already holds the same digest; throws if a different one. */
  put(key: string, digest: string, body: unknown): "created" | "exists";
  get(key: string): { digest: string; body: unknown } | null;
}
