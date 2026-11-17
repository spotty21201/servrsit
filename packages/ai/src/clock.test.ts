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
