import { test } from "node:test";
import assert from "node:assert/strict";
import { createCareClient, isOperationView, isPlanView } from "./care";
import { toPlanVM } from "../../care/planViewModel";

/** Captured from the running API (POST /api/plans for a real server, writes disabled) on 2026-11-17. */
const REAL_PLAN = JSON.parse(`{"id":"884e1a11-57db-463d-83ed-3a055ff6e650","version":1,"operation":"apply.packages.v1","serverId":"22222222-2222-4222-a222-222222222222","production":true,"scope":{"packages":[],"includesServiceRestart":false,"includesReboot":false},"preconditions":{"previewDigest":"none"},"verification":{"expectInstalled":{}},"requiredAcknowledgements":["production-impact"],"createdAt":"2026-11-17T21:18:13.145Z","expiresAt":"2026-11-17T21:33:13.145Z","blockers":[{"code":"WRITES_DISABLED","message":"Changes are disabled for this server until disposable-server tests pass and live work is authorized."}],"digest":"sha256:a962b8b902c883d49a7bcd7936aba77ea5d1b3e6421822201bba24911ce9d9e6","target":{"serverId":"22222222-2222-4222-a222-222222222222","name":"Nabire","kind":"ssh","simulated":false},"approvable":false}`);

test("the real API plan shape passes the guard and renders as writes-disabled with no approval", () => {
  assert.equal(isPlanView(REAL_PLAN), true);
  assert.equal(isPlanView({ ...REAL_PLAN, extraFieldFromNewerApi: 1 }), true);
  assert.equal(isPlanView({ ...REAL_PLAN, scope: null }), false);
  const vm = toPlanVM(REAL_PLAN, new Date("2026-11-17T21:20:00Z"), "Asia/Jakarta");
  assert.equal(vm.disposition.kind, "writes-disabled");
  assert.equal(vm.disposition.canApprove, false);
  assert.equal(vm.title, "Update packages on Nabire");
  assert.equal(vm.isProduction, true);
  assert.equal(vm.expiry.absolute, "04:33 WIB");
});

test("operation guard rejects unknown states", () => {
  assert.equal(isOperationView({ operation: { id: "a", state: "bogus" }, events: [] }), false);
});

test("approval sends the CSRF header from /api/csrf and the idempotency key; known error codes only", async () => {
  const seen: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, ...(init?.body ? { body: String(init.body) } : {}) });
    if (url === "/api/csrf") return new Response(JSON.stringify({ token: "tok", header: "x-csrf-token" }), { status: 200 });
    return new Response(JSON.stringify({ error: "PLAN_CHANGED", message: "<script>secret</script>" }), { status: 409 });
  }) as unknown as typeof fetch;
  const c = createCareClient({ fetchImpl });
  const r = await c.approvePlan("p1", { planVersion: 1, planDigest: `sha256:${"a".repeat(64)}`, idempotencyKey: "appr_1234567890abcdef", acknowledgements: ["production-impact"] });
  assert.deepEqual(r, { ok: false, kind: "http", status: 409, code: "PLAN_CHANGED" });
  assert.equal(seen[1]?.headers["x-csrf-token"], "tok");
  assert.match(seen[1]?.body ?? "", /"idempotencyKey":"appr_1234567890abcdef"/);
});

test("network failure is a result, never a throw", async () => {
  const c = createCareClient({ fetchImpl: (async () => { throw new Error("boom"); }) as unknown as typeof fetch });
  assert.deepEqual(await c.getOperation("x"), { ok: false, kind: "network" });
});
