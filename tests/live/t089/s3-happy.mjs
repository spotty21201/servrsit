// T-089 s3: scenarios (1) and (2) through the app on Sentani, after founder round R1 (vim set + wget downgraded).
//   (1) the controller's previewDigest equals the helper's package precondition rule (independent computation + the helper accepting it)
//   (2) plan -> approve -> dispatch -> helper -> independent verification -> succeeded; operation record, Activity entry,
//       kept owner file, idempotent replay of the same approval
// Needs my instance up (node s1-sentani-only.mjs <tag>) and R1 applied. Waits (read-only) for R1 for up to 25 minutes.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { http, IDS, T, login, session, sleep, probe, helperQuery, versions, packagesPrecondition, TERMINAL, listeningPid, startApi, setPaused } from "./lib.mjs";
import { randomBytes } from "node:crypto";

const log = (s) => { console.log(s); appendFileSync(`${T}/s3.txt`, s + "\n"); };
const R1 = { vim: "2:9.1.0016-1ubuntu7", "vim-common": "2:9.1.0016-1ubuntu7", "vim-runtime": "2:9.1.0016-1ubuntu7", "vim-tiny": "2:9.1.0016-1ubuntu7", xxd: "2:9.1.0016-1ubuntu7", wget: "1.21.4-1ubuntu4" };
const summary = { startedAt: new Date().toISOString() };

// Resumable: start my instance (Sentani-only registry copy, scheduler running, AI off) if it is not up, and wait for the first
// Sentani health check, because the identity (machine id) comes from it.
if (listeningPid() === null) {
  const tag = "h" + Date.now().toString(36).slice(-4);
  setPaused(false);
  await startApi(tag);
  for (let i = 0; i < 60 && !/check (finished|failed)/.test(readFileSync(`${T}/api-${tag}.out`, "utf8")); i++) await sleep(1500);
  log(`instance ${tag} started; first health check: ${/check finished/.test(readFileSync(`${T}/api-${tag}.out`, "utf8")) ? "ok" : "NOT ok"}`);
}
await login();
log(`signed in as my own owner: ${(await session()).authenticated === true}`);
log(`helper: ${JSON.stringify(helperQuery("00000000-0000-4000-8000-000000000003"))}`);

// ---- wait (read-only) for R1: every package at the older version, nothing held, no lock
let before = null;
for (let i = 0; i < 100; i++) {
  before = probe("wgetrcstate");
  const v = versions(before);
  if (Object.entries(R1).every(([k, ver]) => v[k] === ver)) break;
  if (i === 0) log("waiting (read-only) for founder round R1: " + JSON.stringify(Object.fromEntries(Object.keys(R1).map((k) => [k, v[k]]))));
  before = null; await sleep(15000);
}
if (before === null) { log("STOP: R1 not seen within 25 minutes; nothing was sent"); process.exit(3); }
log(`R1 seen at ${new Date().toISOString()}`);
log("--- before (as spotty)\n" + before.trim());
summary.before = before;
const servicesBefore = probe("services");
const pending = probe("aptsim");
log("--- pending per apt-get -s upgrade\n" + pending.split("\n").filter((l) => /^Inst|upgraded/.test(l)).join("\n"));

// ---- (1) plan and the digest
const p = await http("POST", "/api/plans", { operation: "apply.packages.v1", serverId: IDS.sentani });
const plan = p.json;
log(`plan: ${p.status} id=${plan.id} v${plan.version} blockers=${JSON.stringify((plan.blockers ?? []).map((b) => b.code))} approvable=${plan.approvable} acks=${JSON.stringify(plan.requiredAcknowledgements)}`);
log("plan packages: " + plan.scope.packages.map((c) => `${c.name}:${c.arch} ${c.from}->${c.to}`).join(", "));
log(`plan excluded: ${JSON.stringify(plan.scope.excludedPackages)} | keptOwnerFiles: ${JSON.stringify(plan.keptOwnerFiles ?? plan.scope.keptOwnerFiles ?? null)}`);
const mine = packagesPrecondition(plan.scope.packages);
summary.plan = { id: plan.id, version: plan.version, digest: plan.digest, previewDigest: plan.preconditions.previewDigest, packages: plan.scope.packages };
summary.digestCheck = { controller: plan.preconditions.previewDigest, mine, equal: mine === plan.preconditions.previewDigest };
log(`(1) controller previewDigest ${plan.preconditions.previewDigest}\n    my independent computation  ${mine}\n    EQUAL: ${mine === plan.preconditions.previewDigest}`);
if (!plan.approvable) { log("STOP: plan is not approvable"); process.exit(4); }

