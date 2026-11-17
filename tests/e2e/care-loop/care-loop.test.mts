/**
 * Care-loop acceptance tests against the REAL system.
 *
 * Every scenario is registered as PENDING (skipped, with the reason shown) until
 * http-binding.mts is mapped to Coder's T-048. Once bound they run for real.
 * A skipped test is not a pass: the report counts them as NOT RUN.
 *
 *   pnpm exec tsx --test tests/e2e/care-loop/care-loop.test.mts
 */
import test from "node:test";
import { loadBinding } from "./http-binding.mts";
import { scenarios } from "./scenarios.mts";

const binding = await loadBinding();

for (const sc of scenarios) {
  const name = `${sc.id} ${sc.title} [${sc.traces.join(", ")}]`;
  if (!binding.bound) {
    test(name, { skip: `PENDING T-048: ${binding.reason}` }, () => {});
  } else {
    test(name, async () => {
      await sc.run(await binding.create());
    });
  }
}
