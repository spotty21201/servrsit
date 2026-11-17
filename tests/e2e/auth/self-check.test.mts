/**
 * Self-check of the auth scenarios. Tests the TESTS, not the product:
 *  1. every scenario passes on the correct reference model (it can pass)
 *  2. each deliberate fault is caught by the scenarios named (it can fail)
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ReferenceAuth, type Fault } from "./reference-model.mts";
import { scenarios } from "./scenarios.mts";

async function failing(faults: readonly Fault[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const sc of scenarios) {
    try { await sc.run(new ReferenceAuth(new Set(faults))); }
    catch (e) { out.set(sc.id, (e as Error).message.split("\n")[0]!.slice(0, 140)); }
  }
  return out;
}

test("scenario ids are unique and cite their spec source", () => {
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
  for (const s of scenarios) { assert.ok(s.spec.length > 0, s.id); assert.match(s.id, /^AU-\d\d[a-z]$/); }
});

test("every scenario passes on the correct reference model", async () => {
  const f = await failing([]);
  assert.deepEqual([...f.entries()], [], JSON.stringify([...f.entries()]));
});

const EXPECT: Record<Fault, string[]> = {
  noSingleUseSetup: ["AU-01a", "AU-01b"], setupRace: ["AU-01b"], weakSetupToken: ["AU-01d"],
  noReplayProtection: ["AU-03a", "AU-03b"], noLockout: ["AU-04a", "AU-04b"], lockoutPerClient: ["AU-04b"],
  lockoutTooLate: ["AU-04a"], lockoutForever: ["AU-04c"], lockoutTooEager: ["AU-04d"], wideWindow: ["AU-02c"],
  verboseErrors: ["AU-02b"], arrayCodeAccepted: ["AU-04e"], nonOpaqueSession: ["AU-05a"], shortCookie: ["AU-05a"],
  sessionFixation: ["AU-05b"], noLogoutInvalidate: ["AU-05c"], noIdleExpiry: ["AU-05d"], idleTooShort: ["AU-05d"],
  noAbsoluteExpiry: ["AU-05e"], noCsrf: ["AU-06a", "AU-06b"], csrfNotBoundToSession: ["AU-06a"], noOriginCheck: ["AU-06b"],
  logsCode: ["AU-07a"], logsSetupToken: ["AU-07a"], logsCookie: ["AU-07a"], echoesInput: ["AU-07b"],
  secretInLoginResponse: ["AU-02a"], notHttpOnly: ["AU-05a"],
};

for (const [fault, must] of Object.entries(EXPECT) as [Fault, string[]][]) {
  test(`fault "${fault}" is caught by ${must.join(", ")}`, async () => {
    const f = await failing([fault]);
    for (const id of must) assert.ok(f.has(id), `${id} did not fail when "${fault}" was introduced. Failing: ${[...f.keys()].join(", ") || "none"}`);
  });
}
