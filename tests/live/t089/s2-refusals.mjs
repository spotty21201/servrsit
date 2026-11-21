// T-089 s2: refusals that need no pending package, tested down to APPROVAL (not only plan creation).
//   phase A  protected servers connected, scheduler paused: plan then approve -> must be refused, zero contact (strace)
//   phase B  Sentani only, scheduler running, identity verified: restart / reboot / directories plans -> approval refused
// Usage: node s2-refusals.mjs A|B <tag>
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { http, IDS, T, stopApi, startApi, login, session, setPaused, snapshotRegistry, useDatabases, straceSummary, sleep } from "./lib.mjs";

const phase = process.argv[2], tag = process.argv[3];
const out = (line) => { console.log(line); appendFileSync(`${T}/s2-${phase}.txt`, line + "\n"); };
const key = () => randomBytes(18).toString("base64url");
const approve = (p, acks = p.requiredAcknowledgements ?? []) =>
  http("POST", `/api/plans/${p.id}/approvals`, { planVersion: p.version, planDigest: p.digest, idempotencyKey: key(), acknowledgements: acks });
const show = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 220)}`;

await stopApi();
if (phase === "A") { snapshotRegistry(`${T}/servers-A.db`); useDatabases({ registry: `${T}/servers-A.db`, care: `${T}/care-A.db` }); setPaused(true); }
else { useDatabases({}); setPaused(false); }
await startApi(tag);
await login();
out(`phase ${phase}: signed in as my own owner: ${(await session()).authenticated === true}`);
if (phase === "B") { for (let i = 0; i < 40; i++) { await sleep(1500); const r = await http("GET", "/api/scheduler", undefined, { quiet: true }); if (r.json?.lastRunAt ?? r.json?.status === "idle") break; } await sleep(4000); }

const cases = phase === "A"
  ? [["nabire", { operation: "apply.packages.v1", serverId: IDS.nabire }], ["timika", { operation: "apply.packages.v1", serverId: IDS.timika }], ["merauke", { operation: "apply.packages.v1", serverId: IDS.merauke }],
     ["nabire reboot", { operation: "reboot.host.v1", serverId: IDS.nabire }], ["timika restart", { operation: "restart.service.v1", serverId: IDS.timika, unit: "ssh.service" }]]
  : [["sentani restart ssh.service", { operation: "restart.service.v1", serverId: IDS.sentani, unit: "ssh.service" }], ["sentani restart multipathd.service", { operation: "restart.service.v1", serverId: IDS.sentani, unit: "multipathd.service" }],
     ["sentani reboot", { operation: "reboot.host.v1", serverId: IDS.sentani }], ["sentani directories", { operation: "prepare.directories.v1", serverId: IDS.sentani, directories: [{ path: "/srv/app", owner: "root", group: "root", mode: "0755" }] }],
     ["sentani packages (none pending)", { operation: "apply.packages.v1", serverId: IDS.sentani }]];

for (const [label, body] of cases) {
  const p = await http("POST", "/api/plans", body);
  const blockers = (p.json?.blockers ?? []).map((b) => b.code);
  out(`plan  ${label}: ${p.status} blockers=${JSON.stringify(blockers)} approvable=${p.json?.approvable} previewDigest=${p.json?.preconditions?.previewDigest?.slice(0, 19)}`);
  const a = await approve(p.json);
  out(`  approve ${label}: ${show(a)}`);
  out(`  operation created: ${a.json?.operationId !== undefined}`);
}
await sleep(1500);
const sum = straceSummary(tag);
out(`strace(${tag}): ssh launches ${JSON.stringify(sum.launches)} | connect to Nabire ${sum.nabire}, Timika ${sum.timika}, ssh naming a protected server ${sum.protectedLaunches}`);
out(`strace(${tag}): all connect() destinations ${JSON.stringify(sum.connects)}`);