// ---- (2) approve, replay, follow
const key = randomBytes(18).toString("base64url");
const body = { planVersion: plan.version, planDigest: plan.digest, idempotencyKey: key, acknowledgements: plan.requiredAcknowledgements ?? [] };
const t0 = Date.now();
const a = await http("POST", `/api/plans/${plan.id}/approvals`, body);
log(`approve: ${a.status} ${JSON.stringify(a.json)}`);
const opId = a.json?.operationId;
if (!opId) { log("STOP: no operation created"); process.exit(5); }
const a2 = await http("POST", `/api/plans/${plan.id}/approvals`, body);
log(`same approval again (same idempotency key): ${a2.status} ${JSON.stringify(a2.json)}  -> same operation: ${a2.json?.operationId === opId}`);
summary.opId = opId; summary.approve = a.json; summary.replay = a2.json;

let last = "", op = null;
for (let i = 0; i < 300; i++) {
  const r = await http("GET", `/api/operations/${opId}`, undefined, { quiet: true });
  op = r.json; const st = op?.operation?.state;
  if (st !== last) { log(`  +${Math.round((Date.now() - t0) / 1000)}s state=${st}`); last = st; }
  if (st !== undefined && (TERMINAL.has(st) || st === "outcome_unknown")) break;
  await sleep(2000);
}
const view = (await http("GET", `/api/operations/${opId}`)).json;
log("operation: " + JSON.stringify(view.operation));
log("events:\n" + view.events.map((e) => `  ${e.at ?? ""} ${e.type ?? e.kind ?? ""} ${JSON.stringify(e.detail ?? e.payload ?? e).slice(0, 200)}`).join("\n"));
summary.operation = view.operation; summary.events = view.events;

// ---- the helper's own record and the Activity entry
const ledger = helperQuery(opId);
log("helper ledger (query by the same op id): " + JSON.stringify(ledger));
summary.ledger = ledger;
const act = (await http("GET", `/api/activity?server=${IDS.sentani}&limit=20`)).json;
const mineAct = (act.records ?? []).filter((r) => JSON.stringify(r).includes(opId) || JSON.stringify(r).includes(plan.id));
log(`Activity entries mentioning this operation or plan: ${mineAct.length}\n` + mineAct.map((r) => "  " + JSON.stringify(r).slice(0, 400)).join("\n"));
summary.activity = mineAct;

// ---- independent verification on Sentani (as spotty), not through the app or the helper
const after = probe("wgetrcstate");
log("--- after (as spotty)\n" + after.trim());
const toVersions = Object.fromEntries(plan.scope.packages.map((c) => [c.name, c.to]));
const v = versions(after);
const matched = Object.entries(toVersions).filter(([k, ver]) => v[k] === ver).map(([k]) => k);
log(`independent dpkg check: ${matched.length} of ${Object.keys(toVersions).length} packages at the planned version`);
const hist = probe("dpkglog");
log("apt history (last transactions):\n" + hist.slice(hist.lastIndexOf("Start-Date:", hist.lastIndexOf("Start-Date:") - 1)).split("\n").filter((l) => /Start-Date|Upgrade|Requested|End-Date|Commandline/.test(l)).join("\n").slice(0, 1500));
const ops = probe("ops");
log(`servrsit-op units that started for this operation: ${(ops.match(new RegExp(`Started servrsit-op-${opId}`, "g")) ?? []).length}`);
const servicesAfter = probe("services");
log(servicesBefore === servicesAfter ? "all running services: PID and start time unchanged" : "services changed:\n" + servicesAfter.split("\n").filter((l) => !servicesBefore.includes(l)).join("\n"));
summary.afterProbe = after; summary.matched = matched; summary.servicesUnchanged = servicesBefore === servicesAfter;
writeFileSync(`${T}/s3.json`, JSON.stringify(summary, null, 1), { mode: 0o600 });
log("summary saved to /tmp/t089/s3.json");
