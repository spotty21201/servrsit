/**
 * The 27 owner-login scenarios against T-053.
 * Isolated wiring: all 27. Full buildServer wiring: the subset that fits the built-in
 * global limit (10 auth POSTs per minute) so that the limit cannot explain a pass.
 */
import test from "node:test";
import { scenarios } from "./scenarios.mts";
import { AuthBinding } from "./binding.mts";

const FULL = new Set(["AU-01a", "AU-01c", "AU-02a", "AU-05a", "AU-05b", "AU-05c", "AU-06a", "AU-06b", "AU-06c", "AU-06d"]);

for (const sc of scenarios) {
  test(`[isolated] ${sc.id} ${sc.title}`, async () => {
    const h = await AuthBinding.create({ wiring: "isolated" });
    try { await sc.run(h); } finally { await h.close(); }
  });
  if (FULL.has(sc.id)) {
    test(`[full] ${sc.id} ${sc.title}`, async () => {
      const h = await AuthBinding.create({ wiring: "full" });
      try { await sc.run(h); } finally { await h.close(); }
    });
  }
}
