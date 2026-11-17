/**
 * SQLite implementation of CareStore (ADR-015), on Node's built-in node:sqlite.
 *
 * Guarantees enforced by the database itself, not only by code:
 *  - plans, approvals, operation events: no UPDATE, no DELETE (triggers)
 *  - an operation in a final state cannot change state (trigger)
 *  - at most one unresolved operation per server (partial unique index)
 *  - one approval per plan version (unique)
 *  - one outbox entry per operation (unique)
 */

import { DatabaseSync } from "node:sqlite";
import {
  assertTransition,
  isExpired,
  verifyPlanDigest,
  type EventType,
  type OpState,
  type Plan,
} from "@servrsit/domain";
import type {
  ApproveInput,
  ApproveResult,
  CareStore,
  OperationEvent,
  OutboxEntry,
  StoredOperation,
  TargetKind,
} from "./store.js";

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS plans (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  server_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (id, version)
) STRICT;

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  plan_digest TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  owner TEXT NOT NULL,
  acknowledgements TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  UNIQUE (plan_id, plan_version),
  FOREIGN KEY (plan_id, plan_version) REFERENCES plans (id, version)
) STRICT;

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL UNIQUE REFERENCES approvals (id),
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  server_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('simulated', 'ssh')),
  state TEXT NOT NULL CHECK (state IN ('queued','running','verifying','succeeded','partially_succeeded','failed','cancelled_before_start','outcome_unknown')),
  stop_requested INTEGER NOT NULL DEFAULT 0,
  remote_operation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved_per_server
  ON operations (server_id)
  WHERE state IN ('queued', 'running', 'verifying', 'outcome_unknown');

