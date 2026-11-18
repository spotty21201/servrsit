/**
 * T-051: the assistant's reply is checked against the facts, server by server.
 * Uses [FIXTURE DATA] servers from ai.fixtures.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ok, unavailable, type InspectionObservation } from "@servrsit/ssh";
import { AssistantResponder, buildAssistantPrompt } from "./assistant.js";
import { CTX, observation, server } from "./ai.fixtures.js";
import type { ModelProvider } from "./explainer.js";
import { checkFacts } from "./fact-check.js";
import { buildAiInput, type ExplainableServer } from "./input.js";

function obs(opts: {
  pending: number;
  reboot?: boolean;
  failed?: string[];
  inodePercent?: number;
}): InspectionObservation {
  const base = observation({ failedUnits: (opts.failed ?? []).map((unit) => ({ unit, nameValid: true })) });
  return {
    ...base,
    host: {
      ...base.host,
      inodes:
        opts.inodePercent === undefined
          ? unavailable("no parsable inode rows")
          : ok({
              entries: [{ filesystem: "/dev/sda1", mount: "/", inodes: 1000, inodesUsed: opts.inodePercent * 10, inodesFree: 1000 - opts.inodePercent * 10, usedPercent: opts.inodePercent }],
              skippedLineCount: 0,
            }),
    },
    packages: { ...base.packages, pendingCount: ok(opts.pending), rebootRequired: ok(opts.reboot ?? false) },
  };
}

/** The DEF-L2 investigation: Nabire had 1 pending update, Merauke had 0, and the AI swapped them. */
const nabire = (o: Partial<Parameters<typeof obs>[0]> = {}): ExplainableServer =>
  server({ name: "Nabire", production: false, role: "Development server" }, obs({ pending: 1, ...o }));
const merauke = (o: Partial<Parameters<typeof obs>[0]> = {}): ExplainableServer =>
  server({ name: "Merauke", production: false, role: "Development server (dev host)", findings: [] }, obs({ pending: 0, ...o }));
const timikaUnreachable = (): ExplainableServer =>
  server(
    {
      name: "Timika",
      production: true,
      status: "unreachable",
      observedAt: null,
      freshUntil: null,
      coverage: null,
      latestAttempt: { at: "2026-11-17T08:00:01.000Z", succeeded: false, failure: { code: "ROUTE_UNAVAILABLE", message: "x" }, consecutiveFailures: 3 },
      findings: [],
    },
    null,
  );

function check(reply: string, servers: readonly ExplainableServer[]) {
  const inputs = servers.map((s) => buildAiInput(s, CTX));
  return checkFacts(reply, inputs, buildAssistantPrompt(inputs, "status?", CTX));
}
const pair = () => [nabire(), merauke()];

function assertPass(reply: string, servers: readonly ExplainableServer[] = pair()): void {
  assert.deepEqual(check(reply, servers), { ok: true }, reply);
}
function assertFail(reply: string, mismatch: string, servers: readonly ExplainableServer[] = pair()): void {
  assert.deepEqual(check(reply, servers), { ok: false, mismatch }, reply);
}

test("replay: the Nabire/Merauke misattribution is caught", () => {
  assertFail("Nabire has no pending updates and Merauke has 1 pending update.", "pending_updates");
  assertFail("Merauke has 1 pending update. Nabire is up to date.", "pending_updates");
  assertFail("Neither Nabire nor Merauke has pending updates.", "pending_updates");
  assertFail("There are no pending updates.", "pending_updates");
  assertFail("All your servers are up to date.", "status_word");
});

test("correct answers pass", () => {
  assertPass("Nabire has 1 pending update and Merauke is up to date. Both were checked at 15:00 GMT+7, 20 min ago, and neither needs a reboot.");
  assertPass("Merauke has 0 pending updates. Nabire has 1 pending update.");
  assertPass("Nabire: 14 of 15 checks passed; the inode check was unavailable.");
  assertPass("Nabire runs Ubuntu 24.04.5 LTS with 4 CPUs.");
  assertPass("2 servers are fresh.");
});

test("paraphrases pass", () => {
  assertPass("One update is waiting on Nabire; Merauke has nothing pending.");
  assertPass("On Nabire, a single package update is available.");
  assertPass("Nabire has an update waiting.");
  assertPass("Nabire's root disk is 40% full, and /srv is at 88%.");
  assertPass("Memory use on Nabire is 75 percent.");
  assertPass("Nabire doesn't need a reboot.");
  assertPass("No reboot is required on Merauke.");
  assertPass("Merauke doesn't have any updates.");
});

