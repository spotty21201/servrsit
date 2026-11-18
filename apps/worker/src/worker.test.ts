/**
 * [SIMULATED TARGET] Care-loop invariants, end to end below the API.
 * Every scenario uses SimulatedTarget. No real server is involved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildManifest, buildPlan, createSigner, PRODUCTION_ACKS, signManifest, type Plan } from "@servrsit/domain";
import { MemoryIntentStore, SqliteCareStore, type StoredOperation } from "@servrsit/store";
import { Dispatcher, SimulatedTarget, SshWriteTarget, WritesDisabledError, type WriteTarget } from "./index.js";

const SIM = "00000000-0000-4000-8000-00000005e001";
const INSTALL = "inst-test";
const FP = "SHA256:simulated-host-key";

class Clock {
  t = new Date("2026-11-17T10:00:00.000Z").getTime();
  now = () => new Date(this.t);
  advance(ms: number) { this.t += ms; }
}

async function harness(opts: { writesEnabled?: boolean; production?: boolean; target?: "sim" | "ssh" } = {}) {
  const clock = new Clock();
  const signer = createSigner("key-1");
  const store = new SqliteCareStore({ path: ":memory:" });
  const intents = new MemoryIntentStore();
  const sim = new SimulatedTarget({
    serverId: SIM, installationId: INSTALL, hostKeyFingerprint: FP,
    trustedKeys: { [signer.keyId]: signer.publicKeyPem },
    installed: { "openssl:amd64": "3.0.13-0ubuntu3.4", "libssl3t64:amd64": "3.0.13-0ubuntu3.4" },
    upgrades: [
      { name: "openssl", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5" },
      { name: "libssl3t64", arch: "amd64", from: "3.0.13-0ubuntu3.4", to: "3.0.13-0ubuntu3.5" },
    ],
    now: clock.now, runMs: 1000,
  });
  const target: WriteTarget = opts.target === "ssh" ? new SshWriteTarget(SIM) : sim;
  let gate = opts.writesEnabled ?? true;
  const targets = new Map<string, WriteTarget>([[SIM, target]]);
  const mkDispatcher = (workerId: string) => new Dispatcher({
    store, intents, targets, writesEnabled: () => gate, signer, installationId: INSTALL, workerId, now: clock.now, leaseMs: 30_000,
  });

  const plan = buildPlan({
    id: randomUUID(), version: 1, operation: "apply.packages.v1",
    server: { id: SIM, production: opts.production ?? false, writesEnabled: true },
    preview: await sim.previewPackages(), unresolved: null, now: clock.now(), controllerClockTrusted: true,
  });
  store.insertPlan(plan);
  const approved = store.approve({
    planId: plan.id, planVersion: 1, planDigest: plan.digest, idempotencyKey: "k1", owner: "owner",
    acknowledgements: opts.production ? [...PRODUCTION_ACKS] : [], writesEnabled: true,
    targetKind: opts.target === "ssh" ? "ssh" : "simulated", now: clock.now(), newId: () => randomUUID(),
  });
  if (approved.kind !== "created") throw new Error(`approval failed: ${JSON.stringify(approved)}`);
  return {
    clock, signer, store, intents, sim, plan, op: approved.operation, dispatcher: mkDispatcher("w1"), mkDispatcher,
    setGate: (v: boolean) => { gate = v; },
    events: () => store.listEvents(approved.operation.id).map((e) => e.type),
    state: () => (store.getOperation(approved.operation.id) as StoredOperation).state,
  };
}

/** Advance simulated time and run the dispatcher to a final state. */
async function settle(h: Awaited<ReturnType<typeof harness>>, d = h.dispatcher) {
  for (let i = 0; i < 10; i++) {
    const r = await d.runOnce();
    if (r.status === "final" || r.status === "idle") return;
    h.clock.advance(1500);
  }
}

test("happy path: queued -> running -> verifying -> succeeded, one claim, installed versions verified", async () => {
  const h = await harness();
  await settle(h);
  assert.equal(h.state(), "succeeded");
  assert.deepEqual(h.events(), ["created", "dispatch_attempted", "remote_accepted", "remote_finished", "verification_recorded"]);
  assert.deepEqual(h.sim.claims, [h.op.id]);
  assert.equal(h.sim.snapshot().installed["openssl:amd64"], "3.0.13-0ubuntu3.5");
  assert.equal(h.store.getOperation(h.op.id)?.remoteOperationId, h.op.id);
  assert.ok(h.intents.get(h.op.id), "the intent record was written before dispatch");
});

