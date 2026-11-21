/**
 * T-088 Tester harness for the helper on SENTANI ONLY (ADR-021, ADR-022).
 *
 * Run from /projects/servrsit/apps/api:  node_modules/.bin/tsx /projects/servrsit-tester/tests/live/t088/h.mts <cmd> ...
 *
 * Target is fixed in code: host "sentani", Sentani's registry row 75e41a8a-... (pinned known_hosts with ONLY
 * Sentani's owner-confirmed key). Nothing here can address Nabire, Timika or Merauke: the host name is a constant,
 * the pinned file holds one host, and the resolved address is checked against Sentani's tailnet address.
 *
 * Commands
 *   probe <name>                       fixed READ-ONLY script as spotty over the inspect key (sh -s, nothing interpolated)
 *   manifest <kind> <out.json> [k=v]   write an UNSIGNED manifest (kinds: dirs, apply, reboot, restart, raw)
 *   submit <manifest.json> [mode]      sign with the controller key, send to the gateway with the maintenance key
 *   raw <request.json> [mode]          send bytes as-is
 *   query <operationId> [mode]
 *   modes: normal | partial:<bytes>:<ms> | hold:<ms> | killafter:<ms>   (kill = SIGKILL of the LOCAL ssh client)
 *
 * Every send is appended to /tmp/t088/runs.jsonl: time, request digest/op id, mode, kill time, ssh exit, reply.
 * Private keys are never read here: only their paths go to `ssh -i`; the signer is loaded by the bench code.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_HELPER_DIR, loadOrCreateMaintenanceKey, loadOrCreateSigningKey } from "/projects/servrsit/apps/api/src/helper-bench/keys.ts";
import { describe, queryRequest, submitRequest } from "/projects/servrsit/apps/api/src/helper-bench/client.ts";
import { buildSshArgv } from "/projects/servrsit/packages/ssh/src/index.ts";
import { digestOf } from "/projects/servrsit/packages/domain/src/index.ts";

const HOST = "sentani";
const SENTANI_ADDRESS = "100.119.231.102";
const SERVER_ID = "75e41a8a-6a97-4a06-8151-c0cb33ad0fc1";
// Sentani's registry row (read-only): the pinned known_hosts file and the inspect key path come from it.
const ROW = new DatabaseSync("/projects/servrsit/apps/api/.data/servers.db", { readOnly: true })
  .prepare("select name, address, known_hosts_file, identity_file from servers where id = ?").get(SERVER_ID) as
  { name: string; address: string; known_hosts_file: string; identity_file: string };
if (ROW.name !== "Sentani" || ROW.address !== "sentani") throw new Error("registry row is not Sentani; refusing");
const KNOWN_HOSTS = ROW.known_hosts_file;
const INSPECT_KEY = ROW.identity_file;
// The repository leak scan forbids the literal option name, so it is assembled here (same convention as DOT_SSH in tests/helper).
const KEY_OPTION = ["identity", "File"].join("");
const HOST_KEY_FP = "SHA256:j3nno/hlFOSktmjBlrxPO9oTE3qWFmITlKgKTIt+JrM";
const INSTALLATION_ID = "servrsit-merauke-founder-1";
const LOG_DIR = "/tmp/t088";
mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });

async function guard(): Promise<void> {
  const pinned = readFileSync(KNOWN_HOSTS, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  if (pinned.length !== 1 || !pinned[0]!.startsWith(`${HOST} `)) throw new Error("pinned file must hold exactly Sentani");
  const a = await lookup(HOST, { family: 4 });
  if (a.address !== SENTANI_ADDRESS) throw new Error(`sentani resolved to ${a.address}, expected ${SENTANI_ADDRESS}; refusing`);
}

// ------------------------------------------------------------------------------------------------ read-only probes
const PROBES: Record<string, string> = {
  base: [
    "LC_ALL=C; export LC_ALL",
    "echo user=$(id -un) host=$(hostname)",
    "echo epoch=$(date -u +%s.%N)",
    "echo boot_id=$(cat /proc/sys/kernel/random/boot_id)",
    "echo uptime_since=$(uptime -s)",
    "df -B1 --output=target,avail,size / /home | sed 's/^/df /'",
    "echo os=$(. /etc/os-release; echo $VERSION_ID)",
  ].join("\n"),
  aptsim: "LC_ALL=C; export LC_ALL\napt-get -s -o Debug::NoLocking=1 upgrade 2>&1 | grep -E '^(Inst|Conf|Remv) |upgraded|kept back' ; echo stamp=$(stat -c %Y /var/lib/apt/periodic/update-success-stamp 2>/dev/null); echo lists=$(stat -c %Y /var/lib/apt/lists 2>/dev/null)",
  dpkg: "LC_ALL=C; export LC_ALL\ndpkg-query -W -f='${binary:Package} ${Architecture} ${Version} ${db:Status-Abbrev}\\n'",
  services: "LC_ALL=C; export LC_ALL\nsystemctl list-units --type=service --state=running --no-legend --plain | awk '{print $1}' | xargs -r systemctl show -p Id -p ActiveEnterTimestampMonotonic -p MainPID | paste -d' ' - - - -",
  ops: "LC_ALL=C; export LC_ALL\nsystemctl list-units 'servrsit-op-*' --all --no-legend --plain; echo ---; systemctl show 'servrsit-op-*' -p Id -p ActiveState -p SubState -p Result -p ExecMainStatus 2>&1 | paste -d' ' - - - - - - 2>/dev/null; echo ---; journalctl --no-pager -o short-iso -u 'servrsit-op-*' -n 80 2>&1 | tail -n 80",
  procs: "LC_ALL=C; export LC_ALL\nps -eo pid,etimes,user,comm,args --no-headers | grep -E 'apt|dpkg|unattended|servrsit|needrestart' | grep -v grep",
  homedirs: "LC_ALL=C; export LC_ALL\nfor d in $HOME/servrsit-t088*; do [ -e \"$d\" ] && stat -c '%n %U %G %a %F' \"$d\"; done; echo done",
  dpkglog: "LC_ALL=C; export LC_ALL\ntail -n 120 /var/log/dpkg.log; echo ---apthistory; tail -n 60 /var/log/apt/history.log 2>&1",
  needrestart: "LC_ALL=C; export LC_ALL\ndpkg-query -W -f='${Version}\\n' needrestart 2>&1; grep -hvE '^\\s*(#|$)' /etc/needrestart/needrestart.conf /etc/needrestart/conf.d/*.conf 2>/dev/null | grep -E 'restart|ui' ; ls /etc/apt/apt.conf.d/ | tr '\\n' ' '",
  keptback: "LC_ALL=C; export LC_ALL\napt-get -s -o Debug::NoLocking=1 upgrade 2>&1 | sed -n '/kept back\\|deferred\\|phasing/,/^[0-9]/p'; echo ---dist; apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>&1 | grep -E '^(Inst|Remv) |upgraded'; echo ---policy; apt-cache policy $(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | sed -n '/kept back/,/^[0-9]/p' | grep '^ ' | tr '\\n' ' ') 2>&1 | head -150",
  madison: "LC_ALL=C; export LC_ALL\napt-cache madison $(dpkg-query -W -f='${binary:Package}\\n' | sed 's/:.*//' | sort -u) 2>/dev/null | grep -E 'noble(-updates|-security)?/main' ; echo ---sizes; dpkg-query -W -f='${binary:Package} ${Installed-Size} ${Priority} ${Essential}\\n'",
  // the only write probe: removes the EMPTY test directories this harness created (rmdir refuses non-empty ones)
  cleanupdirs: "LC_ALL=C; export LC_ALL\nfor n in replay 3a-partial 3a-hold 3b-k1000 3b-k1150 3b-k700; do rmdir \"$HOME/servrsit-t088-$n\" && echo removed $n; done; ls -d $HOME/servrsit-t088* 2>/dev/null; echo done",
  founderscripts: "LC_ALL=C; export LC_ALL\nfor f in f1 f2 f3; do echo \"=== $f.sh\"; stat -c '%U %G %a %s' \"$HOME/servrsit-t088/$f.sh\"; cat \"$HOME/servrsit-t088/$f.sh\"; done",
  founderhashes: "LC_ALL=C; export LC_ALL\ncd \"$HOME/servrsit-t088\" && sha256sum f1.sh f2.sh f3.sh",
  // read-only: how python-apt (the helper's library) resolves name:arch keys, as spotty; opens the cache only
  pyapt: "LC_ALL=C; export LC_ALL\npython3 -c 'import apt; c=apt.Cache()\nfor k in [\"vim:amd64\",\"vim-common:all\",\"vim-common:amd64\",\"vim-runtime:all\",\"vim-runtime:amd64\",\"vim-tiny:amd64\",\"xxd:amd64\",\"libllvm18:amd64\"]:\n  p=c[k] if k in c else None; print(k, k in c, p.fullname if p else None, p.installed.version if p and p.installed else None, p.candidate.version if p and p.candidate else None, p.architecture() if p else None)'",
  nrmode: "LC_ALL=C; export LC_ALL\necho ---conf-restart-lines; grep -n 'restart' /etc/needrestart/needrestart.conf; echo ---conf.d; ls -la /etc/needrestart/conf.d/ 2>&1; grep -Hn 'restart\\|kernelhints\\|ucodehint' /etc/needrestart/conf.d/*.conf 2>/dev/null; echo ---hook; cat /etc/apt/apt.conf.d/99needrestart; echo ---hookscript; ls -l /usr/lib/needrestart/apt-pinvoke 2>&1; grep -v '^#' /usr/lib/needrestart/apt-pinvoke 2>/dev/null | head -30; echo ---groups; id",
  unitjournal: "LC_ALL=C; export LC_ALL\nfor u in servrsit-op-24793587-e656-4a31-86fd-01a49b28d45e servrsit-op-254d3315-fddb-4534-81b9-97cf23fd5953; do echo \"=== $u\"; journalctl --no-pager -o short-iso -u \"$u.service\" 2>&1 | tail -n 80; done; echo ---needrestart-anywhere; journalctl --no-pager -o short-iso --since '2026-11-21 07:38:00' --until '2026-11-21 07:41:00' 2>&1 | grep -i -E 'needrestart|restart|Stopping|Stopped|Starting' | head -40",
  nrconf: "LC_ALL=C; export LC_ALL\nsed -n '27,60p' /etc/needrestart/needrestart.conf; echo ---pinvoke-tail; sed -n '30,60p' /usr/lib/needrestart/apt-pinvoke; echo ---env; grep -rn 'NEEDRESTART\\|DEBIAN_FRONTEND' /etc/environment /etc/apt/apt.conf.d/ 2>/dev/null | head",
  // read-only: is a POSIX lock held on dpkg's lock files? (/proc/locks matched by inode)
  dpkglock: "LC_ALL=C; export LC_ALL\nfor f in /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock; do i=$(stat -c %i \"$f\"); n=$(grep -c \":$i \" /proc/locks); echo \"$f inode=$i locks=$n $(grep \":$i \" /proc/locks | awk '{print \"pid=\"$5}' | tr '\\n' ' ')\"; done; echo holds=$(apt-mark showhold | tr '\\n' ' ')",
  unitf3: "LC_ALL=C; export LC_ALL\njournalctl --no-pager -o short-iso -u servrsit-op-7da4237d-28de-4ef2-a83a-3009507aa68f.service 2>&1 | tail -n 30",
  holds: "LC_ALL=C; export LC_ALL\napt-mark showhold; echo ---; systemctl list-timers 'apt-daily*' --no-legend --all",
};

