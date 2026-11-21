// T-089 s4: scenario (3) through the app on Sentani, after founder round R2 (LLVM set downgraded) AND a cache clean.
//   lost ack      SIGKILL the API's own gateway ssh client during the submit
//   API crash     SIGKILL the API process while the helper is working (download phase), restart it, let it reconcile
//   pass          one operation id, one servrsit-op unit, one apt transaction, dpkg --audit clean, same manifest digest throughout
// Refuses to run when the LLVM .deb files are still in apt's cache (the operation would finish in ~10 s: no window).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { http, IDS, T, login, session, sleep, probe, helperQuery, versions, packagesPrecondition, TERMINAL, listeningPid, startApi, setPaused, killApiHard, waitGatewaySsh, killPid, sshChildren, straceSummary } from "./lib.mjs";

const log = (s) => { console.log(s); appendFileSync(`${T}/s4.txt`, `${new Date().toISOString().slice(11, 23)} ${s}\n`); };
const R2 = { libllvm18: "1:18.1.3-1", "libclang-cpp18": "1:18.1.3-1", "libclang1-18": "1:18.1.3-1" };
const summary = { startedAt: new Date().toISOString(), tags: [] };

// ---- pre-flight, read-only
const audit0 = probe("auditstate");
const v0 = versions(audit0);
if (!Object.entries(R2).every(([k, ver]) => v0[k] === ver)) { log("STOP: R2 not in place: " + JSON.stringify(v0)); process.exit(3); }
const cached = Number(audit0.split("---cachedllvm")[1]?.trim());
if (cached > 0 && process.env.ALLOW_FAST !== "1") { log(`STOP: ${cached} LLVM .deb files are still in apt's cache; the operation would finish in ~10 s. Ask the founder for: sudo apt-get clean`); process.exit(6); }
const lock = probe("dpkglock"); if (/locks=[1-9]/.test(lock) || !/holds=\s*$/m.test(lock)) { log("STOP: lock or hold present: " + lock.trim()); process.exit(7); }
log(`pre-flight ok: LLVM set at the older versions, ${cached} LLVM debs cached, no lock, no hold`);
const servicesBefore = probe("services");
const unitsBefore = (probe("opunits").match(/Started servrsit-op-[0-9a-f-]+/g) ?? []).length;

// ---- instance
async function ensureUp(tag) {
  if (listeningPid() !== null) return;
  setPaused(false);
  await startApi(tag); summary.tags.push(tag);
  for (let i = 0; i < 60 && !/check (finished|failed)/.test(readFileSync(`${T}/api-${tag}.out`, "utf8")); i++) await sleep(1500);
}
const tag1 = "k" + Date.now().toString(36).slice(-4);
await ensureUp(tag1);
await login();
log(`signed in as my own owner: ${(await session()).authenticated === true}; API pid ${listeningPid()}`);

// ---- plan and approve
const plan = (await http("POST", "/api/plans", { operation: "apply.packages.v1", serverId: IDS.sentani })).json;
log(`plan ${plan.id} v${plan.version}: ${plan.scope.packages.map((c) => `${c.name}:${c.arch} ${c.from}->${c.to}`).join(", ")} blockers=${JSON.stringify((plan.blockers ?? []).map((b) => b.code))} approvable=${plan.approvable}`);
const mine = packagesPrecondition(plan.scope.packages);
log(`digest check again: controller ${plan.preconditions.previewDigest.slice(0, 19)} mine ${mine.slice(0, 19)} equal=${mine === plan.preconditions.previewDigest}`);
if (!plan.approvable) { log("STOP: plan not approvable"); process.exit(4); }
const apiPid1 = listeningPid();
const body = { planVersion: plan.version, planDigest: plan.digest, idempotencyKey: randomBytes(18).toString("base64url"), acknowledgements: plan.requiredAcknowledgements ?? [] };
const t0 = Date.now(); const rel = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const a = await http("POST", `/api/plans/${plan.id}/approvals`, body);
const opId = a.json?.operationId;
log(`${rel()} approve: ${a.status} operation ${opId} ${a.json?.state}`);
if (!opId) process.exit(5);
summary.opId = opId; summary.planId = plan.id;

// ---- follow the operation's events from the API; log each new one
let seen = 0, lastState = "";
async function pump() {
  const j = (await http("GET", `/api/operations/${opId}`, undefined, { quiet: true })).json;
  if (!j?.operation) return null;
  for (const e of j.events.slice(seen)) log(`${rel()}   event ${e.type} ${JSON.stringify(e.detail ?? e.payload ?? {}).slice(0, 230)}`);
  seen = j.events.length;
  if (j.operation.state !== lastState) { lastState = j.operation.state; log(`${rel()}   state ${lastState}`); }
  return j;
}