test("invariant 7: a lost acknowledgement is resolved by querying the same id; no second claim, id never regenerated", async () => {
  const h = await harness();
  h.sim.faults.loseNextSubmitAck = true;
  await h.dispatcher.runOnce();
  assert.equal(h.state(), "running");
  assert.deepEqual(h.events(), ["created", "dispatch_attempted", "transport_error", "remote_accepted"]);
  await settle(h);
  assert.equal(h.state(), "succeeded");
  assert.deepEqual(h.sim.claims, [h.op.id], "exactly one claim, with the original operation id");
  assert.equal(h.sim.submitsReceived, 1);
});

test("invariant 7: a request lost before arrival is resubmitted only after the ledger says 'not found', with the identical manifest", async () => {
  const h = await harness();
  h.sim.faults.dropNextSubmitBeforeSend = true;
  await h.dispatcher.runOnce();
  assert.equal(h.state(), "queued", "nothing is assumed");
  assert.equal(h.sim.submitsReceived, 0);
  h.clock.advance(5_000); // time moves: a regenerated manifest would get a new issuedAt and digest
  await h.dispatcher.runOnce();
  assert.equal(h.state(), "running");
  const attempts = h.store.listEvents(h.op.id).filter((e) => e.type === "dispatch_attempted");
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]!.payload["manifestDigest"], attempts[1]!.payload["manifestDigest"], "the retry sends the identical manifest");
  assert.equal(attempts[1]!.payload["retry"], true);
  assert.deepEqual(h.sim.claims, [h.op.id]);
});

test("invariant 8: if the ledger cannot be reached the outcome is unknown, conflicting writes are blocked, then reconciliation resolves it", async () => {
  const h = await harness();
  h.sim.faults.loseNextSubmitAck = true;
  h.sim.faults.failQueries = 1;
  await h.dispatcher.runOnce();
  assert.equal(h.state(), "outcome_unknown");

  const second = buildPlan({ id: randomUUID(), version: 1, operation: "apply.packages.v1", server: { id: SIM, production: false, writesEnabled: true }, preview: await h.sim.previewPackages(), unresolved: "outcome_unknown", now: h.clock.now(), controllerClockTrusted: true });
  assert.deepEqual(second.blockers.map((b) => b.code), ["OUTCOME_UNKNOWN", "PACKAGE_LOCKED"]);
  h.store.insertPlan(second);
  assert.deepEqual(
    h.store.approve({ planId: second.id, planVersion: 1, planDigest: second.digest, idempotencyKey: "k2", owner: "owner", acknowledgements: [], writesEnabled: true, targetKind: "simulated", now: h.clock.now(), newId: () => randomUUID() }),
    { kind: "rejected", code: "PLAN_BLOCKED", blockers: ["OUTCOME_UNKNOWN", "PACKAGE_LOCKED"] },
  );

  await settle(h);
  assert.equal(h.state(), "succeeded");
  const types = h.events();
  assert.ok(types.includes("outcome_unknown") && types.includes("reconciled"), "the uncertainty and its resolution are both on record");
  assert.deepEqual(h.sim.claims, [h.op.id]);
});

test("invariant 6: a disconnect while running makes the outcome unknown (never failed); the target keeps working", async () => {
  const h = await harness();
  await h.dispatcher.runOnce();
  assert.equal(h.state(), "running");
  h.sim.faults.failQueries = 1;
  await h.dispatcher.runOnce();
  assert.equal(h.state(), "outcome_unknown");
  h.clock.advance(2000);
  await settle(h);
  assert.equal(h.state(), "succeeded", "the work finished despite the dropped connection");
  assert.equal(h.events().includes("cancelled"), false);
});

