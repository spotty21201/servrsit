/**
 * T-069 server registration acceptance scenarios. PENDING: the contract (packages/contracts/src/servers.ts) is
 * committed, the API is not. Every scenario is reported as skipped with the reason until a binding to the real
 * API exists (support/binding.mts, to be written when T-069 lands).
 *
 * Not yet self-validated: there is no spec-derived reference model for these scenarios yet (the care-loop and
 * login suites have one). Until there is, a pass would prove less than it does there.
 */
import test from "node:test";
import { part1 } from "./scenarios.mts";
import { part2 } from "./scenarios2.mts";

const all = [...part1, ...part2];
const ids = new Set<string>();
for (const s of all) {
  if (ids.has(s.id)) throw new Error(`duplicate scenario id ${s.id}`);
  ids.add(s.id);
  test(`${s.id} ${s.title} [${s.spec.join("; ")}]`, { skip: `PENDING T-069: the registration API is not implemented (contract only, 37805b6)${s.needs?.length ? `; also needs: ${s.needs.join(", ")}` : ""}` }, async () => {});
}
test("inventory: every endpoint in the contract is exercised by at least one scenario", async () => {
  const fs = await import("node:fs");
  const src = ["./scenarios.mts", "./scenarios2.mts"].map((f) => fs.readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  // endpoint -> a source fragment that only a call to it can contain
  const uses: Record<string, RegExp> = {
    "POST /api/servers/drafts": /\bdraft\(h/, "GET /api/servers/drafts/:id": /getDraft\(h/, "DELETE /api/servers/drafts/:id": /method: "DELETE", path: `\$\{P\}\//,
    "POST .../host-key": /"host-key"\)/, "POST .../host-key/confirm": /"host-key\/confirm"/, "POST .../access-key": /"access-key"\)/,
    "POST .../first-check": /"first-check"\)/, "GET .../first-check": /method: "GET", path: `\$\{P\}\/\$\{id\}\/first-check`/,
    "POST .../activate": /"activate"\)/, "PATCH /api/servers/:id": /method: "PATCH", path: (url|`\/api\/servers\/)/, "POST /api/servers/:id/disconnect": /\/disconnect`/,
  };
  const missing = Object.entries(uses).filter(([, re]) => !re.test(src)).map(([k]) => k);
  if (missing.length) throw new Error(`endpoints with no scenario: ${missing.join(", ")}`);
});
