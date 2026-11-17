// Tester helper: run the real local collector once and print only a summary.
import { collectLocal } from "../../packages/ssh/src/index.ts";
const r = await collectLocal();
console.log(JSON.stringify({ ok: r.ok, ...(r.ok ? { source: r.observation.source, pending: (r.observation.packages.pendingCount as any).value, held: (r.observation.packages.heldBackCount as any).value } : { failure: r.failure }) }));
