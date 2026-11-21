// T-089 s0: start my own instance, enrol my own owner, then (4) protected servers and (5) refused kinds, and a
// baseline plan for Sentani with nothing pending. Run from anywhere, node 24 on PATH.
import { appendFileSync, readFileSync } from "node:fs";
import { http, IDS, T, startApi, enrol, session, sleep } from "./lib.mjs";

const rec = (label, r) => { const line = `${label}: ${r.status} ${JSON.stringify(r.json)}`; console.log(line); appendFileSync(`${T}/s0.txt`, line + "\n"); return r; };

const a = await startApi("a");
console.log("API up, listening pid", a.pid, "port 38917; founder's :3001 untouched");
await enrol("a");
const s = await session();
console.log("my own owner signed in:", s.authenticated === true, "username", s.username);

console.log("\n--- the registry as my instance sees it");
const list = await http("GET", "/api/servers");
console.log(list.status, JSON.stringify(list.json).slice(0, 700));

console.log("\n--- (4) protected servers: a package plan must be WRITES_DISABLED, and the server must not be contacted");
for (const n of ["nabire", "timika", "merauke"]) rec(`(4) ${n} apply.packages.v1`, await http("POST", "/api/plans", { operation: "apply.packages.v1", serverId: IDS[n] }));

console.log("\n--- (5) kinds that stay refused, on Sentani and on a protected server");
rec("(5) sentani restart.service.v1 ssh.service", await http("POST", "/api/plans", { operation: "restart.service.v1", serverId: IDS.sentani, unit: "ssh.service" }));
rec("(5) sentani reboot.host.v1", await http("POST", "/api/plans", { operation: "reboot.host.v1", serverId: IDS.sentani }));
rec("(5) sentani prepare.directories.v1", await http("POST", "/api/plans", { operation: "prepare.directories.v1", serverId: IDS.sentani, directories: [{ path: "/srv/app", owner: "root", group: "root", mode: "0755" }] }));
rec("(5) nabire reboot.host.v1", await http("POST", "/api/plans", { operation: "reboot.host.v1", serverId: IDS.nabire }));
rec("(5) timika restart.service.v1 nginx.service", await http("POST", "/api/plans", { operation: "restart.service.v1", serverId: IDS.timika, unit: "nginx.service" }));

console.log("\n--- baseline: Sentani package plan with nothing pending");
const base = rec("(base) sentani apply.packages.v1", await http("POST", "/api/plans", { operation: "apply.packages.v1", serverId: IDS.sentani }));

await sleep(1500);
const st = readFileSync(`${T}/strace-a.log`, "utf8");
const connects = [...st.matchAll(/connect\(\d+, \{sa_family=AF_INET, sin_port=htons\((\d+)\), sin_addr=inet_addr\("([\d.]+)"\)/g)].map((m) => `${m[2]}:${m[1]}`);
const ssh = [...st.matchAll(/execve\("\/usr\/bin\/ssh", \[([^\]]*)\]/g)].map((m) => m[1].replace(/"/g, "").split(", ").filter((x) => ["-l", "--"].includes(x) || /^(servrsit|spotty|sentani|nabire|timika)$/.test(x)).join(" "));
const uniq = (xs) => Object.entries(xs.reduce((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {}));
console.log("\n--- strace: distinct outgoing connect() destinations since start:", JSON.stringify(uniq(connects)));
console.log("--- strace: ssh launches (user/target words only):", JSON.stringify(uniq(ssh)));
console.log("connections to Nabire 100.117.187.86:", connects.filter((c) => c.startsWith("100.117.187.86")).length, "| Timika 100.120.143.103:", connects.filter((c) => c.startsWith("100.120.143.103")).length, "| any ssh naming nabire/timika/merauke:", ssh.filter((x) => /nabire|timika|merauke/.test(x)).length);