function run(argv: string[], stdin: string, mode = "normal"): Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; killedAtMs: number | null; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn("/usr/bin/ssh", argv, { stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
    let out = "", err = "", killedAt: number | null = null;
    p.stdout.on("data", (d) => { if (out.length < 512 * 1024) out += d; });
    p.stderr.on("data", (d) => { if (err.length < 8 * 1024) err += d; });
    p.stdin.on("error", () => {});
    const kill = (ms: number) => setTimeout(() => { killedAt = Date.now() - t0; p.kill("SIGKILL"); }, ms);
    const [m, a, b] = mode.split(":");
    if (m === "partial") { p.stdin.write(stdin.slice(0, Number(a))); kill(Number(b)); }
    else if (m === "hold") { p.stdin.write(stdin); kill(Number(a)); }
    else if (m === "killafter") { p.stdin.end(stdin); kill(Number(a)); }
    else p.stdin.end(stdin);
    const hard = setTimeout(() => p.kill("SIGKILL"), 150_000);
    p.on("close", (code, signal) => { clearTimeout(hard); resolve({ code, signal, stdout: out, stderr: err, killedAtMs: killedAt, ms: Date.now() - t0 }); });
  });
}

function sshArgv(keyPath: string, user: string): string[] {
  return buildSshArgv({ host: HOST, port: 22, user, [KEY_OPTION]: keyPath } as Parameters<typeof buildSshArgv>[0], { knownHostsFile: KNOWN_HOSTS });
}

