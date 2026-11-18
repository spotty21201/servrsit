/**
 * axe-core on every state (jsdom). Colour contrast is NOT checked here: jsdom cannot compute it (see css.test.mts).
 * Known violations are listed by state and rule, and are asserted separately as `todo`, so a NEW violation fails
 * this file and a fixed one is noticed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { runAxe } from "./support/axe.mts";
import { collectFacts } from "./support/facts.mts";
import { states } from "./support/states.mts";

const KNOWN: Record<string, string[]> = { "op-running-transcript-open": ["aria-allowed-role", "listitem"] }; // D-U7: <ul role="log">
/** Items axe cannot decide ("incomplete") and how each was settled by a person or by another test here. */
const REVIEWED_INCOMPLETE: Record<string, string> = {
  "landmark-one-main": "settled: ST-01 counts exactly one <main> in every state",
  "page-has-heading-one": "settled: ST-01 counts exactly one <h1> in every state",
  "label-content-name-mismatch": "settled: ST-02 checks the name contains the visible text (e.g. 'ServrSit, back to Overview')",
  "aria-prohibited-attr": "defect D-U8: aria-label on the brand <p> (ST-20)",
  "aria-allowed-role": "defect D-U7: role=log on <ul> (ST-19)",
};

const results: Record<string, unknown> = {};
const seenIncomplete = new Set<string>();
for (const s of states) {
  test(`axe: ${s.id} (${s.label})`, async () => {
    const { m, api } = await s.open();
    try {
      const axe = await runAxe(); const facts = collectFacts();
      results[s.id] = { axe, facts: { ...facts, bodyText: undefined } };
      for (const i of axe.incomplete) seenIncomplete.add(i.id);
      const unexpected = axe.violations.filter((v) => !(KNOWN[s.id] ?? []).includes(v.id)).map((x) => `${x.id} [${x.impact}] ${x.nodes.join(" | ")}`);
      assert.deepEqual(unexpected, [], `new axe violations in ${s.id}`);
      assert.ok(axe.passes > 15, `axe ran only ${axe.passes} passing rules in ${s.id}: the page may not have rendered`);
    } finally { await m.unmount(); api.restore(); }
  });
}

test("axe: every 'incomplete' rule has been reviewed (a new one fails until someone looks at it)", () => {
  const unreviewed = [...seenIncomplete].filter((id) => !(id in REVIEWED_INCOMPLETE));
  console.log(`# axe incomplete, reviewed: ${[...seenIncomplete].map((id) => `${id} (${REVIEWED_INCOMPLETE[id] ?? "UNREVIEWED"})`).join("; ")}`);
  assert.deepEqual(unreviewed, []);
});

test("axe: the known violation is gone (D-U7)", { todo: "reported: D-U7" }, () => {
  const remaining = Object.entries(KNOWN).flatMap(([sid, ids]) => ids.filter((id) => (results[sid] as any)?.axe?.violations?.some((v: any) => v.id === id)).map((id) => `${sid}: ${id}`));
  assert.deepEqual(remaining, []);
});

test.after(() => { mkdirSync("/tmp/a11y", { recursive: true }); writeFileSync("/tmp/a11y/axe-results.json", JSON.stringify(results, null, 1)); });