CREATE TABLE IF NOT EXISTS operation_events (
  operation_id TEXT NOT NULL REFERENCES operations (id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  payload TEXT NOT NULL,
  PRIMARY KEY (operation_id, seq)
) STRICT;

CREATE TABLE IF NOT EXISTS dispatch_outbox (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations (id),
  intent_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'done')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS plans_immutable_u BEFORE UPDATE ON plans
  BEGIN SELECT RAISE(ABORT, 'plans are immutable'); END;
CREATE TRIGGER IF NOT EXISTS plans_immutable_d BEFORE DELETE ON plans
  BEGIN SELECT RAISE(ABORT, 'plans are immutable'); END;
CREATE TRIGGER IF NOT EXISTS approvals_immutable_u BEFORE UPDATE ON approvals
  BEGIN SELECT RAISE(ABORT, 'approvals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS approvals_immutable_d BEFORE DELETE ON approvals
  BEGIN SELECT RAISE(ABORT, 'approvals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS events_append_only_u BEFORE UPDATE ON operation_events
  BEGIN SELECT RAISE(ABORT, 'operation events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_append_only_d BEFORE DELETE ON operation_events
  BEGIN SELECT RAISE(ABORT, 'operation events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS operations_no_delete BEFORE DELETE ON operations
  BEGIN SELECT RAISE(ABORT, 'operations are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS operations_final_is_final BEFORE UPDATE OF state ON operations
  WHEN OLD.state IN ('succeeded', 'partially_succeeded', 'failed', 'cancelled_before_start') AND NEW.state <> OLD.state
  BEGIN SELECT RAISE(ABORT, 'a final operation state cannot change'); END;
`;

const UNRESOLVED_SQL = "('queued', 'running', 'verifying', 'outcome_unknown')";

interface OperationRow {
  id: string; approval_id: string; plan_id: string; plan_version: number; server_id: string;
  operation: string; target_kind: string; state: string; stop_requested: number;
  remote_operation_id: string | null; created_at: string; updated_at: string;
}

/** A row that must exist (it was just written or read under the same transaction). */
function mustRow(r: unknown): OperationRow {
  if (r === undefined || r === null) throw new Error("expected operation row is missing");
  return r as OperationRow;
}

function toOperation(r: OperationRow): StoredOperation {
  return {
    id: r.id,
    approvalId: r.approval_id,
    planId: r.plan_id,
    planVersion: r.plan_version,
    serverId: r.server_id,
    operation: r.operation as StoredOperation["operation"],
    targetKind: r.target_kind as TargetKind,
    state: r.state as OpState,
    stopRequested: r.stop_requested === 1,
    remoteOperationId: r.remote_operation_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface SqliteCareStoreOptions {
  /** File path, or ":memory:". */
  readonly path: string;
  /** For tests: called inside the approval transaction just before COMMIT. */
  readonly beforeApprovalCommit?: (() => void) | undefined;
}

export class SqliteCareStore implements CareStore {
  private readonly db: DatabaseSync;

  constructor(private readonly options: SqliteCareStoreOptions) {
    this.db = new DatabaseSync(options.path);
    this.db.exec(SCHEMA);
  }

  /** Run `fn` in one IMMEDIATE transaction; roll back on any throw. */
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  insertPlan(plan: Plan): void {
    this.db
      .prepare("INSERT INTO plans (id, version, server_id, operation, digest, expires_at, body) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(plan.id, plan.version, plan.serverId, plan.operation, plan.digest, plan.expiresAt, JSON.stringify(plan));
  }

  getPlan(id: string, version?: number): Plan | null {
    const row = (
      version === undefined
        ? this.db.prepare("SELECT body FROM plans WHERE id = ? ORDER BY version DESC LIMIT 1").get(id)
        : this.db.prepare("SELECT body FROM plans WHERE id = ? AND version = ?").get(id, version)
    ) as { body: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.body) as Plan);
  }

  unresolvedFor(serverId: string): StoredOperation | null {
    const row = this.db
      .prepare(`SELECT * FROM operations WHERE server_id = ? AND state IN ${UNRESOLVED_SQL}`)
      .get(serverId) as OperationRow | undefined;
    return row === undefined ? null : toOperation(row);
  }

  getOperation(id: string): StoredOperation | null {
    const row = this.db.prepare("SELECT * FROM operations WHERE id = ?").get(id) as OperationRow | undefined;
    return row === undefined ? null : toOperation(row);
  }

  approve(input: ApproveInput): ApproveResult {
    return this.tx((): ApproveResult => {
      // Idempotent replay first: the same key for the same plan version returns
      // the same operation, even if the plan has since expired.
      const existing = this.db
        .prepare("SELECT id, idempotency_key FROM approvals WHERE plan_id = ? AND plan_version = ?")
        .get(input.planId, input.planVersion) as { id: string; idempotency_key: string } | undefined;
      if (existing !== undefined) {
        if (existing.idempotency_key !== input.idempotencyKey) return { kind: "rejected", code: "ALREADY_APPROVED" };
        const op = mustRow(this.db.prepare("SELECT * FROM operations WHERE approval_id = ?").get(existing.id));
        return { kind: "replayed", operation: toOperation(op) };
      }

      const latest = this.getPlan(input.planId);
      if (latest === null) return { kind: "rejected", code: "PLAN_NOT_FOUND" };
      if (latest.version !== input.planVersion) return { kind: "rejected", code: "PLAN_CHANGED" };
      if (latest.digest !== input.planDigest || !verifyPlanDigest(latest)) return { kind: "rejected", code: "PLAN_CHANGED" };
      if (isExpired(latest, input.now)) return { kind: "rejected", code: "PLAN_EXPIRED" };
      if (latest.blockers.length > 0) {
        return { kind: "rejected", code: "PLAN_BLOCKED", blockers: latest.blockers.map((b) => b.code) };
      }
      if (!input.writesEnabled) return { kind: "rejected", code: "WRITES_DISABLED" };
      if (!latest.requiredAcknowledgements.every((a) => input.acknowledgements.includes(a))) {
        return { kind: "rejected", code: "ACK_REQUIRED" };
      }
      const busy = this.unresolvedFor(latest.serverId);
      if (busy !== null) return { kind: "rejected", code: busy.state === "outcome_unknown" ? "OUTCOME_UNKNOWN" : "TARGET_BUSY" };

      const at = input.now.toISOString();
      const approvalId = input.newId();
      const operationId = input.newId();
      this.db
        .prepare("INSERT INTO approvals (id, plan_id, plan_version, plan_digest, idempotency_key, owner, acknowledgements, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(approvalId, latest.id, latest.version, latest.digest, input.idempotencyKey, input.owner, JSON.stringify([...input.acknowledgements].sort()), at);
      this.db
        .prepare("INSERT INTO operations (id, approval_id, plan_id, plan_version, server_id, operation, target_kind, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)")
        .run(operationId, approvalId, latest.id, latest.version, latest.serverId, latest.operation, input.targetKind, at, at);
      this.insertEvent(operationId, "created", `owner:${input.owner}`, null, "queued", { approvalId, planDigest: latest.digest }, at);
      const intentDigest = `${latest.digest}#${operationId}`;
      this.db
        .prepare("INSERT INTO dispatch_outbox (id, operation_id, intent_digest, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
        .run(input.newId(), operationId, intentDigest, at);

      this.options.beforeApprovalCommit?.();
      const op = mustRow(this.db.prepare("SELECT * FROM operations WHERE id = ?").get(operationId));
      return { kind: "created", operation: toOperation(op) };
    });
  }

  private nextSeq(operationId: string): number {
    const r = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM operation_events WHERE operation_id = ?").get(operationId) as { n: number };
    return r.n;
  }

  private insertEvent(
    operationId: string, type: EventType, actor: string,
    from: OpState | null, to: OpState | null, payload: Record<string, unknown>, at: string,
  ): void {
    this.db
      .prepare("INSERT INTO operation_events (operation_id, seq, type, at, actor, from_state, to_state, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(operationId, this.nextSeq(operationId), type, at, actor, from, to, JSON.stringify(payload));
  }

  listEvents(operationId: string): OperationEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM operation_events WHERE operation_id = ? ORDER BY seq")
      .all(operationId) as Array<{ operation_id: string; seq: number; type: string; at: string; actor: string; from_state: string | null; to_state: string | null; payload: string }>;
    return rows.map((r) => ({
      operationId: r.operation_id,
      seq: r.seq,
      type: r.type as EventType,
      at: r.at,
      actor: r.actor,
      fromState: r.from_state as OpState | null,
      toState: r.to_state as OpState | null,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
    }));
  }

  transition(operationId: string, to: OpState, event: EventType, actor: string, payload: Record<string, unknown>, now: Date): StoredOperation {
    return this.tx(() => {
      const row = this.db.prepare("SELECT * FROM operations WHERE id = ?").get(operationId) as OperationRow | undefined;
      if (row === undefined) throw new Error("operation not found");
      const from = row.state as OpState;
      assertTransition(from, to, event);
      const at = now.toISOString();
      this.db.prepare("UPDATE operations SET state = ?, updated_at = ? WHERE id = ?").run(to, at, operationId);
      this.insertEvent(operationId, event, actor, from, to, payload, at);
      return toOperation(mustRow(this.db.prepare("SELECT * FROM operations WHERE id = ?").get(operationId)));
    });
  }

  appendEvent(operationId: string, event: EventType, actor: string, payload: Record<string, unknown>, now: Date): void {
    this.tx(() => this.insertEvent(operationId, event, actor, null, null, payload, now.toISOString()));
  }

  setRemoteOperationId(operationId: string, remoteId: string, now: Date): void {
    this.db
      .prepare("UPDATE operations SET remote_operation_id = ?, updated_at = ? WHERE id = ? AND (remote_operation_id IS NULL OR remote_operation_id = ?)")
      .run(remoteId, now.toISOString(), operationId, remoteId);
  }

  leaseOutbox(worker: string, now: Date, leaseMs: number): OutboxEntry | null {
    return this.tx(() => {
      const at = now.toISOString();
      const row = this.db
        .prepare("SELECT * FROM dispatch_outbox WHERE status = 'pending' OR (status = 'leased' AND lease_until <= ?) ORDER BY created_at LIMIT 1")
        .get(at) as { id: string; operation_id: string; intent_digest: string; status: string; attempts: number } | undefined;
      if (row === undefined) return null;
      const until = new Date(now.getTime() + leaseMs).toISOString();
      this.db
        .prepare("UPDATE dispatch_outbox SET status = 'leased', lease_owner = ?, lease_until = ?, attempts = attempts + 1 WHERE id = ?")
        .run(worker, until, row.id);
      return {
        id: row.id,
        operationId: row.operation_id,
        intentDigest: row.intent_digest,
        status: "leased",
        attempts: row.attempts + 1,
        leaseOwner: worker,
        leaseUntil: until,
      };
    });
  }

  completeOutbox(id: string, worker: string): void {
    this.db.prepare("UPDATE dispatch_outbox SET status = 'done', lease_until = NULL WHERE id = ? AND lease_owner = ?").run(id, worker);
  }

  releaseOutbox(id: string, worker: string): void {
    this.db
      .prepare("UPDATE dispatch_outbox SET status = 'pending', lease_owner = NULL, lease_until = NULL WHERE id = ? AND lease_owner = ? AND status = 'leased'")
      .run(id, worker);
  }

  close(): void {
    this.db.close();
  }
}