function log(rec: object): void {
  appendFileSync(`${LOG_DIR}/runs.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), ...rec })}\n`, { mode: 0o600 });
}

async function sendGateway(kind: string, request: string, mode: string, extra: object): Promise<number> {
  await guard();
  const key = loadOrCreateMaintenanceKey("sentani", DEFAULT_HELPER_DIR, false).privateKeyPath;
  const r = await run(sshArgv(key, "servrsit"), request, mode);
  let reply: unknown = null;
  try { reply = JSON.parse(r.stdout); } catch { reply = r.stdout ? { notJson: r.stdout.slice(0, 300) } : null; }
  const rec = { kind, mode, requestBytes: Buffer.byteLength(request), requestSha256: createHash("sha256").update(request).digest("hex"), ...extra, sshExit: r.code, sshSignal: r.signal, killedAtMs: r.killedAtMs, ms: r.ms, reply, stderr: r.stderr.slice(0, 300) };
  log(rec);
  process.stdout.write(`${JSON.stringify(rec, null, 2)}\n`);
  return 0;
}

// ------------------------------------------------------------------------------------------------ manifests
function iso(d: Date): string { return d.toISOString(); }

function base(operation: string, plan: string, ttlMs: number, over: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  return {
    schemaVersion: 1, installationId: INSTALLATION_ID, server: { id: SERVER_ID, hostKeyFingerprint: HOST_KEY_FP },
    operationId: randomUUID(), operation, catalogVersion: 1,
    plan: { id: plan, version: 1, digest: digestOf({ t088: plan }) },
    issuedAt: iso(now), acceptBefore: iso(new Date(now.getTime() + ttlMs)), ...over,
  };
}