// ---- 1. lost ack: kill the API's gateway ssh client during the submit
const kills = [];
for (let n = 1; n <= 2; n++) {
  const c = await waitGatewaySsh(apiPid1, n === 1 ? 40000 : 90000);
  if (!c) { log(`${rel()} no gateway ssh child seen for kill #${n}`); break; }
  await sleep(n === 1 ? 1000 : 1500);
  const at = killPid(c.pid);
  kills.push({ n, pid: c.pid, seenAt: c.seenAt, killedAt: at });
  log(`${rel()} LOST ACK #${n}: SIGKILL of the API's gateway ssh client pid ${c.pid} (seen ${c.seenAt.slice(11, 23)}, killed ${at?.slice(11, 23)})`);
  await sleep(2500);
  const h = helperQuery(opId);
  log(`${rel()} my own gateway query of that id: ${JSON.stringify({ found: h.found, state: h.record?.state, digest: h.record?.manifestDigest?.slice(0, 19) })}`);
  summary[`helperAfterKill${n}`] = h;
  await pump();
  if (h.found) break;            // the request had reached the helper: the ack was really lost
  log(`${rel()} the helper does not have it yet (the kill landed before the request was delivered); waiting for the app's retry to kill that one too`);
}
summary.kills = kills;

// ---- let the app re-find it, then crash the whole API while the helper is still working
let j = null;
for (let i = 0; i < 45; i++) { j = await pump(); if (j && j.events.some((e) => /remote_accepted|remote_progress/.test(e.type))) break; await sleep(1000); }
const h2 = helperQuery(opId);
log(`${rel()} before the API crash, helper says: ${JSON.stringify({ found: h2.found, state: h2.record?.state, outcome: h2.outcome })}; the app says state=${lastState}`);
summary.helperBeforeCrash = h2; summary.appStateBeforeCrash = lastState; summary.eventsBeforeCrash = j?.events ?? [];
if (h2.record?.state === "finished") log(`${rel()} NOTE: the helper had already finished; the API crash below is not mid-download (window missed)`);
const crashed = killApiHard();
log(`${rel()} API CRASH: SIGKILL of the API process pid ${crashed} (apiPid at start ${apiPid1})`);
summary.crash = { pid: crashed, at: new Date().toISOString(), helperState: h2.record?.state };
for (let i = 0; i < 40 && listeningPid() !== null; i++) await sleep(250);
await sleep(3000);
const tag2 = "r" + Date.now().toString(36).slice(-4);
await ensureUp(tag2);
log(`${rel()} API restarted (tag ${tag2}), pid ${listeningPid()}`);
await login();
log(`${rel()} signed in again`);

// ---- recovery: follow to the end
for (let i = 0; i < 300; i++) {
  j = await pump();
  const st = j?.operation?.state;
  if (st && (TERMINAL.has(st) || st === "outcome_unknown")) break;
  await sleep(2000);
}
log(`${rel()} final app state: ${lastState}`);
const final = (await http("GET", `/api/operations/${opId}`)).json;
summary.operation = final.operation; summary.events = final.events;

// ---- verdict inputs: the helper's record, the Activity entry, and Sentani checked independently as spotty
const ledger = helperQuery(opId);
log("helper ledger: " + JSON.stringify(ledger));
summary.ledger = ledger;
const act = (await http("GET", `/api/activity?server=${IDS.sentani}&limit=20`)).json;
const mineAct = (act.records ?? []).filter((r) => JSON.stringify(r).includes(opId));
log(`Activity entries for this operation: ${mineAct.length} ${mineAct.map((r) => `${r.title}/${r.result}`).join(", ")}`);
const audit1 = probe("auditstate"); log("--- after (as spotty)\n" + audit1.trim());
const toV = Object.fromEntries(plan.scope.packages.map((c) => [c.name, c.to])); const v1 = versions(audit1);
const matched = Object.entries(toV).filter(([k, ver]) => v1[k] === ver).length;
const units = (probe("opunits").match(new RegExp(`Started servrsit-op-${opId}`, "g")) ?? []).length;
const histTxt = probe("dpkglog"); const hist = histTxt.slice(histTxt.indexOf("---apthistory")).split("\n").filter((l) => /^(Start-Date|Upgrade|End-Date)/.test(l));
log(`independent: ${matched} of ${Object.keys(toV).length} packages at the planned version; servrsit-op units started for this id: ${units}; dpkg --audit exit: ${/audit-exit=0/.test(audit1) ? 0 : "NOT 0"}`);
log("apt history (last):\n" + hist.slice(-4).join("\n"));
const dispatches = final.events.filter((e) => e.type === "dispatch_attempted");
const digests = [...new Set(final.events.map((e) => (e.detail ?? e.payload ?? {}).manifestDigest).filter(Boolean))];
log(`dispatch_attempted events: ${dispatches.length} (retry flags: ${JSON.stringify(dispatches.map((e) => (e.detail ?? e.payload ?? {}).retry))}); distinct manifest digests across events: ${digests.length} ${digests.map((d) => d.slice(0, 19)).join(",")}; helper digest ${ledger.record?.manifestDigest?.slice(0, 19)}`);
const sv = probe("services"); const changed = sv.split("\n").filter((l) => l && !servicesBefore.includes(l) && !/user@999/.test(l));
log(changed.length === 0 ? "running services: no PID or start time changed (apart from the gateway account's own session manager)" : "services changed:\n" + changed.join("\n"));
const st = Object.fromEntries(summary.tags.map((t) => { try { const r = straceSummary(t); return [t, r.launches]; } catch { return [t, "no log"]; } }));
log("strace ssh launches per run: " + JSON.stringify(st));
Object.assign(summary, { matched, units, unitsBeforeRun: unitsBefore, dispatches: dispatches.length, digests, activity: mineAct, servicesChanged: changed, strace: st });
writeFileSync(`${T}/s4.json`, JSON.stringify(summary, null, 1), { mode: 0o600 });
log("summary saved to /tmp/t089/s4.json");
