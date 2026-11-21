import { test } from "node:test";
import assert from "node:assert/strict";
import { createCareClient, newIdempotencyKey, toPlanView } from "./care";
import type { CsrfSource } from "./http";

/** Captured shape from the running API (POST /api/plans for a real server, writes disabled), with synthetic ids. */
const PLAN = {
  id: "884e1a11-57db-463d-83ed-3a055ff6e650", version: 1, operation: "apply.packages.v1", serverId: "22222222-2222-4222-a222-222222222222", production: true,
  scope: { packages: [], excludedPackages: [], includesServiceRestart: false, includesReboot: false }, preconditions: { previewDigest: "none" },
  verification: { expectInstalled: {} }, requiredAcknowledgements: ["recovery-route-confirmed", "interruption-risk-accepted"],
  createdAt: "2026-11-17T21:18:13.145Z", expiresAt: "2026-11-17T21:33:13.145Z",
  blockers: [{ code: "WRITES_DISABLED", message: "Changes are disabled for this server until disposable-server tests pass and live work is authorized." }],
  digest: "sha256:a962b8b902c883d49a7bcd7936aba77ea5d1b3e6421822201bba24911ce9d9e6",
  target: { serverId: "22222222-2222-4222-a222-222222222222", name: "Fixture Nabire", kind: "ssh", simulated: false }, approvable: false,
};
/** [SIMULATED] A directory plan as the API returns it. */
const DIR_PLAN = {
  ...PLAN, id: "00000000-0000-4000-8000-0000000000d1", operation: "prepare.directories.v1", production: false, requiredAcknowledgements: [], blockers: [], approvable: true,
  scope: { requested: [{ path: "/srv/app", owner: "deploy", group: "deploy", mode: "0755" }], directories: [{ path: "/srv/app", owner: "deploy", group: "deploy", mode: "0755" }], existing: [], includesServiceRestart: false, includesReboot: false },
  verification: { expectDirectories: [{ path: "/srv/app", owner: "deploy", group: "deploy", mode: "0755" }] },
  target: { serverId: "00000000-0000-4000-8000-0000005e0a01", name: "Sim One", kind: "simulated", simulated: true },
};
const OP = {
  operation: {
    id: "00000000-0000-4000-8000-0000000000e1", approvalId: "a", planId: DIR_PLAN.id, planVersion: 1, serverId: DIR_PLAN.serverId, operation: "prepare.directories.v1",
    targetKind: "simulated", state: "running", stopRequested: true, remoteOperationId: "r", createdAt: "2026-11-17T10:00:00.000Z", updatedAt: "2026-11-17T10:00:01.000Z", simulated: true,
  },
  events: [{ operationId: "x", seq: 1, type: "created", at: "2026-11-17T10:00:00.000Z", actor: "owner:o", fromState: null, toState: "queued", payload: {} }],
};
const csrf: CsrfSource = { headers: async () => ({ "x-csrf-token": "tok" }) };

function fake(respond: (url: string, init: RequestInit) => Response) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return respond(url, init); }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

test("the real API's package plan and a directory plan both parse; non-package kinds get packages: [] and keep their scope", () => {
  const p = toPlanView(PLAN);
  assert.equal(p?.blockers[0]?.code, "WRITES_DISABLED");
  const d = toPlanView(DIR_PLAN);
  assert.deepEqual(d?.scope.packages, []);
  assert.deepEqual((d?.detail["directories"] as unknown[]).length, 1);
  assert.equal(d?.target.simulated, true);
  assert.equal(toPlanView({ ...PLAN, operation: "run.shell.v1" }), null, "an unknown kind is refused");
  assert.equal(toPlanView({ ...PLAN, scope: { includesReboot: false } }), null, "a package plan without packages is refused");
});

test("approval posts the body with the CSRF header and the idempotency key; a replay is reported as such", async () => {
  const f = fake(() => json({ operationId: OP.operation.id, state: "queued", replayed: true }, 200));
  const c = createCareClient({ fetchImpl: f.fetchImpl, csrf });
  const key = newIdempotencyKey();
  assert.match(key, /^ui-[0-9a-f]{36}$/);
  const r = await c.approvePlan(DIR_PLAN.id, { planVersion: 1, planDigest: DIR_PLAN.digest, idempotencyKey: key, acknowledgements: [] });
  assert.deepEqual(r, { ok: true, data: { operationId: OP.operation.id, state: "queued", replayed: true } });
  assert.equal(f.seen[0]!.url, `/api/plans/${DIR_PLAN.id}/approvals`);
  assert.equal((f.seen[0]!.init.headers as Record<string, string>)["x-csrf-token"], "tok");
  assert.equal(JSON.parse(String(f.seen[0]!.init.body)).idempotencyKey, key);
  assert.notEqual(newIdempotencyKey(), key);
});

