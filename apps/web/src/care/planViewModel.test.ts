import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlanView } from "../api/stubs/care";
import { diffScope, toPlanVM, WRITES_OFF_TEXT } from "./planViewModel";

const NOW = new Date("2026-11-17T03:00:00Z"); // 10:00 WIB
const TZ = "Asia/Jakarta";

function plan(over: Partial<PlanView> = {}): PlanView {
  return {
    id: "p1", version: 1, operation: "apply.packages.v1", serverId: "s1", production: false,
    scope: { packages: [{ name: "curl", arch: "amd64", from: "8.5.0-1", to: "8.5.0-2" }, { name: "openssl", arch: "amd64", from: "3.0.1", to: "3.0.2" }], includesServiceRestart: false, includesReboot: false },
    preconditions: { previewDigest: "sha256:x" }, verification: { expectInstalled: { "curl:amd64": "8.5.0-2" } },
    requiredAcknowledgements: [], createdAt: "2026-11-17T02:57:00Z", expiresAt: "2026-11-17T03:12:00Z", blockers: [], digest: `sha256:${"b".repeat(64)}`,
    target: { serverId: "s1", name: "Nabire", kind: "simulated", simulated: true }, approvable: true, ...over,
  };
}

test("ready plan: specific label, action and target in the title, expiry in owner zone with relative", () => {
  const vm = toPlanVM(plan(), NOW, TZ);
  assert.equal(vm.title, "Update packages on Nabire");
  assert.equal(vm.approveLabel, "Approve update on Nabire");
  assert.equal(vm.disposition.kind, "ready");
  assert.equal(vm.disposition.canApprove, true);
  assert.equal(vm.expiry.absolute, "10:12 WIB");
  assert.equal(vm.expiry.relative, "in 12 min");
  assert.equal(vm.acknowledgements.length, 0);
  assert.equal(vm.scopeSummary, "2 package updates, plan version 1.");
});

test("production plan: two specific acknowledgements, both tokens plus the API's required one are sent", () => {
  const vm = toPlanVM(plan({ production: true, requiredAcknowledgements: ["production-impact"] }), NOW, TZ);
  assert.equal(vm.isProduction, true);
  assert.equal(vm.acknowledgements.length, 2);
  assert.match(vm.acknowledgements[0]?.label ?? "", /recover Nabire/);
  assert.match(vm.acknowledgements[1]?.label ?? "", /interrupt services running on Nabire/);
  assert.deepEqual(vm.acknowledgementTokens, ["production-impact", "recovery-route", "interruption-risk"]);
  assert.ok(vm.preconditions.some((p) => p.state === "owner"));
});

test("writes disabled: fixed sentence, cannot approve, API text not used", () => {
  const vm = toPlanVM(
    plan({ production: true, approvable: false, scope: { packages: [], includesServiceRestart: false, includesReboot: false },
      preconditions: { previewDigest: "none" }, blockers: [{ code: "WRITES_DISABLED", message: "API wording that must not be shown" }] }),
    NOW, TZ);
  assert.equal(vm.disposition.kind, "writes-disabled");
  assert.equal(vm.disposition.reason, WRITES_OFF_TEXT);
  assert.equal(vm.disposition.canApprove, false);
  assert.equal(vm.blockers[0]?.message, WRITES_OFF_TEXT);
  assert.equal(vm.scopeSummary, "No package changes were prepared.");
  assert.ok(vm.preconditions.some((p) => p.state === "unknown"));
});

test("other blockers block with the first reason; expired blocks; both offer a refresh", () => {
  const busy = toPlanVM(plan({ approvable: false, blockers: [{ code: "TARGET_BUSY", message: "x" }] }), NOW, TZ);
  assert.equal(busy.disposition.kind, "blocked");
  assert.equal(busy.disposition.reason, "Another operation on this server has not finished.");
  assert.equal(busy.disposition.offerRefresh, true);
  const expired = toPlanVM(plan({ expiresAt: "2026-11-17T02:59:00Z" }), NOW, TZ);
  assert.equal(expired.disposition.kind, "expired");
  assert.equal(expired.disposition.canApprove, false);
  assert.equal(expired.expiry.relative, "expired");
});

test("a PLAN_CHANGED notice disables approval with a specific reason; a recoverable notice does not", () => {
  const changed = toPlanVM(plan(), NOW, TZ, { code: "PLAN_CHANGED" });
  assert.equal(changed.disposition.canApprove, false);
  assert.match(changed.disposition.reason, /did not carry over/);
  assert.equal(toPlanVM(plan(), NOW, TZ, { code: "ACK_REQUIRED" }).disposition.canApprove, true);
});

test("diffScope reports added, removed and changed packages", () => {
  const a = { name: "a", arch: "amd64", from: "1", to: "2" };
  const b = { name: "b", arch: "amd64", from: "1", to: "2" };
  const a2 = { ...a, to: "3" };
  const c = { name: "c", arch: "amd64", from: "1", to: "2" };
  const d = diffScope([a, b], [a2, c]);
  assert.deepEqual(d.added, [c]);
  assert.deepEqual(d.removed, [b]);
  assert.deepEqual(d.changed, [{ before: a, after: a2 }]);
});