test("invented numbers fail", () => {
  assertFail("Nabire has 3 pending updates.", "pending_updates");
  assertFail("Nabire's disk is 55% full.", "disk_percent");
  assertFail("Nabire has 7 failed services.", "failed_services");
  assertFail("Nabire has been up for 42 days.", "unattributed_number");
  assertFail("Memory on Merauke is at 90%.", "memory_percent");
  assertFail("Nabire runs Ubuntu 22.04.", "unattributed_number");
  assertFail("5 servers are fresh.", "server_count");
});

test("a number with no server to attribute it to fails in a fleet answer", () => {
  assertFail("There is 1 pending update.", "pending_updates");
  assertFail("The checks found 14 things.", "unattributed_number");
  // With one server in scope the same sentence is about that server.
  assertPass("There is 1 pending update.", [nabire()]);
});

test("a number for the wrong server fails", () => {
  assertFail("Merauke has 1 pending update.", "pending_updates");
  const rebootOnMerauke = [nabire(), merauke({ reboot: true })];
  assertFail("Nabire needs a reboot.", "reboot_required", rebootOnMerauke);
  assertPass("Merauke needs a reboot.", rebootOnMerauke);
  assertPass("Nabire doesn't need a reboot, but Merauke does.", rebootOnMerauke);
  assertFail("Merauke does not need a reboot.", "reboot_required", rebootOnMerauke);
});

test("failed services: count and names are checked per server", () => {
  const servers = [nabire({ failed: ["nginx.service"] }), merauke()];
  assertPass("Nabire has 1 failed service: nginx.service.", servers);
  assertPass("nginx.service has failed on Nabire. Merauke has no failed services.", servers);
  assertFail("nginx.service has failed on Merauke.", "failed_services", servers);
  assertFail("Nabire has no failed services.", "failed_services", servers);
  assertFail("Nabire: postgresql.service failed.", "failed_services", servers);
});

test("inode percentages are checked; unavailable inode data cannot be quoted", () => {
  const servers = [nabire({ inodePercent: 7 }), merauke()];
  assertPass("Inode use on Nabire is 7%.", servers);
  assertFail("Inode use on Nabire is 9%.", "inode_percent", servers);
  assertFail("Merauke uses 2% of its inodes.", "inode_percent", servers);
});

test("status words must match the server they are about", () => {
  const servers = [nabire(), merauke(), timikaUnreachable()];
  assertPass("Timika is unreachable; Nabire and Merauke are fresh.", servers);
  assertFail("Timika is healthy.", "status_word", servers);
  assertFail("Timika is fresh.", "status_word", servers);
  assertFail("Everything looks healthy.", "status_word", servers);
  assertFail("Nabire is unreachable.", "status_word", servers);
  assertPass("Timika is not healthy right now: the last 3 attempts failed.", servers);
});

test("a realistic fleet answer with times, ages and package-list age passes", () => {
  const servers = [nabire({ failed: ["nginx.service"] }), merauke(), timikaUnreachable()];
  assertPass(
    "Nabire was checked at 15:00 GMT+7 (20 min ago). It has 1 pending update, its package lists were last refreshed on 16 Nov 2026 at 09:00 GMT+7, and nginx.service has failed. " +
      "Merauke is up to date with no failed services; its /srv disk is 88% full, which is worth watching. " +
      "Timika is unreachable: the last 3 attempts could not reach it, so I can't say anything about its updates.",
    servers,
  );
});

test("tone does not loosen the check: a cheeky line must still be right", () => {
  assertPass("Merauke is up to date and snoozing happily, nothing for you to babysit there.");
  assertFail("Nabire is up to date and snoozing happily, nothing for you to babysit there.", "status_word");
  assertFail("Merauke is living its best life with 0 updates and 3 failed services to keep it busy.", "failed_services");
});

// ---------------------------------------------------------------------------
// Responder
// ---------------------------------------------------------------------------

function fixedProvider(text: string): ModelProvider {
  return {
    id: "openai_compatible",
    requestedModel: "test-model",
    call: async () => ({ ok: false, reason: "not_supported", httpStatus: null }),
    complete: async () => ({ ok: true, text, returnedModel: "test-model", httpStatus: 200 }),
  };
}

test("responder: a mismatching AI answer is withheld; the deterministic answer comes back with the mismatch type", async () => {
  const wrong = "Nabire has no pending updates and Merauke has 1 pending update.";
  const r = await new AssistantResponder(fixedProvider(wrong)).respond("Any updates?", pair(), CTX);
  assert.equal(r.source, "deterministic");
  assert.equal(r.reason, "fact_mismatch");
  assert.equal(r.factMismatch, "pending_updates");
  assert.equal(r.model, null);
  assert.ok(!r.text.includes(wrong));
});

