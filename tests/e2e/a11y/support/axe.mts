import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const axeSource: string = (createRequire(join(here, "../package.json"))("axe-core") as { source: string }).source;

export interface Violation { id: string; impact: string | null | undefined; help: string; nodes: string[] }
export interface AxeOutcome { violations: Violation[]; incomplete: Violation[]; passes: number }

/** Run axe inside the jsdom window. Colour contrast is off: jsdom cannot compute it (checked separately from the CSS). */
export async function runAxe(): Promise<AxeOutcome> {
  const w = window as unknown as { eval(s: string): unknown; axe: { run(ctx: unknown, o: unknown): Promise<any> } };
  if (!w.axe) w.eval(axeSource);
  const res = await w.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    rules: { "color-contrast": { enabled: false }, "color-contrast-enhanced": { enabled: false } },
    resultTypes: ["violations", "incomplete", "passes"],
  });
  const map = (l: any[]): Violation[] => l.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n: any) => String(n.target.join(" "))).slice(0, 4) }));
  // Arrays from jsdom's realm have a foreign prototype: copy into this realm so assertions compare cleanly.
  return JSON.parse(JSON.stringify({ violations: map(res.violations), incomplete: map(res.incomplete), passes: res.passes.length })) as AxeOutcome;
}
