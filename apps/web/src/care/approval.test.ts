import { test } from "node:test";
import assert from "node:assert/strict";
import type { ApprovalBody, CareClient, CareResult, ApprovalAccepted } from "../api/stubs/care";
import { judge, newIdempotencyKey, submitApproval, type ApprovalPhase } from "./approval";

const BODY: ApprovalBody = { planVersion: 1, planDigest: `sha256:${"a".repeat(64)}`, idempotencyKey: "appr_1234567890abcdef", acknowledgements: [] };
const OK: CareResult<ApprovalAccepted> = { ok: true, data: { operationId: "op-1", state: "queued", replayed: false } };
const LOST: CareResult<ApprovalAccepted> = { ok: false, kind: "network" };

function clientReturning(...results: CareResult<ApprovalAccepted>[]): { client: CareClient; calls: ApprovalBody[] } {
  const calls: ApprovalBody[] = [];
  const unused = async (): Promise<never> => { throw new Error("unused"); };
  const client = {
    getPlan: unused, createPlan: unused, revisePlan: unused, getOperation: unused,
    approvePlan: async (_id: string, body: ApprovalBody) => { calls.push(body); return results[Math.min(calls.length - 1, results.length - 1)]!; },
  } as unknown as CareClient;
  return { client, calls };
}

const noSleep = async (): Promise<void> => {};

test("success: submitting then accepted, one request", async () => {
  const { client, calls } = clientReturning(OK);
  const phases: ApprovalPhase["phase"][] = [];
  const end = await submitApproval({ client, planId: "p", body: BODY, sleep: noSleep, onPhase: (p) => phases.push(p.phase) });
  assert.deepEqual(phases, ["submitting", "accepted"]);
  assert.equal(end.phase === "accepted" && end.operationId, "op-1");
  assert.equal(calls.length, 1);
});

test("lost response: 'checking' re-sends the SAME key and picks up the existing operation", async () => {
  const replay: CareResult<ApprovalAccepted> = { ok: true, data: { operationId: "op-1", state: "queued", replayed: true } };
  const { client, calls } = clientReturning(LOST, replay);
  const phases: string[] = [];
  const end = await submitApproval({ client, planId: "p", body: BODY, sleep: noSleep, onPhase: (p) => phases.push(p.phase) });
  assert.deepEqual(phases, ["submitting", "checking", "accepted"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.idempotencyKey, calls[1]?.idempotencyKey);
  assert.equal(end.phase === "accepted" && end.replayed, true);
});

test("no answer after the checks: unconfirmed, never a fresh key", async () => {
  const { client, calls } = clientReturning(LOST);
  const end = await submitApproval({ client, planId: "p", body: BODY, sleep: noSleep, maxChecks: 2, onPhase: () => {} });
  assert.equal(end.phase, "unconfirmed");
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((c) => c.idempotencyKey)).size, 1);
});

test("a known refusal code is a rejection, not a lost response", async () => {
  const { client, calls } = clientReturning({ ok: false, kind: "http", status: 409, code: "PLAN_CHANGED" });
  const end = await submitApproval({ client, planId: "p", body: BODY, sleep: noSleep, onPhase: () => {} });
  assert.deepEqual(end, { phase: "rejected", notice: { code: "PLAN_CHANGED" } });
  assert.equal(calls.length, 1);
});

test("judge: 5xx without a code is unknown, 4xx without a code is a refusal, timeouts are unknown", () => {
  assert.equal(judge({ ok: false, kind: "http", status: 500 }).kind, "lost");
  assert.equal(judge({ ok: false, kind: "http", status: 400 }).kind, "rejected");
  assert.equal(judge({ ok: false, kind: "timeout" }).kind, "lost");
  assert.equal(judge({ ok: false, kind: "invalid-response" }).kind, "lost");
  assert.equal(judge({ ok: false, kind: "aborted" }).kind, "aborted");
});

test("idempotency keys match the API pattern", () => {
  assert.match(newIdempotencyKey(), /^[A-Za-z0-9_-]{16,128}$/);
  assert.notEqual(newIdempotencyKey(), newIdempotencyKey());
});
