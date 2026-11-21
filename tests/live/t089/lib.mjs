/**
 * T-089 Tester library: drives the UNMODIFIED production API (apps/api/src/index.ts) as a second instance.
 *
 *   - own PORT, own copies of every database (/tmp/t089), a registry SNAPSHOT (SQLite backup API),
 *     scheduler paused and AI off (seeded in the copy of the settings store) so the instance makes no background
 *     check and no metered call;
 *   - the SAME config/writes.json, keys and Sentani registry row as the founder's instance (read from their
 *     default locations, never copied or edited);
 *   - run under `strace -f -e trace=connect,execve`, so every connect() and every ssh launch is on record;
 *   - my own owner account (own password, own RFC 6238 code), never the founder's.
 *
 * Secrets (password, TOTP secret, setup token, session cookie, CSRF token) live in memory and in 0600 files under
 * /tmp/t089 only. They are never written to the HTTP log, the report or the repository.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, closeSync, openSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";

export const T = "/tmp/t089";
// The founder's checkout, read-only: I run the same code and the same rebuilt dist his API runs (T-089 re-verified against his
// build after the 12:05 rebuild). I never build, install or edit anything there. Its .data/helper is a plain directory, as the
// product's key loader requires.
export const WT = "/projects/servrsit";
export const API_DIR = `${WT}/apps/api`;
export const PORT = 38917;
export const BASE = `http://127.0.0.1:${PORT}`;
export const NODE_BIN = `${process.env.HOME}/.local/node24/bin`;
export const IDS = {
  timika: "11111111-1111-4111-a111-111111111111",
  nabire: "22222222-2222-4222-a222-222222222222",
  merauke: "44444444-4444-4444-a444-444444444444",
  sentani: "75e41a8a-6a97-4a06-8151-c0cb33ad0fc1",
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------------------------- TOTP (RFC 6238, own)
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of s.replace(/=+$/g, "").toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totp(secret, ms = Date.now()) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(ms / 30000)));
  const h = createHmac("sha1", b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
const nextWindow = () => sleep(30000 - (Date.now() % 30000) + 700); // a code can be used once

// ---------------------------------------------------------------------------------------------- process control
let OVERRIDE = {};
export const useDatabases = (o) => { OVERRIDE = o; };
const env = () => ({
  PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: process.env.HOME, LANG: "C.UTF-8", PORT: String(PORT),
  SERVRSIT_REGISTRY_DB: OVERRIDE.registry ?? `${T}/servers.db`, SERVRSIT_FINDINGS_DB: `${T}/findings.db`, SERVRSIT_ACTIVITY_DB: `${T}/activity.db`,
  SERVRSIT_BASELINES_DB: `${T}/baselines.db`, SERVRSIT_SETTINGS_DB: `${T}/settings.db`, SERVRSIT_AUTH_DB: `${T}/auth.db`,
  SERVRSIT_CARE_DB: OVERRIDE.care ?? `${T}/care.db`, SERVRSIT_INTENTS_DIR: `${T}/intents`,
});

export function listeningPid() {
  const want = `0100007F:${PORT.toString(16).toUpperCase().padStart(4, "0")}`;
  let inode = null;
  for (const l of readFileSync("/proc/net/tcp", "utf8").split("\n").slice(1)) {
    const f = l.trim().split(/\s+/);
    if (f[3] === "0A" && f[1] === want) inode = f[9];
  }
  if (inode === null) return null;
  for (const p of readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    let fds; try { fds = readdirSync(`/proc/${p}/fd`); } catch { continue; }
    for (const fd of fds) { try { if (readlinkSync(`/proc/${p}/fd/${fd}`) === `socket:[${inode}]`) return Number(p); } catch { /* closed */ } }
  }
  return null;
}

/** Starts the production entry point under strace. `tag` names this run's logs (api-<tag>.out/.err, strace-<tag>.log). */
export async function startApi(tag) {
  if (listeningPid() !== null) throw new Error(`port ${PORT} is already in use`);
  const out = openSync(`${T}/api-${tag}.out`, "a", 0o600), err = openSync(`${T}/api-${tag}.err`, "a", 0o600);
  const child = spawn("/usr/bin/strace", ["-f", "-qq", "-e", "trace=connect,execve", "-s", "400", "-o", `${T}/strace-${tag}.log`, "--",
    `${NODE_BIN}/node`, `${WT}/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs`, "src/index.ts"],
  { cwd: API_DIR, env: env(), stdio: ["ignore", out, err], detached: true });
  child.unref(); closeSync(out); closeSync(err);
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try { const r = await fetch(`${BASE}/api/auth/session`); if (r.ok) return { straceTag: tag, wrapperPid: child.pid, pid: listeningPid() }; } catch { /* not yet */ }
  }
  throw new Error("API did not start within 60 s; see " + `${T}/api-${tag}.err`);
}

export function killApiHard() {
  const pid = listeningPid();
  if (pid !== null) process.kill(pid, "SIGKILL");
  return pid;
}