test("invariant 9: exit code 0 with a package that did not change is NOT success", async () => {
  const h = await harness();
  h.sim.faults.silentlyUnchanged = ["openssl:amd64"];
  await settle(h);
  assert.equal(h.state(), "partially_succeeded");
  const v = h.store.listEvents(h.op.id).find((e) => e.type === "verification_recorded")!;
  assert.deepEqual(v.payload["notVerified"], ["openssl:amd64"]);
  assert.equal(v.payload["exitCode"], 0);
});

test("invariant 9: nothing changed -> failed; everything changed but a non-zero exit -> partially_succeeded", async () => {
  const none = await harness();
  none.sim.faults.silentlyUnchanged = ["openssl:amd64", "libssl3t64:amd64"];
  await settle(none);
  assert.equal(none.state(), "failed");

  const exit = await harness();
  exit.sim.faults.exitCode = 1;
  await settle(exit);
  assert.equal(exit.state(), "partially_succeeded");
});

test("lease expiry is not proof: a worker that crashes after the claim is followed by one that reconciles, not resubmits", async () => {
  const h = await harness();
  const crashing: WriteTarget = Object.create(h.sim) as WriteTarget;
  crashing.submit = async (signed) => {
    await h.sim.submit(signed);
    throw new Error("worker process crashed after sending");
  };
  const crashed = new Dispatcher({ store: h.store, intents: h.intents, targets: new Map([[SIM, crashing]]), writesEnabled: () => true, signer: h.signer, installationId: INSTALL, workerId: "w-crash", now: h.clock.now, leaseMs: 30_000 });
  await assert.rejects(() => crashed.runOnce(), /crashed/);
  assert.equal(h.state(), "queued");
  assert.equal(await h.mkDispatcher("w2").runOnce().then((r) => r.status), "idle", "still leased by the crashed worker");

  h.clock.advance(31_000);
  await settle(h, h.mkDispatcher("w2"));
  assert.equal(h.state(), "succeeded");
  assert.deepEqual(h.sim.claims, [h.op.id], "no second mutation");
  assert.equal(h.sim.submitsReceived, 1, "the replacement worker queried instead of resubmitting");
});

test("remote ledger: identical resubmission returns the existing record; same id with a different digest is rejected", async () => {
  const h = await harness();
  const m1 = buildManifest({ installationId: INSTALL, operationId: "op-x", plan: h.plan, hostKeyFingerprint: FP, issuedAt: h.clock.now() }).manifest;
  const s1 = signManifest(m1, h.signer);
  assert.equal((await h.sim.submit(s1)).status, "accepted");
  assert.equal((await h.sim.submit(s1)).status, "existing");
  const m2 = { ...m1, issuedAt: new Date(h.clock.now().getTime() + 1).toISOString() };
  assert.deepEqual(await h.sim.submit(signManifest(m2, h.signer)), { status: "rejected", code: "DIGEST_MISMATCH" });
  assert.deepEqual(h.sim.claims, ["op-x"]);
});

test("remote ledger: one active operation per target, and it rejects bad signatures, unknown keys, misbinding and expiry", async () => {
  const h = await harness();
  const mk = (over: Partial<ReturnType<typeof buildManifest>["manifest"]> = {}, opId = randomUUID()) =>
    ({ ...buildManifest({ installationId: INSTALL, operationId: opId, plan: h.plan, hostKeyFingerprint: FP, issuedAt: h.clock.now() }).manifest, ...over });
  const other = createSigner("key-unknown");
  assert.deepEqual(await h.sim.submit(signManifest(mk(), other)), { status: "rejected", code: "UNKNOWN_KEY" });
  assert.deepEqual(await h.sim.submit({ ...signManifest(mk(), other), keyId: h.signer.keyId }), { status: "rejected", code: "INVALID_SIGNATURE" });
  assert.deepEqual(await h.sim.submit(signManifest(mk({ server: { id: SIM, hostKeyFingerprint: "SHA256:other" } }), h.signer)), { status: "rejected", code: "MISBOUND" });
  assert.deepEqual(await h.sim.submit(signManifest(mk({ installationId: "other-install" }), h.signer)), { status: "rejected", code: "MISBOUND" });
  assert.deepEqual(await h.sim.submit(signManifest(mk({ acceptBefore: new Date(h.clock.now().getTime() - 1).toISOString() }), h.signer)), { status: "rejected", code: "EXPIRED" });
  assert.equal((await h.sim.submit(signManifest(mk(), h.signer))).status, "accepted");
  assert.deepEqual(await h.sim.submit(signManifest(mk(), h.signer)), { status: "rejected", code: "TARGET_BUSY" });
  assert.equal(h.sim.claims.length, 1);
});

