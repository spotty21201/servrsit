/**
 * FREE. Replays what the real model ACTUALLY said (stored raw answers from the metered
 * calls) through the current pipeline, including the T-051 fact check.
 * Measures the false-positive rate on real output: how often does the checker throw
 * away a good answer. Spends nothing: the answers come from a file.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AssistantResponder } from "../../../packages/ai/src/index.ts";
import { ScriptedProvider, callLog } from "./support/providers.mts";
import { REAL } from "./support/real-scenarios.mts";
import { CTX } from "./support/synthetic.mts";

const rows: string[] = [];
for (const sc of REAL) {
  const stored = callLog().find((c) => c.label === sc.label && c.answer !== null);
  test(`replay ${sc.label}: the real model's actual answer is judged by the current pipeline`, async (t) => {
    if (!stored) { t.skip("no stored answer for this label"); return; }
    const reply: any = await new AssistantResponder(new ScriptedProvider(stored.answer!)).respond(sc.message, sc.servers, CTX, sc.ownerContext);
    rows.push(`${sc.label.padEnd(30)} -> ${reply.source === "ai" ? "ACCEPTED" : `REJECTED (${reply.reason}${reply.factMismatch ? ": " + reply.factMismatch : ""})`}`);
    assert.equal(reply.source, "ai", `a correct real answer was thrown away: reason ${reply.reason}, kind ${reply.factMismatch ?? "-"}. Answer: ${stored.answer!.slice(0, 200)}`);
  });
}
test("zz: replay table", () => console.log("\n[replay of real answers through the current pipeline]\n" + rows.join("\n")));
