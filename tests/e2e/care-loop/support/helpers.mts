import assert from "node:assert/strict";
import {
  EXECUTING_OR_DONE,
  PROD_ACKS,
  type ApproveInput,
  type Harness,
  type Kind,
  type OpView,
  type PlanView,
  type Res,
} from "./contract.mts";

export const SEC = 1000;
export const MIN = 60 * SEC;

let counter = 0;
export const uid = (p = "t"): string => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export interface Fixture {
  readonly serverId: string;
  readonly plan: PlanView;
}

/** A server plus one ready plan. `writes` defaults to enabled so success paths are reachable. */
export async function setup(
  h: Harness,
  o: { production?: boolean; writes?: boolean | undefined; kind?: Kind } = {},
): Promise<Fixture> {
  const writes = "writes" in o ? o.writes : true;
  const server = await h.addServer({
    name: uid("srv"),
    production: o.production ?? false,
    writesEnabled: writes,
  });
  const res = await h.createPlan({ serverId: server.id, kind: o.kind ?? "packages" });
  assert.equal(res.ok, true, `precondition: createPlan must succeed (got ${res.status} ${res.code})`);
  const plan = res.data!;
  assert.equal(plan.state, "ready", `precondition: plan must be ready, was ${plan.state}`);
  return { serverId: server.id, plan };
}

export function approvalFor(plan: PlanView, o: Partial<ApproveInput> & { production?: boolean } = {}): ApproveInput {
  const { production, ...rest } = o;
  return {
    planId: plan.id,
    version: plan.version,
    digest: plan.digest,
    idempotencyKey: uid("key"),
    acknowledgements: production ? PROD_ACKS : [],
    session: "valid",
    csrf: "valid",
    ...rest,
  };
}

export async function approveOk(
  h: Harness,
  plan: PlanView,
  o: Partial<ApproveInput> & { production?: boolean } = {},
): Promise<string> {
  const r = await h.approve(approvalFor(plan, o));
  assert.equal(r.ok, true, `approval must succeed (got ${r.status} ${r.code})`);
  assert.ok(r.data?.operationId, "approval must return an operation id");
  return r.data!.operationId;
}

export async function op(h: Harness, id: string): Promise<OpView> {
  const r = await h.getOperation(id);
  assert.equal(r.ok, true, `getOperation(${id}) failed: ${r.status} ${r.code}`);
  return r.data!;
}

/** A refusal is a client error with a machine-readable code, never a 2xx and never a 5xx. */
export function assertRefused(r: Res, label: string, codes?: readonly string[]): void {
  assert.equal(r.ok, false, `${label}: must be refused, but it succeeded (status ${r.status})`);
  assert.ok(r.status >= 400 && r.status < 500, `${label}: must be a 4xx refusal, got ${r.status}`);
  assert.equal(typeof r.code, "string", `${label}: refusal needs a machine-readable code`);
  assert.ok((r.code ?? "").length > 0, `${label}: refusal code is empty`);
  if (codes) assert.ok(codes.includes(r.code!), `${label}: expected code in [${codes.join(", ")}], got ${r.code}`);
}

export async function opCount(h: Harness, serverIds: readonly string[]): Promise<number> {
  let n = 0;
  for (const id of serverIds) {
    const r = await h.listOperations(id);
    assert.equal(r.ok, true, `listOperations(${id}) failed`);
    n += r.data!.length;
  }
  return n;
}

/**
 * Proves a refusal had no effect on the managed server: no operation row, no
 * mutation applied, and the target never saw a mutation request.
 */
export async function assertNoWork(h: Harness, serverId: string, label: string, aliases: readonly string[] = []): Promise<void> {
  assert.equal(await opCount(h, [serverId, ...aliases]), 0, `${label}: an operation record was created`);
  const t = h.target(serverId);
  assert.deepEqual(await t.mutations(), [], `${label}: the target applied a mutation`);
  const sent = (await t.interactions()).filter((i) => i.kind === "manifest");
  assert.equal(sent.length, 0, `${label}: the target received a mutation request`);
  assert.deepEqual(await t.ledger(), [], `${label}: the target claimed an operation`);
}

export const notExecuting = (state: string): boolean => !EXECUTING_OR_DONE.includes(state);

/** Distinct operation ids the target has ever been asked about. */
export async function targetOpIds(h: Harness, serverId: string): Promise<string[]> {
  const t = h.target(serverId);
  const ids = new Set<string>();
  for (const i of await t.interactions()) if (i.opId) ids.add(i.opId);
  for (const e of await t.ledger()) ids.add(e.opId);
  return [...ids];
}
