/**
 * T-061: what the owner and the model are told about a host whose clock is off.
 * Uses [FIXTURE DATA] servers from ai.fixtures.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ok, unavailable, type InspectionObservation } from "@servrsit/ssh";
import { CTX, observation, server } from "./ai.fixtures.js";
import { deterministicExplanation } from "./deterministic.js";
import { checkFacts } from "./fact-check.js";
import { buildAssistantPrompt } from "./assistant.js";
import { buildAiInput } from "./input.js";

function withClock(clock: InspectionObservation["host"]["clock"], metadataClock: InspectionObservation["packages"]["metadataClock"]): InspectionObservation {
  const o = observation();
  return { ...o, host: { ...o.host, clock }, packages: { ...o.packages, metadataClock } };
}

const SENTANI = withClock(ok({ targetEpochSeconds: 1794902400 - 25200, skewSeconds: -25200, uncertaintySeconds: 2 }), "corrected");

test("T-061: the model input carries the measured skew and how the package time was handled", () => {
  const m = buildAiInput(server({ name: "Sentani" }, SENTANI), CTX).metrics!;
  assert.deepEqual(m.clock, { skewSeconds: -25200, uncertaintySeconds: 2, beyondTolerance: true });
  assert.equal(m.packageListsClock, "corrected");
  const unknown = buildAiInput(server({}, withClock(unavailable("target time not in expected format"), "unverified")), CTX).metrics!;
  assert.equal(unknown.clock, null);
  assert.equal(unknown.packageListsClock, "unverified");
});

test("T-061: the deterministic summary says the package time was corrected, or may be wrong", () => {
  const corrected = deterministicExplanation(server({ name: "Sentani" }, SENTANI), CTX);
  assert.match(corrected, /The host's clock is about 7 h behind ServrSit's clock; this time is corrected for that\./);
  const unverified = deterministicExplanation(server({}, withClock(unavailable("x"), "unverified")), CTX);
  assert.match(unverified, /The host's clock could not be checked, so this time may be wrong\./);
  const inSync = deterministicExplanation(server(), CTX);
  assert.doesNotMatch(inSync, /clock/);
});

test("T-061: an AI answer that states the skew in hours passes the fact check", () => {
  const inputs = [buildAiInput(server({ name: "Sentani" }, SENTANI), CTX)];
  const prompt = buildAssistantPrompt(inputs, "why is the package age odd?", CTX);
  assert.deepEqual(checkFacts("Sentani's clock is about 7 hours behind, so its package-list time has been corrected.", inputs, prompt), { ok: true });
});

// ---- T-062 (kept with T-061's host-fact tests) -----------------------------------------

test("T-062: the model and the owner see which pending updates come from outside Ubuntu's archive", () => {
  const o = observation();
  const docker: InspectionObservation = {
    ...o,
    packages: {
      ...o.packages,
      pendingCount: ok(3),
      pendingOutsideUbuntu: ok({ count: 3, packages: ["docker-ce-cli", "docker-ce", "docker-ce-rootless-extras"].map((name) => ({ name, origin: "Docker CE:noble" })) }),
    },
  };
  const s = server({ name: "Sentani" }, docker);
  const m = buildAiInput(s, CTX).metrics!;
  assert.deepEqual(m.pendingOutsideUbuntu, { count: 3, names: ["docker-ce-cli", "docker-ce", "docker-ce-rootless-extras"], origins: ["Docker CE:noble"] });
  assert.match(deterministicExplanation(s, CTX), /3 of the pending updates \(docker-ce-cli, docker-ce, docker-ce-rootless-extras\) come from outside Ubuntu's archive from Docker CE:noble; update plans leave them out\./);
  const inputs = [buildAiInput(s, CTX)];
  const prompt = buildAssistantPrompt(inputs, "updates?", CTX);
  assert.deepEqual(checkFacts("Sentani has 3 pending updates, all 3 from Docker's repository, and 0 from Ubuntu.", inputs, prompt), { ok: true });
  assert.equal(checkFacts("Sentani has 3 pending updates, 2 from Docker's repository.", inputs, prompt).ok, false);
});

// ---- T-063: ServrSit's own clock is wrong --------------------------------------------

test("T-063: with ServrSit's clock untrusted, answers say every time may be wrong, once, and the host is not blamed", async () => {
  const { deterministicOverview, buildAssistantPrompt: prompt } = await import("./assistant.js");
  const ctx = { ...CTX, controllerClock: { status: "untrusted" as const, offsetSeconds: 25200 } };
  const servers = [server({ name: "Sentani" }, SENTANI), server({ name: "Nabire" })];
  const text = deterministicOverview(servers, ctx);
  assert.ok(text.startsWith("ServrSit's own clock is about 7 h fast, so every time and age here may be wrong.\n\n"));
  assert.equal(text.split("ServrSit's own clock").length - 1, 1, "the warning appears once");
  assert.doesNotMatch(text, /The host's clock is/);
  const user = prompt(servers.map((s) => buildAiInput(s, ctx)), "status?", ctx);
  assert.ok(user.includes('"timesUncertain":"ServrSit\'s own clock is about 7 h fast, so every time and age here may be wrong."'));
  assert.equal(prompt(servers.map((s) => buildAiInput(s, CTX)), "status?", CTX).includes("timesUncertain"), false, "no note when not checked");
});
