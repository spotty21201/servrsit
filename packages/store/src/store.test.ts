import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { buildPlan, PRODUCTION_ACKS, TransitionError, type Plan, type TransactionPreview } from "@servrsit/domain";
import { FileIntentStore, IntentConflictError, SqliteCareStore } from "./index.js";

const NOW = new Date("2026-11-17T10:00:00.000Z");
const SERVER = "00000000-0000-4000-8000-0000000051a1";
const preview: TransactionPreview = {
  upgrades: [{ name: "openssl", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5", origin: "Ubuntu:24.04/noble-updates" }],
  removals: [], downgrades: [], held: [], locked: false, stateDigest: "sha256:s",
};

function fresh(opts: { beforeApprovalCommit?: () => void } = {}) {
  const path = join(mkdtempSync(join(tmpdir(), "servrsit-store-")), "care.db");
  return { path, store: new SqliteCareStore({ path, ...opts }) };
}

function makePlan(over: Partial<Parameters<typeof buildPlan>[0]> = {}): Plan {
  return buildPlan({
    id: "plan-1", version: 1, operation: "apply.packages.v1",
    server: { id: SERVER, production: true, writesEnabled: true },
    preview, unresolved: null, now: NOW, controllerClockTrusted: true, ...over,
  });
}

const approveArgs = (plan: Plan, over: Record<string, unknown> = {}) => ({
  planId: plan.id, planVersion: plan.version, planDigest: plan.digest, idempotencyKey: "key-1",
  owner: "owner-1", acknowledgements: [...PRODUCTION_ACKS], writesEnabled: true, targetKind: "simulated" as const,
  now: new Date(NOW.getTime() + 60_000), newId: () => randomUUID(), ...over,
});

test("approval creates approval + queued operation + created event + outbox entry together", () => {
  const { store } = fresh();
  const plan = makePlan();
  store.insertPlan(plan);
  const r = store.approve(approveArgs(plan));
  assert.equal(r.kind, "created");
  if (r.kind !== "created") return;
  assert.equal(r.operation.state, "queued");
  assert.equal(r.operation.serverId, SERVER);
  assert.deepEqual(store.listEvents(r.operation.id).map((e) => [e.type, e.toState]), [["created", "queued"]]);
  const lease = store.leaseOutbox("w1", NOW, 30_000);
  assert.equal(lease?.operationId, r.operation.id);
});

test("approval is all-or-nothing: a failure before commit leaves no approval, operation, event or outbox row", () => {
  let fail = true;
  const { store } = fresh({ beforeApprovalCommit: () => { if (fail) throw new Error("crash before commit"); } });
  const plan = makePlan();
  store.insertPlan(plan);
  assert.throws(() => store.approve(approveArgs(plan)), /crash before commit/);
  assert.equal(store.unresolvedFor(SERVER), null);
  assert.equal(store.leaseOutbox("w1", NOW, 30_000), null);
  fail = false;
  assert.equal(store.approve(approveArgs(plan)).kind, "created", "a retry after the crash still works");
});

test("idempotency: the same key returns the same operation; a different key for the same version is refused", () => {
  const { store } = fresh();
  const plan = makePlan();
  store.insertPlan(plan);
  const first = store.approve(approveArgs(plan));
  const again = store.approve(approveArgs(plan));
  assert.equal(again.kind, "replayed");
  assert.equal(first.kind === "created" && again.kind === "replayed" && first.operation.id === again.operation.id, true);
  assert.deepEqual(store.approve(approveArgs(plan, { idempotencyKey: "key-2" })), { kind: "rejected", code: "ALREADY_APPROVED" });
});

test("invariant 4: approval binds to the exact plan version, digest and expiry", () => {
  const { store } = fresh();
  const v1 = makePlan();
  store.insertPlan(v1);
  assert.deepEqual(store.approve(approveArgs(v1, { planDigest: "sha256:wrong" })), { kind: "rejected", code: "PLAN_CHANGED" });
  assert.deepEqual(store.approve(approveArgs(v1, { now: new Date(Date.parse(v1.expiresAt)) })), { kind: "rejected", code: "PLAN_EXPIRED" });
  const v2 = makePlan({ version: 2 });
  store.insertPlan(v2);
  assert.deepEqual(store.approve(approveArgs(v1)), { kind: "rejected", code: "PLAN_CHANGED" }, "a newer version invalidates the old one");
  assert.equal(store.approve(approveArgs(v2)).kind, "created");
});

test("blocked plans, the write gate and missing production acknowledgements are refused", () => {
  const { store } = fresh();
  const blocked = makePlan({ id: "pb", server: { id: SERVER, production: true, writesEnabled: false }, preview: null });
  store.insertPlan(blocked);
  assert.deepEqual(store.approve(approveArgs(blocked)), { kind: "rejected", code: "PLAN_BLOCKED", blockers: ["WRITES_DISABLED"] });

  const ok = makePlan({ id: "pok" });
  store.insertPlan(ok);
  assert.deepEqual(store.approve(approveArgs(ok, { writesEnabled: false })), { kind: "rejected", code: "WRITES_DISABLED" }, "gate rechecked at approval");
  assert.deepEqual(store.approve(approveArgs(ok, { acknowledgements: [] })), { kind: "rejected", code: "ACK_REQUIRED" });
});

test("invariant 8 / one unresolved mutation per server: busy and unknown outcomes block a second approval", () => {
  const { store } = fresh();
  const a = makePlan({ id: "pa" });
  const b = makePlan({ id: "pb" });
  store.insertPlan(a);
  store.insertPlan(b);
  const first = store.approve(approveArgs(a));
  assert.equal(first.kind, "created");
  assert.deepEqual(store.approve(approveArgs(b)), { kind: "rejected", code: "TARGET_BUSY" });
  if (first.kind !== "created") return;
  store.transition(first.operation.id, "outcome_unknown", "outcome_unknown", "worker", {}, NOW);
  assert.deepEqual(store.approve(approveArgs(b)), { kind: "rejected", code: "OUTCOME_UNKNOWN" });
});

test("the database itself enforces one unresolved operation per server, even bypassing the code", () => {
  const { path, store } = fresh();
  const a = makePlan({ id: "pa" });
  const b = makePlan({ id: "pb" });
  store.insertPlan(a);
  store.insertPlan(b);
  const r = store.approve(approveArgs(a));
  assert.equal(r.kind, "created");
  const raw = new DatabaseSync(path);
  raw.exec("INSERT INTO approvals VALUES ('ap2','pb',1,'d','k','o','[]','t')");
  assert.throws(
    () => raw.exec(`INSERT INTO operations (id, approval_id, plan_id, plan_version, server_id, operation, target_kind, state, created_at, updated_at) VALUES ('op2','ap2','pb',1,'${SERVER}','apply.packages.v1','simulated','queued','t','t')`),
    /UNIQUE constraint failed/,
  );
  raw.close();
});

test("final states are final: in code (TransitionError) and in the database (trigger)", () => {
  const { path, store } = fresh();
  const plan = makePlan();
  store.insertPlan(plan);
  const r = store.approve(approveArgs(plan));
  if (r.kind !== "created") return assert.fail("not created");
  const id = r.operation.id;
  store.transition(id, "running", "remote_accepted", "worker", {}, NOW);
  store.transition(id, "failed", "remote_finished", "worker", { exitCode: 1 }, NOW);
  assert.throws(() => store.transition(id, "succeeded", "reconciled", "worker", {}, NOW), TransitionError);
  const raw = new DatabaseSync(path);
  assert.throws(() => raw.exec(`UPDATE operations SET state = 'succeeded' WHERE id = '${id}'`), /final operation state cannot change/);
  raw.close();
  assert.equal(store.getOperation(id)?.state, "failed");
  store.appendEvent(id, "evidence_appended", "worker", { note: "later evidence is appended, not written over" }, NOW);
  assert.equal(store.listEvents(id).at(-1)?.type, "evidence_appended");
});

test("events, plans and approvals are append-only in the database", () => {
  const { path, store } = fresh();
  const plan = makePlan();
  store.insertPlan(plan);
  const r = store.approve(approveArgs(plan));
  if (r.kind !== "created") return assert.fail("not created");
  const raw = new DatabaseSync(path);
  for (const sql of [
    `UPDATE operation_events SET type = 'x' WHERE operation_id = '${r.operation.id}'`,
    `DELETE FROM operation_events`,
    `UPDATE plans SET digest = 'x'`,
    `DELETE FROM plans`,
    `UPDATE approvals SET plan_digest = 'x'`,
    `DELETE FROM operations`,
  ]) assert.throws(() => raw.exec(sql), /immutable|append-only|never deleted/, sql);
  raw.close();
});

test("lease: an expired lease can be re-leased; lease expiry does not change the operation", () => {
  const { store } = fresh();
  const plan = makePlan();
  store.insertPlan(plan);
  const r = store.approve(approveArgs(plan));
  const first = store.leaseOutbox("w1", NOW, 30_000);
  assert.equal(store.leaseOutbox("w2", new Date(NOW.getTime() + 10_000), 30_000), null, "still leased");
  const second = store.leaseOutbox("w2", new Date(NOW.getTime() + 31_000), 30_000);
  assert.equal(second?.operationId, first?.operationId);
  assert.equal(second?.attempts, 2);
  assert.equal(r.kind === "created" && store.getOperation(r.operation.id)?.state, "queued", "lease expiry proves nothing about the operation");
});

test("FileIntentStore is write-once: same digest is a no-op, a different digest is refused; files are 0600", () => {
  const dir = mkdtempSync(join(tmpdir(), "servrsit-intent-"));
  const intents = new FileIntentStore(join(dir, "intents"));
  assert.equal(intents.put("op-1", "sha256:a", { x: 1 }), "created");
  assert.equal(intents.put("op-1", "sha256:a", { x: 1 }), "exists");
  assert.throws(() => intents.put("op-1", "sha256:b", { x: 2 }), IntentConflictError);
  assert.deepEqual(intents.get("op-1"), { digest: "sha256:a", body: { x: 1 } });
  assert.equal(statSync(join(dir, "intents", "op-1.json")).mode & 0o777, 0o600);
  assert.throws(() => intents.put("../escape", "d", {}), /invalid intent key/);
});

test("T-056: one unresolved operation per machine across records, enforced by the database", () => {
  const { store } = fresh();
  const p1 = makePlan({ id: "plan-a" });
  store.insertPlan(p1);
  const machine = "machine:sha256:" + "a".repeat(64);
  const first = store.approve({ ...approveArgs(p1), canonicalId: machine });
  assert.equal(first.kind, "created");
  const other = buildPlan({
    id: "plan-b", version: 1, operation: "apply.packages.v1",
    server: { id: "00000000-0000-4000-8000-0000000000b2", production: false, writesEnabled: true },
    preview: { upgrades: [{ name: "openssl", arch: "amd64", from: "1", to: "2", origin: "Ubuntu:24.04/noble-updates" }], removals: [], downgrades: [], held: [], locked: false, stateDigest: "sha256:x" },
    unresolved: null, now: NOW, controllerClockTrusted: true,
  });
  store.insertPlan(other);
  const second = store.approve({ ...approveArgs(other, { idempotencyKey: "key-2", acknowledgements: [] }), canonicalId: machine });
  assert.deepEqual(second, { kind: "rejected", code: "TARGET_BUSY" }, "another record of the same machine is busy");
  assert.notEqual(store.unresolvedForMachine(machine), null);
});
