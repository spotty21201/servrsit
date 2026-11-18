/**
 * Local copy of the controlPlane.clock shape from packages/contracts
 * (ControllerClockSchema, Coder's T-063). Copied here, not imported, because
 * this branch does not carry that contract yet and Designer must not edit
 * packages/contracts. Replace with `import type { ControllerClock } from
 * "@servrsit/contracts"` once Coder's work is merged in.
 */
export interface ControllerClockView {
  readonly status: "trusted" | "untrusted" | "not-checked";
  readonly checkedAt: string | null;
  readonly ntpSynchronized: boolean | null;
  /** ServrSit's clock minus real time, seconds. Positive: ServrSit is fast. Null when unknown. */
  readonly offsetSeconds: number | null;
  readonly uncertaintySeconds: number | null;
  readonly basis: "https-date" | "target-agreement" | "none";
  readonly sources: ReadonlyArray<{ readonly name: string; readonly ok: boolean; readonly offsetSeconds: number | null }>;
  /** The API's own fixed text explaining the status. */
  readonly reason: string;
}
