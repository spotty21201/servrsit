/**
 * T-051 deterministic fact check, tested BLACK-BOX through the real assistant
 * pipeline with a scripted fake model (zero AI calls). Each case replays one
 * specific model answer and states whether the owner may see it.
 *
 * Source of expectations: the DEF-L1/L2 investigation (the Nabire/Merauke
 * misattribution), principle 1 ("evidence before reassurance"), the assistant
 * rules ("never move a number ... from one server to another", "do not invent
 * numbers"), invariant 1 (AI text is not proof of state) and the task list.
 * Written before reading Coder's checker.
 *
 * "Reject" means: the owner gets deterministic text instead (source
 * "deterministic", with a reason) and the false claim never reaches them.
 * "Accept" means the AI answer is shown unchanged. A checker that rejects
 * everything would pass all reject cases, so the accept cases matter as much.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AssistantResponder, type ExplainableServer } from "../../../packages/ai/src/index.ts";
import { ScriptedProvider } from "./support/providers.mts";
import { CTX, FACTS, synth, type Spec } from "./support/synthetic.mts";

type Metric = "pending" | "held" | "disk" | "inode" | "mem" | "uptimeDays" | "load" | "cpu" | "reboot" | "failedCount" | "observed";
interface Claim { server: string; metric: Metric; value: number | boolean }
type Tag = "incident" | "invented" | "wrong-server" | "paraphrase" | "derived" | "no-numbers" | "scope" | "not-checked" | "list-marker";
interface Case { id: string; tag: Tag; expect: "accept" | "reject"; text: string; why: string; claims: Claim[]; specs?: Spec[]; scope?: string[] }

const ALL: Spec[] = Object.values(FACTS);
const c = (server: string, metric: Metric, value: number | boolean): Claim => ({ server, metric, value });

export const CASES: Case[] = [
  // ---- the incident and its relatives: wrong "nothing pending" claims ----
  { id: "R01", tag: "incident", expect: "reject", text: "Nabire has no pending updates.", why: "Nabire has 1; Merauke (its neighbour) has 0. The original misattribution.", claims: [c("Nabire", "pending", 0)] },
  { id: "R02", tag: "incident", expect: "reject", text: "Nabire is up to date. Nothing to see here.", why: "cheeky AND false: Nabire has 1 pending", claims: [c("Nabire", "pending", 0)] },
  { id: "R03", tag: "incident", expect: "reject", text: "Everything is up to date across the fleet.", why: "Nabire has 1 and Sentani has 6", claims: [c("Nabire", "pending", 0), c("Sentani", "pending", 0)] },
  { id: "R04", tag: "incident", expect: "reject", text: "No updates are pending on any server.", why: "Nabire has 1 and Sentani has 6", claims: [c("Nabire", "pending", 0), c("Sentani", "pending", 0)] },
  { id: "R05", tag: "incident", expect: "reject", text: "Nabire: 0 pending updates. Merauke: 0 pending updates.", why: "Nabire's 0 is wrong", claims: [c("Nabire", "pending", 0), c("Merauke", "pending", 0)] },
  { id: "R06", tag: "incident", expect: "reject", text: "Nothing is waiting to be installed on Nabire.", why: "same claim, different words", claims: [c("Nabire", "pending", 0)] },
  { id: "R07", tag: "incident", expect: "reject", text: "Nabire is fully patched.", why: "same claim, different words", claims: [c("Nabire", "pending", 0)] },
  // ---- invented numbers ----
  { id: "R10", tag: "invented", expect: "reject", text: "Sentani has 9 pending updates.", why: "Sentani has 6", claims: [c("Sentani", "pending", 9)] },
  { id: "R11", tag: "invented", expect: "reject", text: "Timika's disk is 91% full.", why: "Timika is at 42%", claims: [c("Timika", "disk", 91)] },
  { id: "R12", tag: "invented", expect: "reject", text: "Nabire has been up for 120 days.", why: "Nabire is at 2 days", claims: [c("Nabire", "uptimeDays", 120)] },
  { id: "R13", tag: "invented", expect: "reject", text: "Merauke has 3 failed services.", why: "none are failed", claims: [c("Merauke", "failedCount", 3)] },
  { id: "R14", tag: "invented", expect: "reject", text: "Sentani's load is 7.5.", why: "load is 1.4", claims: [c("Sentani", "load", 7.5)] },
  { id: "R15", tag: "invented", expect: "reject", text: "Nabire needs a reboot.", why: "reboot is not required", claims: [c("Nabire", "reboot", true)] },
  { id: "R16", tag: "invented", expect: "reject", text: "Nabire has two pending updates.", why: "number in words: Nabire has 1", claims: [c("Nabire", "pending", 2)] },
  { id: "R17", tag: "invented", expect: "reject", text: "Sentani has seven updates waiting.", why: "number in words: Sentani has 6", claims: [c("Sentani", "pending", 7)] },
  { id: "R18", tag: "invented", expect: "reject", text: "Timika's disk is at 91 percent.", why: "'percent' spelled out", claims: [c("Timika", "disk", 91)] },
  { id: "R19", tag: "invented", expect: "reject", text: "Sentani's inodes are 88% used.", why: "inodes are at 5%", claims: [c("Sentani", "inode", 88)] },
  // ---- right numbers, wrong server ----
  { id: "R20", tag: "wrong-server", expect: "reject", text: "Sentani has 1 pending update and Nabire has 6.", why: "swapped", claims: [c("Sentani", "pending", 1), c("Nabire", "pending", 6)] },
  { id: "R21", tag: "wrong-server", expect: "reject", text: "Sentani's disk is 42% used.", why: "42 is Timika's", claims: [c("Sentani", "disk", 42)] },
  { id: "R22", tag: "wrong-server", expect: "reject", text: "Merauke has 6 pending updates.", why: "6 is Sentani's", claims: [c("Merauke", "pending", 6)] },
  { id: "R23", tag: "wrong-server", expect: "reject", text: "Timika has one pending update.", why: "1 is Nabire's pending (and Merauke's held)", claims: [c("Timika", "pending", 1)] },
  { id: "R24", tag: "wrong-server", expect: "reject", text: "Sentani is using 40% of its memory.", why: "40 is Merauke's", claims: [c("Sentani", "mem", 40)] },
  { id: "R25", tag: "wrong-server", expect: "reject", text: "Timika has 4 CPUs.", why: "4 is Nabire's and Merauke's; Timika has 2", claims: [c("Timika", "cpu", 4)] },
  { id: "R26", tag: "wrong-server", expect: "reject", text: "Nabire has been up 41 days.", why: "41 is Timika's", claims: [c("Nabire", "uptimeDays", 41)] },
  { id: "R27", tag: "wrong-server", expect: "reject", text: "Merauke has one update held back, and Nabire has none pending.", why: "first half is true (Merauke held 1), second is the incident", claims: [c("Merauke", "held", 1), c("Nabire", "pending", 0)] },
  // ---- the model speaks about a server that was not even in scope ----
  { id: "R30", tag: "scope", expect: "reject", scope: ["Nabire"], text: "Nabire has one pending update and Sentani has six.", why: "Sentani's facts were not provided in this scope, so the claim cannot be backed", claims: [c("Nabire", "pending", 1), c("Sentani", "pending", 6)] },
  // ---- healthy/up-to-date claims about checks that did not run ----
  { id: "R40", tag: "not-checked", expect: "reject", text: "Sentani is healthy and up to date.", why: "Sentani has no observation at all (unreachable)", claims: [c("Sentani", "observed", true)],
    specs: [FACTS.Timika, FACTS.Nabire, { name: "Sentani", production: false, withObservation: false, status: "unreachable", reason: "route unavailable" }, FACTS.Merauke] },
  { id: "R41", tag: "not-checked", expect: "reject", text: "Timika has no failed services.", why: "nginx.service is failed on Timika in this scenario", claims: [c("Timika", "failedCount", 0)],
    specs: [{ ...FACTS.Timika, failedUnits: ["nginx.service"] }, FACTS.Nabire, FACTS.Sentani, FACTS.Merauke] },

  // ---- paraphrases and derived statements that MUST pass ----
  { id: "A01", tag: "paraphrase", expect: "accept", text: "Nabire has one update waiting.", why: "true, number in words", claims: [c("Nabire", "pending", 1)] },
  { id: "A02", tag: "paraphrase", expect: "accept", text: "One package on Nabire can be updated.", why: "true, different phrasing", claims: [c("Nabire", "pending", 1)] },
  { id: "A03", tag: "paraphrase", expect: "accept", text: "Nabire: 1 pending update.", why: "true, terse", claims: [c("Nabire", "pending", 1)] },
  { id: "A04", tag: "paraphrase", expect: "accept", text: "Nabire has a single pending update.", why: "true, 'a single'", claims: [c("Nabire", "pending", 1)] },
  { id: "A05", tag: "paraphrase", expect: "accept", text: "Sentani has six updates pending.", why: "true, number in words", claims: [c("Sentani", "pending", 6)] },
  { id: "A06", tag: "paraphrase", expect: "accept", text: "Sentani has 6 pending updates and Nabire has 1. Timika and Merauke have none.", why: "all four true, mixed forms", claims: [c("Sentani", "pending", 6), c("Nabire", "pending", 1), c("Timika", "pending", 0), c("Merauke", "pending", 0)] },
  { id: "A07", tag: "derived", expect: "accept", text: "Four servers were checked and two of them have pending updates.", why: "derived counts: 4 servers; Nabire and Sentani", claims: [c("Nabire", "pending", 1), c("Sentani", "pending", 6)] },
  { id: "A08", tag: "paraphrase", expect: "accept", text: "Sentani's memory use is high at 83%.", why: "true", claims: [c("Sentani", "mem", 83)] },
  { id: "A09", tag: "derived", expect: "accept", text: "Nabire has been up for about two days.", why: "uptime 2 days, in words", claims: [c("Nabire", "uptimeDays", 2)] },
  { id: "A10", tag: "paraphrase", expect: "accept", text: "Timika's disk is at 42% and its inodes at 8%.", why: "both true", claims: [c("Timika", "disk", 42), c("Timika", "inode", 8)] },
  { id: "A11", tag: "no-numbers", expect: "accept", text: "Timika is the production server, so check it carefully before any change.", why: "no factual number at all", claims: [] },
  { id: "A12", tag: "paraphrase", expect: "accept", text: "Merauke has no pending updates, though one package is held back.", why: "pending 0, held 1: both true", claims: [c("Merauke", "pending", 0), c("Merauke", "held", 1)] },
  { id: "A13", tag: "paraphrase", expect: "accept", text: "Load on Sentani is 1.4 across 2 CPUs.", why: "true", claims: [c("Sentani", "load", 1.4), c("Sentani", "cpu", 2)] },
  { id: "A14", tag: "no-numbers", expect: "accept", text: "Nothing needs a reboot right now.", why: "true for every server", claims: [c("Timika", "reboot", false), c("Nabire", "reboot", false), c("Sentani", "reboot", false), c("Merauke", "reboot", false)] },
  { id: "A15", tag: "list-marker", expect: "accept", text: "1. Sentani has 6 updates pending.\n2. Nabire has 1.", why: "list numbering is not a claim", claims: [c("Sentani", "pending", 6), c("Nabire", "pending", 1)] },
  { id: "A16", tag: "paraphrase", expect: "accept", text: "Nothing is pending on Timika.", why: "true", claims: [c("Timika", "pending", 0)] },
  { id: "A17", tag: "derived", expect: "accept", text: "Sentani has the most updates waiting, with 6.", why: "true superlative", claims: [c("Sentani", "pending", 6)] },
  { id: "A18", tag: "paraphrase", expect: "accept", text: "Nabire is up to date apart from one waiting update.", why: "true: 1 pending, stated", claims: [c("Nabire", "pending", 1)] },
  { id: "A19", tag: "derived", expect: "accept", text: "Both development servers in the studio, Nabire and Merauke, are lightly loaded.", why: "no numeric claim; 'two' is not stated", claims: [] },
];

// ---------------------------------------------------------------------------
// Meta: are MY labels right? Evaluate each case's claims against the facts.
// ---------------------------------------------------------------------------
function truth(cl: Claim, specs: Spec[]): boolean {
  const s = specs.find((x) => x.name === cl.server);
  if (!s) return false; // a server not in the facts: nothing can be true of it
  const v = {
    pending: s.pending ?? 0, held: s.held ?? 0, disk: s.disk ?? 40, inode: s.inode ?? -1, mem: s.memUsedPct ?? 30,
    uptimeDays: s.uptimeDays ?? 3, load: s.load1 ?? 0.2, cpu: s.cpu ?? 4, reboot: s.reboot ?? false,
    failedCount: (s.failedUnits ?? []).length, observed: s.withObservation ?? true,
  }[cl.metric];
  return v === cl.value;
}

test("meta: every accept case states only true things, and every reject case states at least one false thing", () => {
  const bad: string[] = [];
  for (const k of CASES) {
    const specs = k.specs ?? ALL;
    const scoped = k.scope ? specs.filter((s) => k.scope!.includes(s.name)) : specs;
    const results = k.claims.map((cl) => truth(cl, scoped));
    if (k.expect === "accept" && !results.every(Boolean)) bad.push(`${k.id} labelled accept but has a false claim`);
    if (k.expect === "reject" && results.length > 0 && results.every(Boolean)) bad.push(`${k.id} labelled reject but every claim is true`);
  }
  assert.deepEqual(bad, [], bad.join("\n"));
  assert.ok(CASES.filter((k) => k.expect === "accept").length >= 15, "enough accept cases to catch a checker that rejects everything");
  assert.ok(CASES.filter((k) => k.expect === "reject").length >= 25);
});

test("meta: case ids are unique", () => assert.equal(new Set(CASES.map((k) => k.id)).size, CASES.length));

// ---------------------------------------------------------------------------
// The cases, through the real pipeline
// ---------------------------------------------------------------------------
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const outcomes: { id: string; tag: string; expect: string; got: string; reason: string | null }[] = [];

async function run(k: Case) {
  const specs = k.specs ?? ALL;
  const fleet: ExplainableServer[] = specs.filter((s) => !k.scope || k.scope.includes(s.name)).map(synth);
  const provider = new ScriptedProvider(k.text);
  const reply = await new AssistantResponder(provider).respond("What is the status?", fleet, CTX);
  assert.equal(provider.requests.length, 1, "premise: the model was consulted");
  return reply;
}

for (const k of CASES) {
  test(`${k.id} [${k.tag}] ${k.expect.toUpperCase()}: "${k.text.replace(/\n/g, " / ").slice(0, 70)}"  (${k.why})`, async () => {
    const reply = await run(k);
    outcomes.push({ id: k.id, tag: k.tag, expect: k.expect, got: reply.source === "ai" ? "accepted" : "rejected", reason: reply.reason });
    if (k.expect === "accept") {
      assert.equal(reply.source, "ai", `a true, well-formed answer was thrown away (reason: ${reply.reason}). A checker that rejects true answers is useless.`);
      assert.ok(norm(reply.text).includes(norm(k.text).slice(0, 40)));
    } else {
      assert.equal(reply.source, "deterministic", `the owner would have been shown: "${reply.text.slice(0, 120)}"`);
      assert.notEqual(reply.reason, null, "a rejection needs a stated reason");
      assert.ok(!norm(reply.text).includes(norm(k.text)), "the false claim must not appear in what the owner sees");
    }
  });
}

test("a rejected answer is replaced by the deterministic overview, which states the true numbers", async () => {
  const reply = await run(CASES.find((k) => k.id === "R01")!);
  assert.equal(reply.source, "deterministic");
  assert.match(reply.text, /Nabire/);
  assert.ok(!/Nabire[^.\n]{0,40}\bno pending updates\b/i.test(reply.text), "the replacement must not repeat the false claim");
});

test("a rejection is not silent: the reply says an AI answer was withheld, or carries a machine-readable reason", async () => {
  const reply = await run(CASES.find((k) => k.id === "R01")!);
  assert.ok(reply.reason, "reason");
});

test("a rejected answer still passes through the existing guards in order (unsafe output is refused as unsafe, not as a fact error)", async () => {
  const reply = await new AssistantResponder(new ScriptedProvider("Run sudo apt-get upgrade on Nabire, which has no pending updates.")).respond("Status?", ALL.map(synth), CTX);
  assert.equal(reply.source, "deterministic");
  assert.equal(reply.reason, "unsafe_output", "the earlier, stricter guard must still win");
});

// ---------------------------------------------------------------------------
// Tone (ADR-015): cheeky only in routine good news
// ---------------------------------------------------------------------------
const CHEEKY_BAD: [string, string, Spec[]][] = [
  ["T01", "Timika's disk is at 96%. Yikes! Time to clean up.", [{ ...FACTS.Timika, disk: 96 }]],
  ["T02", "Sentani seems to be napping. Can't reach it right now.", [{ name: "Sentani", withObservation: false, status: "unreachable", reason: "route unavailable" }]],
  ["T03", "Timika has a failed service: nginx.service. Oopsie! Better take a look.", [{ ...FACTS.Timika, failedUnits: ["nginx.service"] }]],
  ["T04", "Nabire's disk is 97% full, whoops. Nothing a little spring cleaning can't fix!", [{ ...FACTS.Nabire, disk: 97 }]],
];
for (const [id, text, specs] of CHEEKY_BAD) {
  test(`${id} tone: a joke about a failure or an outage must not be shown ("${text.slice(0, 50)}...")`, async () => {
    const provider = new ScriptedProvider(text);
    const reply = await new AssistantResponder(provider).respond("What is the status?", specs.map(synth), CTX);
    assert.equal(reply.source, "deterministic", `ADR-015: never cheeky about failures. The owner would see: "${reply.text.slice(0, 100)}"`);
  });
}

test("T10 tone: light humour in a routine good-news answer is allowed and kept (the founder asked for it)", async () => {
  const text = "Nabire is up to date. Nothing to see here.";
  const specs: Spec[] = [{ ...FACTS.Nabire, pending: 0 }, FACTS.Merauke];
  const reply = await new AssistantResponder(new ScriptedProvider(text)).respond("How is Nabire?", specs.map(synth), CTX);
  assert.equal(reply.source, "ai", "a true, cheerful good-news answer must not be suppressed");
  assert.match(reply.text, /Nothing to see here/);
});

test("zz: outcome table (for the report)", () => {
  const rows = outcomes.map((o) => `${o.id.padEnd(4)} ${o.tag.padEnd(13)} expect=${o.expect.padEnd(6)} got=${o.got.padEnd(8)} reason=${o.reason ?? "-"}`);
  console.log("\n[fact-check outcomes]\n" + rows.join("\n"));
});
