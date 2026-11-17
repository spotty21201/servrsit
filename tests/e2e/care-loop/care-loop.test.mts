/**
 * Care-loop acceptance tests against the INTEGRATED system (T-048), through
 * binding.mts. Every scenario gets a fresh harness. A scenario the binding
 * cannot express is reported as skipped (NOT RUN), never as a pass.
 *
 *   cd apps/api && pnpm exec tsx --test --test-reporter=spec ../../tests/e2e/care-loop/care-loop.test.mts
 */
import test, { after } from "node:test";
import { loadBinding } from "./binding.mts";
import { scenarios } from "./scenarios.mts";

const binding = await loadBinding();
const fallbacks = new Set<string>();
const missing = new Set<string>();

for (const sc of scenarios) {
  const name = `${sc.id} ${sc.title} [${sc.traces.join(", ")}]`;
  if (!binding.bound) {
    test(name, { skip: `PENDING: ${binding.reason}` }, () => {});
    continue;
  }
  test(name, async (t) => {
    const h = await binding.create();
    try {
      await sc.run(h);
    } catch (e) {
      if ((e as Error).name === "UnsupportedByBinding") {
        t.skip(`NOT RUN: ${(e as Error).message}`);
        return;
      }
      throw e;
    } finally {
      h.fallbacks.forEach((f) => fallbacks.add(f));
      h.missingRoutes.forEach((r) => missing.add(r));
    }
  });
}

after(() => {
  console.log("\n[binding notes] routes that do not exist (real 404):", [...missing].join(" | ") || "none");
  console.log("[binding notes] fallbacks used:", [...fallbacks].join(" | ") || "none");
});
