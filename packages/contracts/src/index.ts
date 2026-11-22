/**
 * @servrsit/contracts
 *
 * Shared schemas, state enums, and API error codes.
 * All TypeScript types are inferred from Zod schemas — no separately maintained type files.
 *
 * Technical Spec §11 (operation state), §13 (API error codes), §12 (persistence model).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Operation state
// ---------------------------------------------------------------------------

/**
 * All valid states for a remote operation.
 * Technical Spec §11: "Operation state model"
 *
 * Note: `stop_requested` is an orthogonal boolean flag on an operation record,
 * not a state in this enum. Technical Spec §11: "stop_requested is an orthogonal
 * request flag, not proof of cancellation."
 */
export const OperationState = {
  /** Approved record exists; remote acceptance not established. */
  QUEUED: "queued",
  /** Remote ledger confirms acceptance and execution is underway. */
  RUNNING: "running",
  /** Execution finished sufficiently to perform independent postcondition checks. */
  VERIFYING: "verifying",
  /** All required execution and verification criteria passed. */
  SUCCEEDED: "succeeded",
  /** Some intended work completed; other steps or checks did not. */
  PARTIALLY_SUCCEEDED: "partially_succeeded",
  /** Failure is established, with known effects recorded. */
  FAILED: "failed",
  /** No remote work was accepted; operation was cancelled before dispatch. */
  CANCELLED_BEFORE_START: "cancelled_before_start",
  /** Acceptance, execution, or outcome cannot be established. Blocks conflicting writes. */
  OUTCOME_UNKNOWN: "outcome_unknown",
} as const;

export type OperationState = (typeof OperationState)[keyof typeof OperationState];

export const OperationStateSchema = z.enum([
  OperationState.QUEUED,
  OperationState.RUNNING,
  OperationState.VERIFYING,
  OperationState.SUCCEEDED,
  OperationState.PARTIALLY_SUCCEEDED,
  OperationState.FAILED,
  OperationState.CANCELLED_BEFORE_START,
  OperationState.OUTCOME_UNKNOWN,
]);

/**
 * Final operation states. Their records cannot be edited: later evidence is
 * appended as an event, never written over the state.
 */
export const FINAL_OPERATION_STATES: ReadonlySet<OperationState> = new Set([
  OperationState.SUCCEEDED,
  OperationState.PARTIALLY_SUCCEEDED,
  OperationState.FAILED,
  OperationState.CANCELLED_BEFORE_START,
]);

/**
 * Unresolved operation states. At most one unresolved operation may exist per
 * server, and it blocks conflicting writes. `outcome_unknown` is unresolved,
 * not final (Technical Spec §11): it is resolved only by reconciliation
 * against the remote ledger. (T-007 wrongly listed it as terminal.)
 */
export const UNRESOLVED_OPERATION_STATES: ReadonlySet<OperationState> = new Set([
  OperationState.QUEUED,
  OperationState.RUNNING,
  OperationState.VERIFYING,
  OperationState.OUTCOME_UNKNOWN,
]);

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------

/**
 * Observation-derived server status.
 * Technical Spec §12: `servers` entity "status/capabilities".
 * UX Spec §8: server card states.
 */
export const ServerStatusSchema = z.object({
  /** Whether the server is reachable via the configured transport. */
  reachable: z.boolean(),
  /** Current host-key trust state. */
  hostKeyTrust: z.enum(["trusted", "changed", "unverified"]),
  /** Whether write (maintenance) mode is enabled for this server. */
  writeEnabled: z.boolean(),
  /**
   * Any active operation ID on this server. Null when no unresolved
   * mutation is in progress.
   */
  activeOperationId: z.string().uuid().nullable(),
});

export type ServerStatus = z.infer<typeof ServerStatusSchema>;

// ---------------------------------------------------------------------------
// Observation freshness
// ---------------------------------------------------------------------------

/**
 * Observation freshness state for a collected data point.
 * Technical Spec §14: "freshness rules — health expires after two health intervals,
 * inventory after two inventory intervals."
 * UX Spec §8: freshness indicators.
 */
