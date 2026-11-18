/**
 * T-069 server registration: static checks (unique ids, every contract endpoint exercised). The scenarios run
 * against the implementation in registration-live.test.mts through support/binding.mts.
 *
 * Not yet self-validated: there is no spec-derived reference model for these scenarios yet (the care-loop and
 * login suites have one). Until there is, a pass would prove less than it does there.
 */
import test from "node:test";
import { part1 } from "./scenarios.mts";
import { part2 } from "./scenarios2.mts";

const all = [...part1, ...part2];
const ids = new Set<string>();
for (const s of all) { if (ids.has(s.id)) throw new Error(`duplicate scenario id ${s.id}`); ids.add(s.id); }
// The scenarios themselves run in registration-live.test.mts (bound to T-069). This file keeps the static checks.
test(`scenario ids are unique (${all.length} scenarios)`, () => {});
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