test("responder: a matching AI answer is returned as AI with no mismatch", async () => {
  const right = "Nabire has 1 pending update and Merauke is up to date.";
  const r = await new AssistantResponder(fixedProvider(right)).respond("Any updates?", pair(), CTX);
  assert.equal(r.source, "ai");
  assert.equal(r.text, right);
  assert.equal(r.reason, null);
  assert.equal(r.factMismatch, null);
});

// ---- T-064 F2/F3/F4/O1 (Tester's test-report-ai-auth-001) ----------------------------

const merauke1Held = () =>
  server({ name: "Merauke", production: false, findings: [] }, { ...obs({ pending: 0 }), packages: { ...obs({ pending: 0 }).packages, heldBackCount: ok(1) } });

test("T-064 F2: correct answers the old checker discarded are now kept", () => {
  assertPass("Nabire and Merauke are both quiet. Merauke's disk is 40% full.");
  assertPass("1. Nabire has 1 update pending.\n2. Merauke has 0.");
  assertPass("Nabire is up to date apart from one waiting update.");
  assertPass("Two of the servers were checked. One of them has pending updates.");
  assertPass("All 2 were checked.");
  assertPass("Merauke has no pending updates, though one package is held back.", [nabire(), merauke1Held()]);
});

test("T-064 F3: other ways to say 'nothing pending' are checked", () => {
  for (const text of ["Nabire is fully patched.", "Nothing is waiting to be installed on Nabire.", "Nabire is current.", "Updates: none for Nabire.", "You don't need to update Nabire.", "Nabire has none pending."]) {
    assertFail(text, "pending_updates");
  }
  assertPass("Merauke is fully patched.");
});

test("T-064 F3: 'fine', 'up and running' and negated status words are checked; metrics being fine is not a health claim", () => {
  const servers = [nabire(), merauke(), timikaUnreachable()];
  assertFail("Timika is fine.", "status_word", servers);
  assertFail("Timika is up and running.", "status_word", servers);
  assertFail("Nabire is not fresh.", "status_word", servers);
  assertPass("Timika is not healthy.", servers);
  assertPass("Nabire's load and memory are fine.", servers);
});

test("T-064 F3: a decimal on the wrong server, 'has none' with no noun, and a server outside the data are rejected", () => {
  assertFail("Merauke's load is 0.46 and Nabire's is 0.46.", "unattributed_number", [nabire(), server({ name: "Merauke" }, { ...obs({ pending: 0 }), host: { ...obs({ pending: 0 }).host, load: ok({ one: 0.9, five: 0.1, fifteen: 0.1 }) } })]);
  assertFail("Nabire has none.", "unattributed_number");
  assertFail("Nabire has 1 pending update and Sentani has six.", "out_of_scope");
  assertFail("Timika has no failed services.", "out_of_scope");
});

test("T-064 F4: a joke in a reply that carries bad news is withheld; a cheeky good-news line is not", async () => {
  const { jokesAboutBadNews } = await import("./fact-check.js");
  for (const t of ["Timika's disk is at 96%. Yikes!", "Sentani seems to be napping. Can't reach it right now.", "nginx.service failed. Oopsie.", "Disk is 97% full, whoops."]) {
    assert.equal(jokesAboutBadNews(t), true, t);
  }
  assert.equal(jokesAboutBadNews("Merauke is up to date and snoozing happily."), false);
  assert.equal(jokesAboutBadNews("Timika's nginx.service has failed. Check its logs."), false);
  const r = await new AssistantResponder(fixedProvider("Timika is unreachable. Yikes, it seems to be napping.")).respond("How is Timika?", [timikaUnreachable()], CTX);
  assert.deepEqual([r.source, r.reason], ["deterministic", "unsuitable_tone"]);
});

test("T-064 O1: the per-server explainer runs the same fact and tone checks", async () => {
  const { GuardedExplainer } = await import("./explainer.js");
  const wrong = new GuardedExplainer({ ...fixedProvider("x"), call: async () => ({ ok: true, text: "Nabire has 5 pending updates.", returnedModel: "m", httpStatus: 200 }) });
  assert.deepEqual([(await wrong.explain("n1", nabire())).source, (await wrong.explain("n2", nabire())).reason], ["deterministic", "fact_mismatch"]);
  const joke = new GuardedExplainer({ ...fixedProvider("x"), call: async () => ({ ok: true, text: "Timika is unreachable. Whoops!", returnedModel: "m", httpStatus: 200 }) });
  assert.equal((await joke.explain("t1", timikaUnreachable())).reason, "unsuitable_tone");
  const right = new GuardedExplainer({ ...fixedProvider("x"), call: async () => ({ ok: true, text: "Nabire has 1 pending update.", returnedModel: "m", httpStatus: 200 }) });
  assert.equal((await right.explain("n3", nabire())).source, "openai_compatible");
});
