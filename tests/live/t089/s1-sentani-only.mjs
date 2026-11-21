// T-089 s1: restart my instance on a registry copy where only Sentani is connected with the scheduler running (as in production),
// so Sentani gets its health check (machine id => identity verified) and no other server is checked (disconnected rows are skipped).
import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { stopApi, startApi, login, session, http, IDS, T, sleep } from "./lib.mjs";

await stopApi();
execFileSync("python3", ["-c", `
import sqlite3
c=sqlite3.connect("${T}/servers.db"); keep="${IDS.sentani}"
n=c.execute("update servers set disconnected_at='2026-11-21T11:45:00.000Z' where id != ? and disconnected_at is null", (keep,)).rowcount; c.commit()
print("registry copy: marked", n, "protected rows disconnected (the scheduler skips disconnected servers):", list(c.execute("select name,disconnected_at is not null from servers")))
s=sqlite3.connect("${T}/settings.db"); s.execute("delete from settings where key='scheduler.paused'"); s.commit()
print("settings copy now:", list(s.execute("select key,value from settings")))
`], { stdio: "inherit" });
const a = await startApi(process.argv[2] ?? "c");
console.log("API up, listening pid", a.pid);
await login();
console.log("signed in as my own owner:", (await session()).authenticated === true);
for (let i = 0; i < 40; i++) {
  const r = await http("GET", "/api/scheduler", undefined, { quiet: true });
  if (i === 0) console.log("scheduler:", JSON.stringify(r.json));
  await sleep(1500);
  const st = readFileSync(`${T}/api-${process.argv[2] ?? "c"}.out`, "utf8");
  if (/check finished/.test(st) || /check failed/.test(st)) { console.log("health check log:", st.split("\n").filter((l) => /check (finished|failed)/.test(l)).map((l) => { try { const j = JSON.parse(l); return `${j.host} ${j.result ?? j.code}`; } catch { return l.slice(0, 120); } }).join(" | ")); break; }
}
const p = await http("POST", "/api/plans", { operation: "apply.packages.v1", serverId: IDS.sentani });
console.log("sentani package plan (nothing pending):", p.status, "blockers:", JSON.stringify((p.json.blockers ?? []).map((b) => b.code)), "approvable:", p.json.approvable);
appendFileSync(`${T}/s1.txt`, JSON.stringify({ blockers: p.json.blockers, approvable: p.json.approvable }) + "\n");