test("stop request, reconcile, revisions and action plans use the API's paths; GETs carry no CSRF header", async () => {
  const f = fake((url) => (url.endsWith("/stop-request") ? json({ ...OP, stop: "requested" }) : url.includes("/operations/") ? json(OP) : json(DIR_PLAN, 201)));
  const c = createCareClient({ fetchImpl: f.fetchImpl, csrf });
  const stop = await c.requestStop(OP.operation.id);
  assert.equal(stop.ok && stop.data.stop, "requested");
  assert.equal((await c.reconcile(OP.operation.id)).ok, true);
  assert.equal((await c.getOperation(OP.operation.id)).ok, true);
  assert.equal((await c.revisePlan(DIR_PLAN.id)).ok, true);
  const made = await c.createActionPlan({ operation: "prepare.directories.v1", serverId: DIR_PLAN.serverId, directories: [{ path: "/srv/app", owner: "deploy", group: "deploy", mode: "0755" }] });
  assert.equal(made.ok && made.data.operation, "prepare.directories.v1");
  assert.deepEqual(f.seen.map((s) => `${s.init.method} ${s.url}`), [
    `POST /api/operations/${OP.operation.id}/stop-request`, `POST /api/operations/${OP.operation.id}/reconcile`, `GET /api/operations/${OP.operation.id}`,
    `POST /api/plans/${DIR_PLAN.id}/revisions`, "POST /api/plans",
  ]);
  assert.equal((f.seen[2]!.init.headers as Record<string, string>)["x-csrf-token"], undefined);
});

test("errors: only known codes pass, PLAN_BLOCKED carries its blocker codes, bodies are never shown", async () => {
  const blocked = createCareClient({ fetchImpl: fake(() => json({ error: "PLAN_BLOCKED", blockers: ["CONTROLLER_CLOCK_UNTRUSTED", "<script>"] }, 409)).fetchImpl, csrf });
  assert.deepEqual(await blocked.approvePlan("p", { planVersion: 1, planDigest: "d", idempotencyKey: "k".repeat(16), acknowledgements: [] }), {
    ok: false, kind: "http", status: 409, code: "PLAN_BLOCKED", blockers: ["CONTROLLER_CLOCK_UNTRUSTED"],
  });
  const odd = createCareClient({ fetchImpl: fake(() => json({ error: "SOMETHING_NEW", message: "secret" }, 500)).fetchImpl, csrf });
  assert.deepEqual(await odd.getPlan("p"), { ok: false, kind: "http", status: 500 });
  const unavailable = createCareClient({ fetchImpl: fake(() => json({ error: "RECONCILE_UNAVAILABLE" }, 409)).fetchImpl, csrf });
  assert.equal((await unavailable.reconcile("o") as { code?: string }).code, "RECONCILE_UNAVAILABLE");
});

test("a refused CSRF token is refreshed once and the call retried; abort and timeout are explicit", async () => {
  let token = "t1";
  let refusals = 1;
  const source: CsrfSource = { headers: async () => ({ "x-csrf-token": token }), refresh: async () => { token = "t2"; } };
  const f = fake(() => (refusals-- > 0 ? json({ error: "CSRF_INVALID" }, 403) : json(OP)));
  const c = createCareClient({ fetchImpl: f.fetchImpl, csrf: source });
  assert.equal((await c.reconcile("o")).ok, true);
  assert.deepEqual(f.seen.map((s) => (s.init.headers as Record<string, string>)["x-csrf-token"]), ["t1", "t2"]);

  const ctl = new AbortController();
  ctl.abort();
  assert.deepEqual(await createCareClient({ fetchImpl: f.fetchImpl, csrf }).getPlan("p", ctl.signal), { ok: false, kind: "aborted" });
  const hang = ((_u: string, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
  assert.deepEqual(await createCareClient({ fetchImpl: hang, csrf, timeoutMs: 10 }).getPlan("p"), { ok: false, kind: "timeout" });
});

test("T-092: owner-modified files a package update keeps are exposed for the plan screen; malformed lists are refused", () => {
  assert.deepEqual(toPlanView(PLAN)?.keptOwnerFiles, []);
  const kept = { ...PLAN, scope: { ...PLAN.scope, keptOwnerFiles: [{ package: "openssh-server:amd64", path: "/etc/ssh/sshd_config" }] } };
  assert.deepEqual(toPlanView(kept)?.keptOwnerFiles, [{ package: "openssh-server:amd64", path: "/etc/ssh/sshd_config" }]);
  assert.equal(toPlanView({ ...PLAN, scope: { ...PLAN.scope, keptOwnerFiles: [{ package: "x", path: "/root/.ssh/id" }] } }), null);
});