export async function stopApi() {
  const pid = listeningPid();
  if (pid !== null) process.kill(pid, "SIGTERM");
  for (let i = 0; i < 40 && listeningPid() !== null; i++) await sleep(250);
}

export function setupToken(tag) {
  const m = readFileSync(`${T}/api-${tag}.err`, "utf8").match(/Setup token[^\n]*\n\s*\n\s*(\S{16,})/);
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------------------------- HTTP client
let cookies = new Map(), csrf = null;
const jar = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(res) {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [kv, ...attrs] = sc.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (/max-age=0|expires=thu, 01 jan 1970/i.test(attrs.join(";")) || v === "") cookies.delete(k); else cookies.set(k, v);
  }
}
const SECRET_PATHS = /^\/api\/auth\//;

export async function http(method, path, body, { quiet = false } = {}) {
  const headers = { cookie: jar() };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  const t0 = Date.now();
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  absorb(res);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (!quiet) appendFileSync(`${T}/http.jsonl`, JSON.stringify({ at: now(), method, path, status: res.status, ms: Date.now() - t0, reply: SECRET_PATHS.test(path) ? "(auth, not logged)" : json ?? text.slice(0, 200) }) + "\n", { mode: 0o600 });
  return { status: res.status, json };
}

const cred = () => JSON.parse(readFileSync(`${T}/.cred`, "utf8"));

/** First run: enrol my own owner. Credentials go to a 0600 file outside the repository. */
export async function enrol(tag) {
  const token = setupToken(tag);
  if (!token) throw new Error("no setup token printed (an owner already exists in my auth copy?)");
  const password = randomBytes(18).toString("base64url") + "aA1!";
  const s = await http("POST", "/api/auth/setup", { setupToken: token, username: "tester", password });
  if (s.status !== 200) throw new Error("setup refused: " + s.status);
  const secret = s.json.totpSecret;
  writeFileSync(`${T}/.cred`, JSON.stringify({ username: "tester", password, secret }), { mode: 0o600 });
  const c = await http("POST", "/api/auth/setup/confirm", { code: totp(secret) });
  if (c.status !== 200) throw new Error("confirm refused: " + c.status);
  csrf = c.json.session.csrfToken;
  return true;
}

export async function login() {
  const { username, password, secret } = cred();
  cookies = new Map(); csrf = null;
  const a = await http("POST", "/api/auth/login", { username, password });
  if (a.status !== 200) throw new Error("login refused: " + a.status);
  await nextWindow();
  const b = await http("POST", "/api/auth/totp", { code: totp(secret) });
  if (b.status !== 200) throw new Error("totp refused: " + b.status);
  csrf = b.json.csrfToken;
  return true;
}

export async function session() {
  const r = await http("GET", "/api/auth/session", undefined, { quiet: true });
  if (r.json?.csrfToken) csrf = r.json.csrfToken;
  return r.json;
}

// ---------------------------------------------------------------------------------------------- the API's own ssh children
function readProc(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8"); const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    return { pid, ppid, args };
  } catch { return null; }
}
/** ssh clients started by the API process: [{pid, user}] where user is the `-l` value (servrsit = gateway, spotty = inspect). */
export function sshChildren(apiPid) {
  const out = [];
  for (const p of readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    const r = readProc(p); if (r === null || r.args[0] !== "/usr/bin/ssh") continue;
    // strace -f makes the API a child of strace; the ssh client is a child of the API node process
    if (r.ppid !== apiPid) continue;
    const i = r.args.indexOf("-l");
    out.push({ pid: r.pid, user: i >= 0 ? r.args[i + 1] : null });
  }
  return out;
}
/** Waits for the API to start a gateway ssh (-l servrsit); returns its pid and the time seen. */
export async function waitGatewaySsh(apiPid, timeoutMs = 120000, user = "servrsit") {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const c = sshChildren(apiPid).find((x) => x.user === user);
    if (c) return { ...c, seenAt: now() };
    await sleep(20);
  }
  return null;
}
export function killPid(pid) { try { process.kill(pid, "SIGKILL"); return now(); } catch { return null; } }

// ---------------------------------------------------------------------------------------------- my own copies' state
/** Edits MY copy of the registry/settings only: protected servers connected (phase A) or disconnected (phase B), scheduler paused or running. */
export function setState({ protectedConnected, paused }) {
  execFileSync("python3", ["-c", `
import sqlite3
c=sqlite3.connect("${T}/servers.db"); keep="${IDS.sentani}"
if ${protectedConnected ? "True" : "False"}:
    c.execute("update servers set disconnected_at=NULL where id in (?,?,?)", ("${IDS.timika}","${IDS.nabire}","${IDS.merauke}"))
else:
    c.execute("update servers set disconnected_at='2026-11-21T11:45:00.000Z' where id in (?,?,?) and disconnected_at is null", ("${IDS.timika}","${IDS.nabire}","${IDS.merauke}"))
c.commit()
s=sqlite3.connect("${T}/settings.db")
s.execute("delete from settings where key='scheduler.paused'")
if ${paused ? "True" : "False"}:
    s.execute("insert into settings(key,value,updated_at,updated_by) values('scheduler.paused', '{\\"since\\":\\"2026-11-21T12:00:00.000Z\\",\\"reason\\":\\"T-089 Tester instance\\"}', '2026-11-21T12:00:00.000Z', 'tester')")
s.commit()
print("state:", {r[0]: ("disconnected" if r[1] else "connected") for r in c.execute("select name||':'||substr(id,1,4), disconnected_at is not null from servers")}, "| paused:", ${paused ? "True" : "False"})
`], { stdio: "inherit" });
}