export const ObservationFreshnessSchema = z.object({
  /** ISO-8601 timestamp of the most recent successful observation for this check type. */
  lastSuccessAt: z.string().datetime().nullable(),
  /**
   * ISO-8601 deadline after which this observation is considered stale.
   * Null when no observation has ever succeeded.
   */
  staleAfter: z.string().datetime().nullable(),
  /** Whether the most recent attempt for this check type succeeded. */
  lastAttemptSucceeded: z.boolean().nullable(),
  /**
   * Whether the current observation is within the freshness window.
   * Computed from `staleAfter` relative to current time.
   */
  isFresh: z.boolean(),
});

export type ObservationFreshness = z.infer<typeof ObservationFreshnessSchema>;

// ---------------------------------------------------------------------------
// API error codes
// ---------------------------------------------------------------------------

/**
 * Machine-readable error codes returned by the API.
 * Technical Spec §13: "Return machine-readable errors including..."
 */
export const ApiErrorCode = {
  /** The host's public key has not been verified by the owner. */
  HOST_UNTRUSTED: "HOST_UNTRUSTED",
  /**
   * The host's public key no longer matches the pinned verified key.
   * Blocks all inspection and changes until reverified.
   */
  HOST_KEY_CHANGED: "HOST_KEY_CHANGED",
  /** The configured route to the target is not available. */
  ROUTE_UNAVAILABLE: "ROUTE_UNAVAILABLE",
  /**
   * Write operations are not permitted because maintenance mode has not
   * been enabled for this server.
   */
  READ_ONLY_ACCESS: "READ_ONLY_ACCESS",
  /** The plan has passed its expiry time and can no longer be approved. */
  PLAN_EXPIRED: "PLAN_EXPIRED",
  /**
   * The plan content or digest has changed since the approval request
   * was submitted. A new plan is required.
   */
  PLAN_CHANGED: "PLAN_CHANGED",
  /**
   * The package manager lock is held by another process. The operation
   * cannot proceed until the lock is released.
   */
  PACKAGE_LOCKED: "PACKAGE_LOCKED",
  /**
   * Another unresolved operation is active on this target. Only one
   * mutation may be in progress per server at a time.
   */
  TARGET_BUSY: "TARGET_BUSY",
  /**
   * The outcome of a previous operation cannot be determined. Conflicting
   * writes are blocked until the outcome is reconciled.
   */
  OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
  /** Operation audit records are unavailable for the requested scope. */
  AUDIT_UNAVAILABLE: "AUDIT_UNAVAILABLE",
  /**
   * The AI inference service (Bedrock) is unavailable or over capacity.
   * Deterministic workflows continue; AI-generated summaries are not shown.
   */
  AI_UNAVAILABLE: "AI_UNAVAILABLE",
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export const ApiErrorCodeSchema = z.enum([
  ApiErrorCode.HOST_UNTRUSTED,
  ApiErrorCode.HOST_KEY_CHANGED,
  ApiErrorCode.ROUTE_UNAVAILABLE,
  ApiErrorCode.READ_ONLY_ACCESS,
  ApiErrorCode.PLAN_EXPIRED,
  ApiErrorCode.PLAN_CHANGED,
  ApiErrorCode.PACKAGE_LOCKED,
  ApiErrorCode.TARGET_BUSY,
  ApiErrorCode.OUTCOME_UNKNOWN,
  ApiErrorCode.AUDIT_UNAVAILABLE,
  ApiErrorCode.AI_UNAVAILABLE,
]);

// ---------------------------------------------------------------------------
// API error response schema
// ---------------------------------------------------------------------------

/**
 * Standard API error response body.
 * Technical Spec §13: "Include safe display guidance and a correlation ID,
 * never raw secrets or arbitrary remote strings as trusted HTML."
 */
export const ApiErrorResponseSchema = z.object({
  code: ApiErrorCodeSchema,
  /** Human-readable explanation safe for display in the UI. */
  message: z.string(),
  /** Correlation ID for tracing this error in operational logs. */
  correlationId: z.string(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

// ---------------------------------------------------------------------------
// Plan base schema
// ---------------------------------------------------------------------------

/**
 * Base Plan schema.
 * Technical Spec §9.1: "A plan is an immutable versioned record..."
 * Technical Spec §12: `plans` entity.
 *
 * This is the base schema for the shared contract. The full plan schema
 * (with operation-specific scope fields) is defined in @servrsit/domain.
 */
export const PlanSchema = z.object({
  /** Stable UUID for this plan. */
  id: z.string().uuid(),
  /**
   * Monotonic version number. Incremented on any change; used to detect
   * stale approval attempts.
   */
  version: z.number().int().min(1),
  /**
   * Canonical digest of the plan's executable content.
   * Approval binds to this digest — a changed digest invalidates approval.
   */
  digest: z.string().min(1),
  /** ID of the target server this plan applies to. */
  serverId: z.string().uuid(),
  /**
   * IDs of observations used to compile this plan. Used to detect staleness
   * between planning and approval.
   */
  observationIds: z.array(z.string().uuid()).min(1),
  /** ISO-8601 timestamp after which this plan can no longer be approved. */
  expiresAt: z.string().datetime(),
  /** ISO-8601 timestamp when this plan was created. */
  createdAt: z.string().datetime(),
  /**
   * Typed blocking reasons when this plan cannot be approved.
   * An empty array means no blockers.
   */
  blockers: z.array(ApiErrorCodeSchema),
});

export type Plan = z.infer<typeof PlanSchema>;

// ---------------------------------------------------------------------------
// Approval base schema
// ---------------------------------------------------------------------------

/**
 * Base Approval schema.
 * Technical Spec §9.2: "The approval endpoint requires authenticated owner context,
 * CSRF protection, plan digest/version, and explicit production acknowledgements."
 * Technical Spec §12: `approvals` entity.
 */
export const ApprovalSchema = z.object({
  /** Stable UUID for this approval record. */
  id: z.string().uuid(),
  /** The plan this approval is for. */
  planId: z.string().uuid(),
  /** The plan version at the time of approval. */
  planVersion: z.number().int().min(1),
  /**
   * The plan digest at the time of approval. Must match the current plan digest;
   * a mismatch means the plan content changed and the approval is void.
   */
  planDigest: z.string().min(1),
  /**
   * Idempotency key scoped to owner + plan version.
   * Repeated approval requests with the same key return the same operation.
   */
  idempotencyKey: z.string().min(1),
  /**
   * Explicit production acknowledgements provided by the owner.
   * Required for servers classified as production.
   */
  productionAcknowledgements: z.array(z.string()),
  /** ISO-8601 timestamp of the approval. */
  approvedAt: z.string().datetime(),
});

export type Approval = z.infer<typeof ApprovalSchema>;

// ---------------------------------------------------------------------------
// Operation base schema
// ---------------------------------------------------------------------------

/**
 * Base Operation schema.
 * Technical Spec §9, §11: operation lifecycle.
 * Technical Spec §12: `operations` entity.
 */
export const OperationSchema = z.object({
  /** Stable UUID for this operation. Must never be regenerated due to a lost response. */
  id: z.string().uuid(),
  /** The approval that authorized this operation. */
  approvalId: z.string().uuid(),
  /** The plan this operation executes. */
  planId: z.string().uuid(),
  /** The target server. */
  serverId: z.string().uuid(),
  /** Current state of this operation. */
  state: OperationStateSchema,
  /**
   * Whether a safe-stop has been requested.
   * This is an orthogonal flag — it does not change the operation state directly
   * and is not proof that any active transaction has stopped.
   */
  stopRequested: z.boolean(),
  /**
   * The remote operation ID as recorded in the target's ledger.
   * Null until the remote ledger has confirmed acceptance.
   */
  remoteOperationId: z.string().nullable(),
  /** ISO-8601 timestamp when this operation was created. */
  createdAt: z.string().datetime(),
  /** ISO-8601 timestamp of the most recent state transition. */
  updatedAt: z.string().datetime(),
});

export type Operation = z.infer<typeof OperationSchema>;

// ---------------------------------------------------------------------------
// Inspection observation and fleet response (live read-only wiring, ADR-012)
// ---------------------------------------------------------------------------

export * from "./observation.js";
export * from "./fleet.js";

export * from "./assistant.js";

export * from "./care.js";

export * from "./auth.js";

export * from "./servers.js";

export * from "./findings.js";

export * from "./activity.js";

export * from "./baselines.js";

export * from "./settings.js";

export * from "./receipt.js";
