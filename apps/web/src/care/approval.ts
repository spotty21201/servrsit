/**
 * Approval submission with a duplicate-submit guard (UX Spec §10.2).
 *
 *   idle -> submitting ("Submitting approval")
 *        -> accepted | rejected
 *        -> checking ("Checking whether this started")  when the response is lost
 *             re-sends the SAME idempotency key (the server replays the existing
 *             operation; it never starts a second one)
 *        -> unconfirmed  after the checks give no answer. Only "Check again"
 *             (same key) is offered. There is never a fresh-execution button
 *             until the identity and outcome are reconciled.
 *
 * Pure orchestration: the client and the sleep function are injected.
 */
import type { ApprovalBody, CareClient, CareResult, ApprovalAccepted } from "../api/care";
import type { PlanNotice } from "./planViewModel";

export type ApprovalPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "submitting" }
  | { readonly phase: "checking"; readonly attempt: number }
  | { readonly phase: "unconfirmed" }
  | { readonly phase: "accepted"; readonly operationId: string; readonly replayed: boolean }
  | { readonly phase: "rejected"; readonly notice: PlanNotice };

export const IDLE: ApprovalPhase = { phase: "idle" };

export const PHASE_LABEL = {
  submitting: "Submitting approval",
  checking: "Checking whether this started",
} as const;

const NOTICE_CODES = new Set([
  "PLAN_CHANGED", "PLAN_EXPIRED", "PLAN_BLOCKED", "WRITES_DISABLED", "TARGET_BUSY", "OUTCOME_UNKNOWN",
  "ALREADY_APPROVED", "PLAN_NOT_FOUND", "ACK_REQUIRED", "CSRF_INVALID",
]);

type Verdict = { kind: "accepted"; data: ApprovalAccepted } | { kind: "rejected"; notice: PlanNotice } | { kind: "lost" } | { kind: "aborted" };

/** Whether a response proves the approval was refused, or leaves it unknown. */
export function judge(result: CareResult<ApprovalAccepted>): Verdict {
  if (result.ok) return { kind: "accepted", data: result.data };
  if (result.kind === "aborted") return { kind: "aborted" };
  if (result.kind === "http") {
    if (result.code && NOTICE_CODES.has(result.code)) return { kind: "rejected", notice: { code: result.code } as PlanNotice };
    // A 5xx without a known code may follow a committed approval: not proof of refusal.
    if ((result.status ?? 500) >= 500) return { kind: "lost" };
    return { kind: "rejected", notice: { code: "OTHER" } };
  }
  return { kind: "lost" };
}

export interface SubmitOptions {
  readonly client: CareClient;
  readonly planId: string;
  readonly body: ApprovalBody;
  readonly onPhase: (p: ApprovalPhase) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxChecks?: number;
  readonly signal?: AbortSignal;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => globalThis.setTimeout(r, ms));

export async function submitApproval(o: SubmitOptions): Promise<ApprovalPhase> {
  const sleep = o.sleep ?? defaultSleep;
  const maxChecks = o.maxChecks ?? 3;
  const finish = (p: ApprovalPhase): ApprovalPhase => { o.onPhase(p); return p; };

  o.onPhase({ phase: "submitting" });
  let v = judge(await o.client.approvePlan(o.planId, o.body, o.signal));
  for (let attempt = 1; v.kind === "lost" && attempt <= maxChecks; attempt++) {
    o.onPhase({ phase: "checking", attempt });
    await sleep(attempt * 1000);
    if (o.signal?.aborted) return finish(IDLE);
    v = judge(await o.client.approvePlan(o.planId, o.body, o.signal));
  }
  switch (v.kind) {
    case "accepted": return finish({ phase: "accepted", operationId: v.data.operationId, replayed: v.data.replayed });
    case "rejected": return finish({ phase: "rejected", notice: v.notice });
    case "aborted": return finish(IDLE);
    case "lost": return finish({ phase: "unconfirmed" });
  }
}

/** A stable idempotency key (matches the API's ^[A-Za-z0-9_-]{16,128}$). */
export function newIdempotencyKey(random: () => string = () => globalThis.crypto.randomUUID()): string {
  return `appr_${random().replace(/[^A-Za-z0-9]/g, "")}`;
}