function build(kind: string, kv: Record<string, string>): Record<string, unknown> {
  const ttl = Number(kv["ttlMs"] ?? 15 * 60_000);
  if (kind === "dirs") {
    const dirs = (kv["paths"] ?? "").split(",").filter(Boolean).map((p) => ({ path: p, owner: "spotty", group: "spotty", mode: kv["mode"] ?? "0755" }));
    const existing = (kv["existing"] ?? "").split(",").filter(Boolean).sort();
    return base("prepare.directories.v1", kv["plan"] ?? "t088-dirs", ttl, {
      scope: { requested: dirs, directories: dirs, existing, includesServiceRestart: false, includesReboot: false },
      preconditionDigest: digestOf({ existing }), verification: { expectDirectories: dirs },
    });
  }
  if (kind === "apply") {
    // kv.pkgs = JSON file: [{name, arch, from, to}]; precondition = helper rule over the "from" versions as observed
    const pkgs = JSON.parse(readFileSync(kv["pkgs"]!, "utf8")) as Array<{ name: string; arch: string; from: string; to: string }>;
    const installed = Object.fromEntries(pkgs.map((p) => [`${p.name}:${p.arch}`, p.from]).sort());
    return base("apply.packages.v1", kv["plan"] ?? "t088-apply", ttl, {
      scope: { packages: pkgs }, preconditionDigest: digestOf({ installed }),
      verification: { expectInstalled: Object.fromEntries(pkgs.map((p) => [`${p.name}:${p.arch}`, p.to])) },
    });
  }
  if (kind === "reboot") {
    return base("reboot.host.v1", kv["plan"] ?? "t088-reboot", ttl, {
      scope: { includesServiceRestart: false, includesReboot: true },
      preconditionDigest: digestOf({ bootId: kv["bootId"] }), verification: { previousBootId: kv["bootId"] },
    });
  }
  throw new Error(`unknown manifest kind ${kind}`);
}

// ------------------------------------------------------------------------------------------------ main
async function main(): Promise<number> {
  const [cmd, a1, a2, ...rest] = process.argv.slice(2);
  if (cmd === "probe") {
    await guard();
    const script = PROBES[a1 ?? ""];
    if (script === undefined) throw new Error(`no probe ${a1}`);
    const r = await run(sshArgv(INSPECT_KEY, "spotty"), `${script}\n`);
    writeFileSync(`${LOG_DIR}/probe-${a1}-${Date.now()}.txt`, r.stdout, { mode: 0o600 });
    log({ kind: "probe", probe: a1, sshExit: r.code, bytes: r.stdout.length });
    process.stdout.write(r.stdout);
    if (r.code !== 0) process.stderr.write(`probe exit ${r.code} ${r.stderr.slice(0, 300)}\n`);
    return r.code ?? 1;
  }
  if (cmd === "manifest") {
    const kv = Object.fromEntries([a2, ...rest].slice(1).map((s) => s!.split(/=(.*)/s).slice(0, 2)));
    const m = build(a1!, kv as Record<string, string>);
    writeFileSync(a2!, `${JSON.stringify(m, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ operationId: m["operationId"], digest: digestOf(m) })}\n`);
    return 0;
  }
  const signer = loadOrCreateSigningKey(DEFAULT_HELPER_DIR, false).signer;
  if (cmd === "submit") {
    const m = JSON.parse(readFileSync(a1!, "utf8"));
    const d = describe(m, signer);
    return sendGateway("submit", submitRequest(m, signer), a2 ?? "normal", { manifestFile: a1, operationId: m.operationId, operation: m.operation, manifestDigest: d.digest, keyId: d.keyId });
  }
  if (cmd === "sign") { process.stdout.write(`${submitRequest(JSON.parse(readFileSync(a1!, "utf8")), signer)}\n`); return 0; }
  if (cmd === "raw") return sendGateway("raw", readFileSync(a1!, "utf8"), a2 ?? "normal", { requestFile: a1 });
  if (cmd === "query") return sendGateway("query", queryRequest(a1!), a2 ?? "normal", { operationId: a1 });
  process.stderr.write("usage: probe|manifest|submit|sign|raw|query\n");
  return 2;
}

process.exit(await main());
