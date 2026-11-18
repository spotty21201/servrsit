/**
 * The 35 registration scenarios against T-069, bound through support/binding.mts.
 * A process guard is installed FIRST: only /usr/bin/ssh-keygen may be started, and every socket and DNS call
 * throws. A run that passes therefore also proves no real network was used. Scenarios needing a capability the
 * binding cannot provide are reported NOT RUN (skipped with the reason), never passed.
 */
import childProcess from "node:child_process";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import test, { after } from "node:test";
import assert from "node:assert/strict";

export const attempts: string[] = [];
for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"] as const) {
  const orig = (childProcess as any)[name];
  (childProcess as any)[name] = function (file: string, ...rest: unknown[]) {
    if ((name === "spawn" || name === "execFile") && file === "/usr/bin/ssh-keygen") return orig.call(this, file, ...rest);
    attempts.push(`child_process.${name}(${String(file)})`); throw new Error(`GUARD: ${name}(${file}) blocked`);
  };
}
for (const [mod, label, names] of [[net, "net", ["connect", "createConnection"]], [tls, "tls", ["connect"]], [dns, "dns", ["lookup", "resolve", "resolve4", "resolve6"]], [dns.promises, "dns.promises", ["lookup", "resolve", "resolve4", "resolve6"]]] as const) {
  for (const n of names) (mod as any)[n] = (...a: unknown[]) => { attempts.push(`${label}.${n}(${String(a[0])})`); throw new Error(`GUARD: ${label}.${n} blocked`); };
}
syncBuiltinESMExports();

const { part1 } = await import("./scenarios.mts");
const { part2 } = await import("./scenarios2.mts");
const { RegBinding } = await import("./support/binding.mts");

for (const s of [...part1, ...part2]) {
  const probe = await RegBinding.create(); const missing = (s.needs ?? []).filter((c) => !probe.has(c)); await probe.close();
  const TODO: Record<string, string> = { "SR-23b": "reported: D-R3" }; // SR-41b (D-R2) and SR-53b (D-R1) are guards since T-081/T-082
  test(`${s.id} ${s.title}`, missing.length ? { skip: `NOT RUN: binding cannot provide ${missing.join(", ")}` } : TODO[s.id] ? { todo: TODO[s.id] } : {}, async () => {
    const h = await RegBinding.create();
    try { await s.run(h); } finally { await h.close(); }
  });
}
test("GUARD: no real process, socket or DNS lookup was attempted during the whole run", () => { assert.deepEqual(attempts, []); });
after(() => { if (attempts.length) console.log(`# GUARD attempts: ${attempts.join(" | ")}`); });