test("a target rejection records failure with no effects; a changed machine is rejected by its precondition", async () => {
  const h = await harness();
  h.sim.addUpgrade({ name: "curl", arch: "amd64", from: "8.5.0-2ubuntu10.5", to: "8.5.0-2ubuntu10.6" });
  await h.dispatcher.runOnce();
  assert.equal(h.state(), "failed");
  const ev = h.store.listEvents(h.op.id).find((e) => e.type === "remote_rejected")!;
  assert.equal(ev.payload["code"], "PRECONDITION_CHANGED");
  assert.match(String(ev.payload["effects"]), /^none/);
  assert.deepEqual(h.sim.claims, []);
});

test("invariant 4: a plan that expired before dispatch is cancelled before start; nothing is sent", async () => {
  const h = await harness();
  h.clock.advance(15 * 60_000);
  await h.dispatcher.runOnce();
  assert.equal(h.state(), "cancelled_before_start");
  assert.equal(h.sim.submitsReceived, 0);
});

test("invariant 12: the gate is rechecked at dispatch; if it is off nothing is sent", async () => {
  const h = await harness();
  h.setGate(false);
  await h.dispatcher.runOnce();
  assert.equal(h.state(), "cancelled_before_start");
  assert.equal(h.sim.submitsReceived, 0);
  const ev = h.store.listEvents(h.op.id).find((e) => e.type === "cancelled")!;
  assert.equal(ev.payload["code"], "WRITES_DISABLED");
});

test("invariant 12: even with the gate open, the dispatcher never sends to a real (ssh) target", async () => {
  const h = await harness({ target: "ssh" });
  await h.dispatcher.runOnce();
  assert.equal(h.state(), "cancelled_before_start");
  assert.equal(h.sim.submitsReceived, 0);
});

test("invariant 12: the real SSH write target refuses everything with WRITES_DISABLED", async () => {
  const t = new SshWriteTarget("11111111-1111-4111-a111-111111111111");
  const h = await harness();
  const signed = signManifest(buildManifest({ installationId: INSTALL, operationId: "op", plan: h.plan, hostKeyFingerprint: FP, issuedAt: h.clock.now() }).manifest, h.signer);
  assert.deepEqual(await t.submit(signed), { status: "rejected", code: "WRITES_DISABLED" });
  assert.equal(await t.previewPackages(), null);
  await assert.rejects(() => t.query("op"), WritesDisabledError);
  await assert.rejects(() => t.inspectInstalled(["x:amd64"]), WritesDisabledError);
});

test("invariant 12: the real SSH write target cannot start a process or open a connection (no such imports)", () => {
  const src = readFileSync(new URL("./ssh-write-target.ts", import.meta.url), "utf8");
  for (const mod of ["child_process", "node:net", "node:tls", "node:dgram", "node:http", "node:https", "@servrsit/ssh", "spawn", "exec"]) {
    assert.equal(new RegExp(`from ["'][^"']*${mod}|\\b${mod}\\(`).test(src), false, mod);
  }
  const imports = [...src.matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./target.js", "@servrsit/domain"]);
});

test("invariant 11: fault injection exists only on the simulated target", () => {
  const t = new SshWriteTarget("11111111-1111-4111-a111-111111111111");
  assert.equal("faults" in t, false);
});

test("invariant 5: a package manifest carries only package changes, never a restart or reboot", async () => {
  const h = await harness();
  const { manifest } = buildManifest({ installationId: INSTALL, operationId: "op", plan: h.plan, hostKeyFingerprint: FP, issuedAt: h.clock.now() });
  assert.equal(manifest.operation, "apply.packages.v1");
  assert.deepEqual(Object.keys(manifest.scope), ["packages"]);
  const p: Plan = h.plan;
  assert.equal(p.scope.includesServiceRestart, false);
  assert.equal(p.scope.includesReboot, false);
});
