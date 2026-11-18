import { test } from "node:test";
import assert from "node:assert/strict";
import { ACK_INTERRUPTION_RISK, ACK_RECOVERY_ROUTE, PRODUCTION_ACKNOWLEDGEMENT_TEXT } from "@servrsit/contracts";
import { toPlanView, type PlanView } from "../api/care";
import { diffScope, toPlanVM, WRITES_OFF_TEXT } from "./planViewModel";

const NOW = new Date("2026-11-17T03:00:00Z"); // 10:00 WIB
const TZ = "Asia/Jakarta";

function plan(over: Partial<PlanView> = {}): PlanView {
  return {
    id: "p1", version: 1, operation: "apply.packages.v1", serverId: "s1", production: false,
    scope: { packages: [{ name: "curl", arch: "amd64", from: "8.5.0-1", to: "8.5.0-2" }, { name: "openssl", arch: "amd64", from: "3.0.1", to: "3.0.2" }], includesServiceRestart: false, includesReboot: false },
    detail: {}, preconditions: { previewDigest: "sha256:x" }, verification: { expectInstalled: { "curl:amd64": "8.5.0-2" } },
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

test("production plan: the contract's two confirmations with their exact text, and exactly the API's tokens are sent", () => {
  const vm = toPlanVM(plan({ production: true, requiredAcknowledgements: [ACK_RECOVERY_ROUTE, ACK_INTERRUPTION_RISK] }), NOW, TZ);
  assert.equal(vm.isProduction, true);
  assert.equal(vm.acknowledgements.length, 2);
  assert.equal(vm.acknowledgements[0]?.label, PRODUCTION_ACKNOWLEDGEMENT_TEXT[ACK_RECOVERY_ROUTE]);
  assert.equal(vm.acknowledgements[1]?.label, PRODUCTION_ACKNOWLEDGEMENT_TEXT[ACK_INTERRUPTION_RISK]);
  assert.deepEqual(vm.acknowledgementTokens, ["recovery-route-confirmed", "interruption-risk-understood"]);
  assert.ok(vm.preconditions.some((p) => p.state === "owner"));
});

test("a confirmation token this page cannot show blocks approval instead of being invented", () => {
  const vm = toPlanVM(plan({ production: true, requiredAcknowledgements: [ACK_RECOVERY_ROUTE, "something-new"] }), NOW, TZ);
  assert.equal(vm.disposition.canApprove, false);
  assert.match(vm.disposition.reason, /does not know how to show/);
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

test("clock untrusted: approval is paused with the clock reason, expiry and ages are marked ≈", () => {
  const vm = toPlanVM(plan(), NOW, TZ, null, true);
  assert.equal(vm.disposition.canApprove, false);
  assert.equal(vm.disposition.title, "Approvals are paused");
  assert.match(vm.disposition.reason, /clock is wrong/);
  assert.equal(vm.expiry.relative, "≈ in 12 min");
  assert.match(vm.createdText, /≈ 3 min ago/);
  assert.equal(toPlanVM(plan(), NOW, TZ, null, false).disposition.canApprove, true);
});

const NO_PKGS = { packages: [], includesServiceRestart: false, includesReboot: false } as const;

test("a directory plan: title, what is created, what already exists and stays, exact approve label", () => {
  const dirs = [{ path: "/srv/app", owner: "deploy", group: "deploy", mode: "0755" }, { path: "/srv/backups/app", owner: "root", group: "root", mode: "0750" }];
  const vm = toPlanVM(plan({ operation: "prepare.directories.v1", scope: NO_PKGS, detail: { requested: dirs, directories: dirs, existing: ["/srv/tools"] } }), NOW, TZ);
  assert.equal(vm.kind, "prepare.directories.v1");
  assert.equal(vm.title, "Create directories on Nabire");
  assert.equal(vm.approveLabel, "Approve creating directories on Nabire");
  assert.equal(vm.scopeSummary, "2 directories to create, 1 path already exists and stays as it is. Plan version 1.");
  assert.deepEqual(vm.directories.map((d) => d.path), ["/srv/app", "/srv/backups/app"]);
  assert.deepEqual(vm.existing, ["/srv/tools"]);
  assert.match(vm.exclusions.join(" "), /nothing is overwritten, re-owned or changed recursively/);
  assert.match(vm.verifyChecks.join(" "), /exactly the approved owner, group and mode/);
  assert.equal(vm.packages.length, 0);
  const none = toPlanVM(plan({ operation: "prepare.directories.v1", scope: NO_PKGS, detail: { requested: dirs, directories: [], existing: ["/srv/app"] }, approvable: false, blockers: [{ code: "NO_CHANGES", message: "x" }] }), NOW, TZ);
  assert.equal(none.disposition.reason, "Every requested path already exists, so there is nothing to create.");
});

test("malformed directory entries from the API are dropped, not shown", () => {
  const vm = toPlanVM(plan({ operation: "prepare.directories.v1", scope: NO_PKGS, detail: { directories: [{ path: "/srv/a", owner: "x", group: "x", mode: "0755" }, { path: 5 }, null, "x"], existing: ["/srv/b", 3] } }), NOW, TZ);
  assert.deepEqual(vm.directories.map((d) => d.path), ["/srv/a"]);
  assert.deepEqual(vm.existing, ["/srv/b"]);
});

test("a restart plan names the one service, never reads as a reboot or an update", () => {
  const vm = toPlanVM(plan({ operation: "restart.service.v1", scope: { packages: [], includesServiceRestart: true, includesReboot: false }, detail: { unit: "nginx.service" } }), NOW, TZ);
  assert.equal(vm.title, "Restart nginx.service on Nabire");
  assert.equal(vm.approveLabel, "Approve restart of nginx.service");
  assert.equal(vm.unit, "nginx.service");
  assert.match(vm.exclusions.join(" "), /No reboot/);
  assert.match(vm.verifyChecks.join(" "), /start time is new/);
  assert.doesNotMatch(vm.title, /update/i);
  // an odd unit name from the API is not shown as the service
  assert.equal(toPlanVM(plan({ operation: "restart.service.v1", scope: NO_PKGS, detail: { unit: "x y; rm -rf /" } }), NOW, TZ).unit, null);
});

test("a reboot plan is the whole machine and its own approval", () => {
  const vm = toPlanVM(plan({ operation: "reboot.host.v1", scope: { packages: [], includesServiceRestart: false, includesReboot: true }, detail: {} }), NOW, TZ);
  assert.equal(vm.title, "Reboot Nabire");
  assert.equal(vm.approveLabel, "Approve reboot of Nabire");
  assert.match(vm.impact.join(" "), /Every service on Nabire stops/);
  assert.match(vm.impact.join(" "), /its own approval/);
  assert.match(vm.verifyChecks.join(" "), /boot id is new/);
});

test("the real API's plan shape passes the guard and renders; new blocker codes have fixed text", () => {
  const real = {
    id: "884e1a11-57db-463d-83ed-3a055ff6e650", version: 1, operation: "restart.service.v1", serverId: "22222222-2222-4222-a222-222222222222", production: true,
    scope: { unit: "nginx.service", includesServiceRestart: true, includesReboot: false }, preconditions: { previewDigest: "none" }, verification: { unit: "nginx.service", previousActiveSince: null },
    requiredAcknowledgements: [ACK_RECOVERY_ROUTE, ACK_INTERRUPTION_RISK], createdAt: "2026-11-17T02:58:00Z", expiresAt: "2026-11-17T03:13:00Z",
    blockers: [{ code: "WRITES_DISABLED", message: "x" }, { code: "UNIT_NOT_SELECTED", message: "x" }, { code: "IDENTITY_UNVERIFIED", message: "x" }],
    digest: `sha256:${"a".repeat(64)}`, target: { serverId: "22222222-2222-4222-a222-222222222222", name: "Nabire", kind: "ssh", simulated: false }, approvable: false,
  };
  const p = toPlanView(real);
  assert.ok(p);
  const vm = toPlanVM(p, NOW, TZ);
  assert.equal(vm.disposition.kind, "writes-disabled");
  assert.equal(vm.unit, "nginx.service");
  assert.match(vm.blockers.map((b) => b.message).join(" "), /not in your selected set/);
  assert.match(vm.blockers.map((b) => b.message).join(" "), /identity has not been verified/);
  assert.equal(toPlanView({ ...real, scope: null }), null);
});
