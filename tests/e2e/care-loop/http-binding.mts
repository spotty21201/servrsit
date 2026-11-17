/**
 * Binding from the abstract Harness (support/contract.mts) to the real care-loop
 * API. This is the ONLY file that knows request/response shapes.
 *
 * STATUS: UNBOUND. T-048 (Coder's care loop) has not landed, and the spec does
 * not fix JSON shapes. Mapping is filled in after T-048 lands, from the API's
 * own OpenAPI document, and it must not change any assertion in scenarios.mts.
 *
 * SAFETY GUARDS (these hold even after binding, and cannot be switched off):
 *  1. Refuses to run unless CARELOOP_SIMULATED=1 is set, which the operator sets
 *     only after starting the API with SIMULATED targets (no ssh binary involved).
 *  2. Refuses any base URL that is not loopback.
 *  3. Never takes an address, key or host from the environment. Servers are
 *     created through the API as simulated targets only.
 * These tests drive mutation paths. They must never reach Sentani, Nabire,
 * Timika or any real workload machine (execution-security invariants 11-12).
 */
import type { Harness } from "./support/contract.mts";

export type Binding =
  | { bound: false; reason: string }
  | { bound: true; create(): Promise<Harness> };

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/;

/** Flip to true only when HttpHarness below is a complete mapping to the landed T-048 API. */
const MAPPED = false;

export async function loadBinding(): Promise<Binding> {
  if (!MAPPED) {
    return { bound: false, reason: "T-048 has not landed and the HTTP mapping is not written (see README: 'Needs from Coder')" };
  }
  const base = process.env["CARELOOP_BASE_URL"];
  if (!base) return { bound: false, reason: "CARELOOP_BASE_URL is not set" };
  if (!LOOPBACK.test(base)) {
    throw new Error(`refusing to run mutation tests against a non-loopback URL: ${base}`);
  }
  if (process.env["CARELOOP_SIMULATED"] !== "1") {
    throw new Error("refusing to run: set CARELOOP_SIMULATED=1 only after starting the API with simulated targets (no ssh)");
  }
  return { bound: true, create: async () => { throw new Error("HttpHarness not implemented"); } };
}
