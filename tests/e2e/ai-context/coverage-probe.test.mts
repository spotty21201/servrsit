/**
 * How wide is the fact check on the INCIDENT CLASS? Every phrasing below is FALSE
 * in the fleet (Nabire has 1 pending update; Sentani has no observation at all).
 * A phrasing that gets through is a hole. Zero AI calls.
 *
 * The checker is lexical, so it can never be complete; this probe measures how far
 * it goes and lists every phrasing it misses, so a fix can be targeted and
 * re-measured. It also asks whether the neutral deterministic text is shown instead.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AssistantResponder } from "../../../packages/ai/src/index.ts";
import { ScriptedProvider } from "./support/providers.mts";
import { CTX, FACTS, synth, type Spec } from "./support/synthetic.mts";

const FLEET: Spec[] = Object.values(FACTS);
const NABIRE_NOTHING_PENDING = [
  "Nabire has no pending updates.", "Nabire has 0 updates pending.", "No pending updates for Nabire.",
  "There are no updates waiting on Nabire.", "Nabire is up to date.", "Nabire is fully patched.", "Nabire is current.",
  "Nabire is all caught up.", "Nabire has nothing to update.", "Nothing to update on Nabire.",
  "Nothing is waiting to be installed on Nabire.", "Nabire doesn't need any updates.", "Nabire needs no updates.",
  "Nabire has no available upgrades.", "Updates: none for Nabire.", "Nabire: no updates.", "Nabire is fine, no updates to apply.",
  "All packages on Nabire are current.", "Nabire's packages are all up to date.", "You don't need to update Nabire.",
  "Nabire is on the latest versions.", "Nabire has zero outstanding updates.", "Nabire is clean on updates.",
  "No package updates are available for Nabire.",
];
const SENTANI_UNSUPPORTED_HEALTH = [
  "Sentani is healthy.", "Sentani is fine.", "Sentani looks good.", "Sentani is OK.", "Everything is fine with Sentani.",
  "Sentani has no problems.", "Nothing is wrong with Sentani.", "Sentani is running normally.", "Sentani is up and running.",
];

async function accepted(text: string, specs: Spec[]): Promise<boolean> {
  const r = await new AssistantResponder(new ScriptedProvider(text)).respond("status?", specs.map(synth), CTX);
  return r.source === "ai";
}

test("incident class: every false way of saying 'nothing pending on Nabire' is rejected", async () => {
  const missed: string[] = [];
  for (const t of NABIRE_NOTHING_PENDING) if (await accepted(t, FLEET)) missed.push(t);
  const caught = NABIRE_NOTHING_PENDING.length - missed.length;
  console.log(`[coverage] false 'nothing pending on Nabire': caught ${caught} of ${NABIRE_NOTHING_PENDING.length}`);
  assert.deepEqual(missed, [], `${missed.length} FALSE claims reached the owner:\n${missed.map((m) => "  " + m).join("\n")}`);
});

test("unsupported health claims about a server with NO observation are rejected", async () => {
  const specs: Spec[] = [FACTS.Timika, FACTS.Nabire, { name: "Sentani", production: false, withObservation: false, status: "unreachable", reason: "route unavailable", lastAttemptFailed: true }, FACTS.Merauke];
  const missed: string[] = [];
  for (const t of SENTANI_UNSUPPORTED_HEALTH) if (await accepted(t, specs)) missed.push(t);
  console.log(`[coverage] unsupported 'Sentani is fine': caught ${SENTANI_UNSUPPORTED_HEALTH.length - missed.length} of ${SENTANI_UNSUPPORTED_HEALTH.length}`);
  assert.deepEqual(missed, [], `${missed.length} unsupported health claims reached the owner:\n${missed.map((m) => "  " + m).join("\n")}`);
});

test("scope: a claim about a server that was NOT in the data is rejected", async () => {
  const missed: string[] = [];
  for (const [t, scope] of [
    ["Nabire has one pending update and Sentani has six.", ["Nabire"]],
    ["Timika has no failed services.", ["Nabire"]],
    ["Sentani's disk is 71% full.", ["Nabire", "Merauke"]],
    ["Merauke is up to date; Timika has 2 updates.", ["Merauke"]],
  ] as [string, string[]][]) {
    if (await accepted(t, FLEET.filter((s) => scope.includes(s.name)))) missed.push(`${t}   (scope: ${scope.join(", ")})`);
  }
  assert.deepEqual(missed, [], `claims about servers outside the data reached the owner:\n${missed.join("\n")}`);
});

// ---------------------------------------------------------------------------
// Gaps Coder disclosed in the T-051 handoff. Confirmed here so they are measured, not assumed.
// ---------------------------------------------------------------------------
test("disclosed gap: a DECIMAL (load) moved to the wrong server is rejected", async () => {
  const swapped = ["Sentani's load is 0.13.", "Nabire's load is 1.4.", "Merauke's load is 0.31.", "Timika's load is 0.6."];
  const missed: string[] = [];
  for (const t of swapped) if (await accepted(t, FLEET)) missed.push(t);
  assert.deepEqual(missed, [], `load figures attributed to the wrong server reached the owner (the same class as the original incident, for decimals):\n${missed.join("\n")}`);
});

test("disclosed gap: a NEGATED status word that is false is rejected ('Timika is not healthy' when it is)", async () => {
  const missed: string[] = [];
  for (const t of ["Timika is not healthy.", "Nabire isn't healthy.", "Merauke is not fresh."]) if (await accepted(t, FLEET)) missed.push(t);
  assert.deepEqual(missed, [], `false negative-status claims reached the owner (false alarms about a healthy server):\n${missed.join("\n")}`);
});

test("disclosed gap: 'has none' with no noun is checked", async () => {
  const missed: string[] = [];
  for (const t of ["Nabire has none.", "Nabire: none.", "Sentani has none pending."]) if (await accepted(t, FLEET)) missed.push(t);
  assert.deepEqual(missed, [], `false 'none' claims reached the owner:\n${missed.join("\n")}`);
});
