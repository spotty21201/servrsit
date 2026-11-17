/**
 * Care-loop test contract.
 *
 * Derived from PRD FR-10..FR-17 and Technical Spec §9-§11 and §13, plus ADR-014
 * (per-server `writesEnabled`). NOT derived from Coder's code.
 *
 * The spec fixes behaviour and names endpoints and error codes, but not request
 * or response JSON. Every shape assumption therefore lives behind this
 * interface. Scenarios (scenarios.mts) assert only on the abstract values
 * below. The HTTP binding (http-binding.mts) is the one place that maps these
 * to the real API once it exists.
 *
 * Oracle rule: effects on the managed server are read from the TARGET
 * (ledger, mutation log, interaction log), never from the API's own claims.
 */

export type Kind = "packages" | "restart-service" | "reboot" | "prepare-directories";

/** Technical Spec §11 operation states. */
export type OpState =
  | "queued"
  | "running"
  | "verifying"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled_before_start"
  | "outcome_unknown";

/** States in which the target may already be changing. Used by "no work happened" checks. */
export const EXECUTING_OR_DONE: readonly string[] = [
  "running", "verifying", "succeeded", "partially_succeeded",
];

/** One unresolved mutation per server (Technical Spec §9.4). */
export const UNRESOLVED: readonly string[] = ["queued", "running", "verifying", "outcome_unknown"];

export interface Res<T = unknown> {
  readonly ok: boolean;
  /** HTTP status. */
  readonly status: number;
  /** Machine-readable error code (Technical Spec §13), when !ok. */
  readonly code?: string | undefined;
  readonly data?: T | undefined;
}

export interface PlanView {
  readonly id: string;
  readonly version: number;
  readonly digest: string;
  /** "ready" | "blocked" | "expired" | "approved" | "superseded" */
  readonly state: string;
  readonly expiresAt: string;
  readonly blockers: readonly string[];
}

export interface OpEvent {
  readonly seq: number;
  readonly type: string;
  readonly at: string;
}

export interface OpView {
  readonly id: string;
  /** Remote operation ID if the API exposes one separately from `id` (Technical Spec §12). */
  readonly remoteId?: string | undefined;
  readonly state: string;
  /** Orthogonal flag, not a state (Technical Spec §11). */
  readonly stopRequested: boolean;
  readonly serverId: string;
  readonly planId: string;
  readonly planVersion: number;
  /** Why work was blocked, failed or cancelled, when the API says so (FR-12: "with an explanation"). */
  readonly reason?: string | undefined;
  readonly events: readonly OpEvent[];
}

export interface ApproveInput {
  readonly planId: string;
  readonly version: number;
  /** `undefined` means the field is omitted entirely. */
  readonly digest: string | undefined;
  readonly idempotencyKey: string;
  /** Abstract acknowledgement ids. See ACK_* below. */
  readonly acknowledgements?: readonly string[];
  readonly session?: "valid" | "none";
  readonly csrf?: "valid" | "omit" | "wrong";
  /** Extra body fields a hostile client might add (e.g. writesEnabled). */
  readonly extra?: Readonly<Record<string, unknown>>;
  /** Extra headers a hostile client might add. */
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

/** Technical Spec §9.2: "explicit production acknowledgements"; PRD FR-13 / UX §10.2. */
export const ACK_RECOVERY = "recovery-route";
export const ACK_RISK = "interruption-risk";
export const PROD_ACKS: readonly string[] = [ACK_RECOVERY, ACK_RISK];

export interface Interaction {
  /** Order in which the target saw it, per target. */
  readonly seq: number;
  /** manifest = a mutation request; query = query.operation.v1; inspect = read-only collector. */
  readonly kind: "manifest" | "query" | "inspect" | "connect-failed";
  readonly opId?: string | undefined;
}

export interface LedgerEntry {
  readonly opId: string;
  /** accepted | running | done | rejected */
  readonly state: string;
}

export interface MutationRecord {
  readonly opId: string;
  readonly kind: string;
}

/** Ground truth about the managed server. This is the test oracle. */
export interface TargetSim {
  mutations(): Promise<readonly MutationRecord[]>;
  interactions(): Promise<readonly Interaction[]>;
  ledger(): Promise<readonly LedgerEntry[]>;
  /** Number of kill / force-stop signals the target received for any transaction. */
  killSignals(): Promise<number>;
  partition(on: boolean): Promise<void>;
  /** Lose exactly the next acknowledgement (or the request itself) once. */
  dropNextAck(when: "before-acceptance" | "after-acceptance"): Promise<void>;
  /** Change what the package transaction would now be (Technical Spec §10.2 step 5). */
  changeTransaction(how: "add-dependency" | "new-candidate-version" | "add-removal"): Promise<void>;
  /** While on, an accepted transaction stays open (running) until completeHeldTransaction(). */
  holdTransactionOpen(on: boolean): Promise<void>;
  completeHeldTransaction(): Promise<void>;
}

export interface Harness {
  readonly name: string;

  // ----- public API surface (Technical Spec §13) -----
  addServer(o: {
    name: string;
    production?: boolean;
    /** ADR-014 flag. `undefined` = field absent. Absent must behave as false. */
    writesEnabled?: boolean | undefined;
    /** Register a second display name for the same machine (PRD FR-02). */
    aliasOf?: string;
  }): Promise<{ id: string }>;
  createPlan(i: { serverId: string; kind: Kind }): Promise<Res<PlanView>>;
  getPlan(planId: string): Promise<Res<PlanView>>;
  approve(i: ApproveInput): Promise<Res<{ operationId: string }>>;
  getOperation(opId: string): Promise<Res<OpView>>;
  listOperations(serverId: string): Promise<Res<readonly OpView[]>>;
  requestStop(opId: string): Promise<Res<OpView>>;
  reconcile(opId: string): Promise<Res<OpView>>;
  assistant(text: string, ctx: { planId?: string; serverId?: string }): Promise<Res>;
  inspect(serverId: string): Promise<Res>;

  // ----- test controls (need hooks in the system under test; see README) -----
  /** Run worker / dispatcher / reconciler until nothing more happens now. */
  settle(): Promise<void>;
  /** Advance the controller and target clocks together. Does not settle. */
  advance(ms: number): Promise<void>;
  restartController(): Promise<void>;
  /** Hold the dispatcher so approved operations stay queued and unsent. */
  pauseDispatch(on: boolean): Promise<void>;
  /** Server-side config only (never a client field). `undefined` removes the key. */
  setWritesEnabled(serverId: string, v: boolean | undefined): Promise<void>;
  schedulerTick(): Promise<void>;
  /** Simulated target for a server. Aliases share one target. */
  target(serverId: string): TargetSim;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  /** Acceptance-matrix IDs and requirement IDs this scenario supports. */
  readonly traces: readonly string[];
  /** The spec text the assertions come from. */
  readonly spec: readonly string[];
  run(h: Harness): Promise<void>;
}