/** Distinct connect() destinations and ssh launches recorded by strace for one run tag. */
export function straceSummary(tag) {
  const st = readFileSync(`${T}/strace-${tag}.log`, "utf8");
  const count = (xs) => Object.fromEntries(Object.entries(xs.reduce((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {})));
  const connects = [...st.matchAll(/connect\(\d+, \{sa_family=AF_INET, sin_port=htons\((\d+)\), sin_addr=inet_addr\("([\d.]+)"\)/g)].map((m) => `${m[2]}:${m[1]}`);
  const ssh = [...st.matchAll(/execve\("\/usr\/bin\/ssh", \[([^\]]*)\]/g)].map((m) => { const a = m[1].replace(/"/g, "").split(", "); const i = a.indexOf("-l"); const j = a.indexOf("--"); return `-l ${a[i + 1]} -> ${a[j + 1]}`; });
  return { connects: count(connects), launches: count(ssh), nabire: connects.filter((c) => c.startsWith("100.117.187.86")).length, timika: connects.filter((c) => c.startsWith("100.120.143.103")).length, protectedLaunches: ssh.filter((x) => /nabire|timika|merauke/.test(x)).length };
}

/** A fresh consistent snapshot of the founder's registry (read-only source) into one of my own files. */
export function snapshotRegistry(dest) {
  execFileSync("python3", ["-c", `
import sqlite3, os
src=sqlite3.connect("file:/projects/servrsit/apps/api/.data/servers.db?mode=ro", uri=True)
if os.path.exists("${dest}"): os.remove("${dest}")
dst=sqlite3.connect("${dest}"); src.backup(dst); dst.close(); os.chmod("${dest}", 0o600)
print("registry snapshot:", "${dest}")
`], { stdio: "inherit" });
}
/** Scheduler paused or running in MY settings copy. */
export function setPaused(paused) {
  execFileSync("python3", ["-c", `
import sqlite3
s=sqlite3.connect("${T}/settings.db"); s.execute("delete from settings where key='scheduler.paused'")
if ${paused ? "True" : "False"}:
    s.execute("insert into settings(key,value,updated_at,updated_by) values('scheduler.paused', '{\\"since\\":\\"2026-11-21T12:00:00.000Z\\",\\"reason\\":\\"T-089 Tester instance\\"}', '2026-11-21T12:00:00.000Z', 'tester')")
s.commit(); print("scheduler paused:", ${paused ? "True" : "False"})
`], { stdio: "inherit" });
}

// ---------------------------------------------------------------------------------------------- read-only probes on Sentani (T-088 harness)
const H_MTS = "/projects/servrsit-tester/tests/live/t088/h.mts";
const TSX = `${WT}/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs`;
/** A fixed read-only probe over the inspect key (as spotty), or a gateway query: `probe("dpkg")`, `helperQuery(opId)`. */
export function probe(name, ...args) {
  return execFileSync(`${NODE_BIN}/node`, [TSX, H_MTS, "probe", name, ...args], { cwd: API_DIR, env: { ...process.env, PATH: `${NODE_BIN}:/usr/bin:/bin` }, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "ignore"] });
}
export function helperQuery(operationId) {
  const out = execFileSync(`${NODE_BIN}/node`, [TSX, H_MTS, "query", operationId], { cwd: API_DIR, env: { ...process.env, PATH: `${NODE_BIN}:/usr/bin:/bin` }, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).reply;
}
/** Parses `dpkg-query` lines "name version status" into {name: version}. */
export const versions = (txt) => Object.fromEntries(txt.split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3 && /^[a-z0-9][a-z0-9+.-]*(:[a-z0-9]+)?$/.test(p[0]) && /^\d|^\d+:/.test(p[1])).map((p) => [p[0].replace(/:.*/, ""), p[1]]));

// ---------------------------------------------------------------------------------------------- independent digest (own canonical JSON)
import { createHash } from "node:crypto";
export const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
export const digestOf = (v) => "sha256:" + createHash("sha256").update(canon(v), "utf8").digest("hex");
/** The helper's package precondition rule, re-implemented from target-helper/servrsit_helper/adapters.py: digest_of({"installed": {"name:arch": installedVersion}}). */
export const packagesPrecondition = (packages) => digestOf({ installed: Object.fromEntries(packages.map((c) => `${c.name}:${c.arch}`).sort().map((k) => [k, packages.find((c) => `${c.name}:${c.arch}` === k).from])) });
export const TERMINAL = new Set(["succeeded", "failed", "partially_succeeded", "cancelled", "expired", "blocked"]);
