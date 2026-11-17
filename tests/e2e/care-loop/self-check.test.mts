/**
 * Self-check of the scenarios. This tests the TESTS, not the product.
 *
 *  1. Every scenario passes on the spec-derived reference model (it can pass).
 *  2. For each deliberate fault ("mutant") the named scenarios fail (it can fail).
 *  3. No mutant survives: each fault is caught by at least one scenario.
 *
 * Passing here says nothing about Coder's implementation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ReferenceModel, type Mutant } from "./reference-model.mts";
import { scenarios } from "./scenarios.mts";

async function failing(mutants: readonly Mutant[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const sc of scenarios) {
    try {
      await sc.run(new ReferenceModel(new Set(mutants)));
    } catch (e) {
      out.set(sc.id, (e as Error).message.split("\n")[0]!.slice(0, 160));
    }
  }
  return out;
}

test("scenario ids are unique and every scenario states its traces and spec source", () => {
  const ids = scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate scenario id");
  for (const s of scenarios) {
    assert.ok(s.traces.length > 0, `${s.id} has no traces`);
    assert.ok(s.spec.length > 0, `${s.id} has no spec citation`);
    assert.match(s.id, /^CL-\d\d[a-z]$/);
  }
});

test("every scenario passes on the correct reference model", async () => {
  const f = await failing([]);
  assert.deepEqual([...f.entries()], [], `scenarios failing on the correct model: ${JSON.stringify([...f.entries()])}`);
});

/** mutant -> scenarios that MUST fail when that rule is broken. */
type Fault = Exclude<Mutant, "planBlocksOnWrites">;
const EXPECT: Record<Fault, string[]> = {
  noExpiry: ["CL-01b", "CL-01e"],
  expiryKillsAccepted: ["CL-01d"],
  ignoreDigest: ["CL-02a", "CL-02b"],
  ignoreVersion: ["CL-02c"],
  acksNotRequired: ["CL-02e", "CL-01c"],
  noCsrf: ["CL-02f"],
  noAuth: ["CL-02g"],
  onlyPackages: ["CL-09a"],
  noIdempotency: ["CL-03a", "CL-03b", "CL-03f"],
  duplicateOps: ["CL-03a", "CL-03b", "CL-03c"],
  noTargetBusy: ["CL-03d", "CL-03e", "CL-06a"],
  noTxnRecheck: ["CL-04a", "CL-04c"],
  ignoreRemovalBlock: ["CL-04d"],
  noQueryBeforeRetry: ["CL-05a", "CL-05b", "CL-05c"],
  regenIdOnRetry: ["CL-05b"],
  unknownDoesNotBlock: ["CL-06a", "CL-06b"],
  leaseExpiryUnblocks: ["CL-06b"],
  reconcileRedispatches: ["CL-06e"],
  stopKills: ["CL-07a"],
  stopCancelsQueuedWithoutQuery: ["CL-07c"],
  writesGateMissing: ["CL-08b", "CL-08c", "CL-08e"],
  writesGateApproveOnly: ["CL-08e"],
  clientOverride: ["CL-08c"],
  assistantApproves: ["CL-08d"],
  defaultWritesTrue: ["CL-08b", "CL-08e"],
};

test('the correct model also passes when planning itself refuses write-disabled servers (second legal design)', async () => {
  const f = await failing(["planBlocksOnWrites"]);
  assert.deepEqual([...f.entries()], [], `failing: ${JSON.stringify([...f.entries()])}`);
});

for (const [mutant, must] of Object.entries(EXPECT) as [Fault, string[]][]) {
  test(`fault "${mutant}" is caught by ${must.join(", ")}`, async () => {
    const f = await failing([mutant]);
    for (const id of must) assert.ok(f.has(id), `${id} did not fail when "${mutant}" was introduced (it can't detect this bug). Failing: ${[...f.keys()].join(", ") || "none"}`);
    assert.ok(f.size > 0, `mutant "${mutant}" survived: no scenario noticed`);
  });
}
