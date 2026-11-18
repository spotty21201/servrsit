/**
 * Binding of the registration contract (support/contract.mts) to T-069, run on a trial merge with T-053/T-066.
 *
 * Production paths kept: buildServer, the real auth guard and session (enrolOwner), the real AddressPolicy,
 * ServerRegistry, routes and SQLite store, the REAL key vault (local `ssh-keygen` into a temp dir), and the
 * product's own collector `collectViaSsh` with its real ssh argv, pinned known_hosts file and fixed script.
 *
 * Replaced, and nothing else: the host-key scanner, the TCP probe, the DNS resolver, the controller's own
 * addresses, and the ssh SUBPROCESS (a fake `ssh` that behaves like OpenSSH against the fake network: it
 * resolves the host name itself, honours StrictHostKeyChecking against the given known_hosts file, offers
 * only the -i key, and answers with the product's nonce). The fleet service gets the same collector.
 * The config is synthetic and lists NO real host, so the four real servers are never in this registry.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../../../../apps/api/src/server.ts";
import { enrolOwner, setupTokenSink, type SignedInOwner } from "../../../../apps/api/src/auth/testing.ts";
import { createKeyVault, type HostKeyScanner, type KeyVault } from "../../../../apps/api/src/servers/ssh-tools.ts";
import { FleetService } from "../../../../apps/api/src/fleet/service.ts";
import { collectViaSsh, TargetRejectedError, buildCollectorScript, probePrivilegeViaSsh, buildPrivilegeScript } from "../../../../packages/ssh/src/index.ts";
import { NORMAL, DEGRADED, MALICIOUS, renderOutput } from "../../../../packages/ssh/src/collector.fixtures.ts";
import { SqliteAuthStore, SqliteServerStore } from "../../../../packages/store/src/index.ts";
import { AddressPolicy } from "../../../../apps/api/src/servers/address.ts";
import { fingerprintOfBlob } from "./ssh.mts";
import { ConnectError, World, type FakeTarget } from "./world.mts";
import type { CallInput, Capability, RegHarness, Res, ServerRow } from "./contract.mts";

const ORIGIN = "http://127.0.0.1:5173";
type App = Awaited<ReturnType<typeof buildServer>>;
type RunReq = { file: string; args: readonly string[]; stdin: string };


export class RegBinding implements RegHarness {
  readonly name = "T-069 (trial merge with owner-auth)";
  readonly world = new World();
  private t = Date.parse("2026-02-10T03:00:00Z");
  private dir = mkdtempSync(join(tmpdir(), "tester-reg-"));
  private keysDir = join(this.dir, "keys");
  private dbPath = join(this.dir, "servers.db");
  private store = new SqliteServerStore({ path: this.dbPath });
  private authStore = new SqliteAuthStore({ path: ":memory:" });
  private sink = setupTokenSink();
  private owner!: SignedInOwner;
  private app!: App;
  private service!: FleetService;
  private vault: KeyVault = createKeyVault(this.keysDir);
  private lines: string[] = [];
  private argv: string[][] = [];
  private collections = new Map<string, number>();
  private routes = ["100.64.0.0/10"];
  /** Scripts the product sent: compared with its own fixed collector script for the same nonce. */
  private scripts: string[] = [];

  static async create(): Promise<RegBinding> { const b = new RegBinding(); await b.build(); return b; }
  now(): number { return this.t; }
  async advance(ms: number): Promise<void> { this.t += ms; }
  has(c: Capability): boolean { return c !== "care"; }
  logText(): string { return this.lines.join(""); }
  argvLog(): string[][] { return this.argv; }

  // ------------------------------------------------------------------------------- fakes
  private resolveAll(host: string): string[] { return /^[0-9.]+$/.test(host) || host.includes(":") ? [host] : this.world.resolve(host); }
  private scanner: HostKeyScanner = async (address, port) => {
    const ips = this.resolveAll(address); // ssh-keyscan resolves the name itself
    if (ips.length === 0) return { ok: false, code: "ROUTE_UNAVAILABLE" };
    try {
      const { target } = this.world.connect(ips[0]!, port);
      const blob = target.hostKey.blob;
      return { ok: true, key: { algorithm: "ED25519", keyType: "ssh-ed25519", keyBase64: blob.toString("base64"), fingerprint: fingerprintOfBlob(blob) } as never };
    } catch (e) { return { ok: false, code: e instanceof ConnectError && e.code === "TIMEOUT" ? "TIMEOUT" : "ROUTE_UNAVAILABLE" }; }
  };
  private probe = async (address: string, port: number): Promise<boolean> => {
    const ips = this.resolveAll(address); if (ips.length === 0) return false;
    try { this.world.connect(ips[0]!, port); return true; } catch { return false; }
  };
  /** A fake `ssh` that behaves like OpenSSH for the options the product passes. */
  private runner = async (req: RunReq) => {
    const args = [...req.args]; this.argv.push([req.file, ...args]);
    const res = (exitCode: number | null, stdout: string, stderr: string, timedOut = false) => ({ exitCode, stdout, stderr, timedOut, stdoutTruncated: false, spawnFailed: false });
    const opt = (name: string) => { for (let i = 0; i < args.length - 1; i++) if (args[i] === "-o" && args[i + 1]!.startsWith(name + "=")) return args[i + 1]!.slice(name.length + 1); return null; };
    if (opt("StrictHostKeyChecking") !== "yes" || opt("BatchMode") !== "yes") return res(255, "", "fake ssh: refusing to run without strict host checking and batch mode");
    const dash = args.indexOf("--"); const host = args[dash + 1]!; const port = Number(args[args.indexOf("-p") + 1]); const idFile = args.includes("-i") ? args[args.indexOf("-i") + 1]! : null;
    const ips = this.resolveAll(host); if (ips.length === 0) return res(255, "", `ssh: Could not resolve hostname ${host}: Name or service not known`);
    let target: FakeTarget;
    try { target = this.world.connect(ips[0]!, port).target; } catch (e) { return e instanceof ConnectError && e.code === "TIMEOUT" ? res(null, "", "", true) : res(255, "", `ssh: connect to host ${host} port ${port}: No route to host`); }
    this.collections.set(`${host}:${port}`, (this.collections.get(`${host}:${port}`) ?? 0) + 1);
    // StrictHostKeyChecking=yes against exactly the given file
    const khFile = opt("UserKnownHostsFile"); const kh = khFile && existsSync(khFile) ? readFileSync(khFile, "utf8") : "";
    const names = new Set([host, `[${host}]:${port}`]);
    const pinned = kh.split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3 && p[0]!.split(",").some((n) => names.has(n)));
    if (pinned.length === 0) return res(255, "", "Host key verification failed.");
    if (!pinned.some((p) => p[2] === target.hostKey.blob.toString("base64"))) return res(255, "", "@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed.");
    // offer only the -i key (IdentitiesOnly=yes)
    if (!idFile || opt("IdentitiesOnly") !== "yes") return res(255, "", "Permission denied (publickey).");
    let pubFp = "";
    try { const pub = readFileSync(`${idFile}.pub`, "utf8").trim().split(/\s+/); pubFp = fingerprintOfBlob(Buffer.from(pub[1] ?? "", "base64")); } catch { return res(255, "", "Permission denied (publickey)."); }
    if (!target._auth(pubFp)) return res(255, "", "Permission denied (publickey).");
    const nonce = /[0-9a-f]{32}/.exec(req.stdin)?.[0] ?? "";
    // T-081: the disclosed privilege check is a second fixed script (sudo -n -l: non-interactive LIST of rules, runs nothing)
    let priv = ""; try { priv = buildPrivilegeScript(nonce); } catch { priv = "(invalid nonce)"; }
    if (req.stdin === priv) {
      this.scripts.push("FIXED_PRIVILEGE_SCRIPT"); target._exec("FIXED_PRIVILEGE_SCRIPT");
      return res(0, `@@BEGIN ${nonce} sudorules@@\n\n@@END ${nonce} sudorules 127@@\n`, ""); // no sudo installed on the fake server
    }
    let expected = ""; try { expected = buildCollectorScript(nonce); } catch { expected = "(invalid nonce)"; }
    const exact = req.stdin === expected; this.scripts.push(exact ? "FIXED_COLLECTOR_SCRIPT" : req.stdin);
    target._exec(exact ? "FIXED_COLLECTOR_SCRIPT" : req.stdin);
    switch (target.behavior) {
      case "auth-fail": return res(255, "", "Permission denied (publickey).");
      case "output-garbage": return res(0, "garbage without any sections\n", "");
      case "unprivileged": return res(0, renderOutput(DEGRADED, nonce), "");
      case "hostile-output": return res(0, renderOutput(MALICIOUS, nonce), "");
      default: return res(0, renderOutput(NORMAL, nonce), "");
    }
  };
  private policyFor(): AddressPolicy { return new AddressPolicy(this.registration(), { resolver: async (h) => this.world.resolve(h), selfAddresses: () => this.world.controllerAddresses }); }
  /** The product's own default collector (registry.ts), with only the subprocess runner replaced. */
  private collector = (policy: AddressPolicy) => (t: { host: string; port: number; user: string; identityFile: string; knownHostsFile: string }) =>
    collectViaSsh({ host: t.host, port: t.port, user: t.user, identityFile: t.identityFile }, { knownHostsFile: t.knownHostsFile, allowedPorts: policy.allowedPorts },
      { runner: this.runner as never, now: () => new Date(this.t), checkResolution: async (host) => { const c = await policy.check(host, t.port); if (!c.ok) throw new TargetRejectedError(c.reason); } });

  /** The product's own default privilege probe (registry.ts), with only the subprocess runner replaced. */
  private privilegeProbe = (policy: AddressPolicy) => (t: { host: string; port: number; user: string; identityFile: string; knownHostsFile: string }) =>
    probePrivilegeViaSsh({ host: t.host, port: t.port, user: t.user, identityFile: t.identityFile }, { knownHostsFile: t.knownHostsFile, allowedPorts: policy.allowedPorts },
      { runner: this.runner as never, checkResolution: async (host: string) => { const c = await policy.check(host, t.port); if (!c.ok) throw new TargetRejectedError(c.reason); } });

  private registration() { return { controllerAddress: this.world.controllerAddresses[0]!, allowedPorts: [22], enrolledRoutes: this.routes, allowPublicAddresses: false, operatorAddresses: this.world.operatorAddresses }; }

  private async build(): Promise<void> {
    const config = { healthIntervalMinutes: 15, ownerTimeZone: "Asia/Jakarta", hosts: [], registration: this.registration() };
    const policy = this.policyFor();
    const coll = this.collector(policy);
    // The fleet service the product would build, with the same collector. Hosts come from the registry store.
    this.service = new FleetService({
      config: config as never, knownHostsFile: join(this.dir, "shared_known_hosts"), now: () => new Date(this.t),
      hosts: () => this.store.listActive().filter((s) => s.access === "ssh").map((s) => ({ id: s.id, name: s.name, role: s.role, production: s.production, importantServices: [...s.importantServices], collect: s.collect, writesEnabled: false as const, access: "ssh" as const, address: s.address!, port: s.port!, user: s.user!, ...(s.identityFile ? { identityFile: s.identityFile } : {}), ...(s.knownHostsFile ? { knownHostsFile: s.knownHostsFile } : {}) })) as never,
      collector: (host: any) => coll({ host: host.address, port: host.port, user: host.user, identityFile: host.identityFile, knownHostsFile: host.knownHostsFile }) as never,
    } as never);
    this.app = await buildServer({
      config: config as never, mode: "live", startChecks: false, ownerContextPath: null, fleetService: this.service,
      logStream: { write: (m: string) => { this.lines.push(m); } },
      auth: { store: this.authStore, onSetupToken: this.sink.onSetupToken }, // real clock: advancing registry time (24 h draft expiry) must not end the owner's 8 h session
      servers: { store: this.store, vault: this.vault, scanner: this.scanner, probe: this.probe, collector: coll as never, privilegeProbe: this.privilegeProbe(policy) as never, resolver: async (h: string) => this.world.resolve(h), selfAddresses: () => this.world.controllerAddresses, now: () => new Date(this.t) },
    } as never);
    if (!this.owner) this.owner = await enrolOwner(this.app as never, this.sink.token());
  }
  async setEnrolledRoutes(cidrs: string[]): Promise<void> { this.routes = cidrs; await this.app.close(); await this.build(); }
  async close(): Promise<void> { await this.app.close(); this.store.close(); rmSync(this.dir, { recursive: true, force: true }); }

  // ------------------------------------------------------------------------------- API
  async api(c: CallInput): Promise<Res> {
    const headers: Record<string, string> = {};
    if (c.session !== "none") headers["cookie"] = this.owner.cookie;
    if (c.method !== "GET") {
      headers["origin"] = c.origin ?? ORIGIN;
      const csrf = c.csrf ?? "valid";
      if (c.session !== "none" && csrf !== "omit") headers["x-csrf-token"] = csrf === "wrong" ? this.owner.csrfToken.slice(0, -1) + (this.owner.csrfToken.endsWith("A") ? "B" : "A") : this.owner.csrfToken;
    } else if (c.origin) headers["origin"] = c.origin;
    const r = await this.app.inject({ method: c.method, url: c.path, headers: { ...(c.body === undefined ? {} : { "content-type": "application/json" }), ...headers }, ...(c.body === undefined ? {} : { payload: JSON.stringify(c.body) }) });
    let data: any = undefined; try { data = r.body ? JSON.parse(r.body) : undefined; } catch { data = undefined; }
    const hdrs: Record<string, string> = {}; for (const [k, v] of Object.entries(r.headers)) hdrs[k] = String(v);
    return { ok: r.statusCode < 300, status: r.statusCode, code: typeof data?.error === "string" ? data.error : undefined, reason: typeof data?.reason === "string" ? data.reason : undefined, data, raw: r.body, headers: hdrs };
  }

  // ------------------------------------------------------------------------------- fixtures and observation
  async seedServer(o: { name: string; address: string; port?: number; production?: boolean }): Promise<{ id: string; target: FakeTarget }> {
    const isName = !/^[0-9.]+$/.test(o.address);
    const target = this.world.addTarget({ address: o.address, ...(o.port ? { port: o.port } : {}) });
    const d = await this.api({ method: "POST", path: "/api/servers/drafts", body: { address: o.address, port: o.port ?? 22, user: "servrsit", name: o.name, role: null, production: o.production ?? false } });
    if (d.status !== 201) throw new Error(`seed draft ${d.status} ${d.code} ${d.reason ?? ""}`);
    const id = d.data.id; const P = `/api/servers/drafts/${id}`;
    for (const [w, body] of [["host-key", undefined], ["host-key/confirm", { fingerprint: target.fingerprint }]] as const) { const r = await this.api({ method: "POST", path: `${P}/${w}`, ...(body ? { body } : {}) }); if (r.status !== 200) throw new Error(`seed ${w} ${r.status} ${r.code}`); }
    const k = await this.api({ method: "POST", path: `${P}/access-key` }); if (k.status !== 200) throw new Error(`seed key ${k.status} ${k.code}`);
    target.authorizeKey(k.data.accessKey.authorizedKeysLine, k.data.accessKey.controllerAddress);
    await this.api({ method: "POST", path: `${P}/first-check` });
    for (let i = 0; i < 40; i++) { const f = await this.api({ method: "GET", path: `${P}/first-check` }); if (f.data?.finished) break; await this.advance(500); await new Promise((r) => setTimeout(r, 25)); }
    const a = await this.api({ method: "POST", path: `${P}/activate` }); if (a.status !== 201) throw new Error(`seed activate ${a.status} ${a.code} ${a.reason ?? ""}`);
    void isName; return { id: a.data.serverId, target };
  }
  private rows(): any[] { const db = new DatabaseSync(this.dbPath, { readOnly: true }); try { return db.prepare("SELECT id FROM servers").all() as any[]; } finally { db.close(); } }
  async servers(): Promise<ServerRow[]> {
    return this.rows().map((r) => this.store.get(String(r.id))!).filter((s) => s.source === "registration").map((s) => ({ id: s.id, name: s.name, address: s.address ?? "", port: s.port ?? 0, production: s.production, writesEnabled: s.writesEnabled, status: s.disconnectedAt ? "disconnected" : "active" }));
  }
  async draftCount(): Promise<number> { const db = new DatabaseSync(this.dbPath, { readOnly: true }); try { return Number((db.prepare("SELECT count(*) AS n FROM server_drafts").get() as any).n); } finally { db.close(); } }
  allowedCommands(): readonly string[] { return ["FIXED_COLLECTOR_SCRIPT", "FIXED_PRIVILEGE_SCRIPT"]; }
  private keyFiles(): string[] {
    const out: string[] = []; const walk = (d: string) => { if (!existsSync(d)) return; for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out.push(p); } };
    walk(this.keysDir); return out;
  }
  keys = {
    privateKeyNeedles: (): string[] => this.keyFiles().filter((f) => !f.endsWith(".pub") && /PRIVATE KEY/.test(readFileSync(f, "utf8"))).flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => l.length >= 16 && !l.startsWith("-----"))),
    storedKeyCount: (): number => this.keyFiles().filter((f) => !f.endsWith(".pub") && /PRIVATE KEY/.test(readFileSync(f, "utf8"))).length,
    fileModes: (): number[] => this.keyFiles().filter((f) => !f.endsWith(".pub")).map((f) => statSync(f).mode & 0o777),
  };
  scheduler = {
    tick: async (): Promise<void> => { await (this.service as any).refreshAll(); },
    collectionsFor: (serverId: string): number => { const s = this.store.get(serverId); return s ? (this.collections.get(`${s.address}:${s.port}`) ?? 0) : 0; },
  };
  async hostKeyEvidence(serverId: string) { const s = this.store.get(serverId); return s?.hostKey ? { fingerprint: s.hostKey.fingerprint, algorithm: s.hostKey.algorithm, confirmedBy: s.hostKey.confirmedBy, confirmedAt: s.hostKey.confirmedAt } : null; }
  care = {
    queueOperation: async (): Promise<{ opId: string }> => { throw new Error("NOT BOUND: registered servers are real-ssh servers with writes off; no operation can be created for them"); },
    runningOperation: async (): Promise<{ opId: string }> => { throw new Error("NOT BOUND"); },
    operation: async (): Promise<{ state: string; sentToTarget: boolean }> => { throw new Error("NOT BOUND"); },
  };
  aliasOf(existing: { id: string; target: FakeTarget }, address: string): FakeTarget {
    const t = this.world.addTarget({ address }); t.hostKey = existing.target.hostKey; return t;
  }
  scriptsSeen(): readonly string[] { return this.scripts; }
  /** An IMPORTED server (as hosts.json entries become), using a stand-in for the owner's own key file in a temp dir. */
  seedImported(name: string, address: string): { id: string; identityFile: string } {
    const identityFile = join(this.dir, "owner-own-key-standin"); writeFileSync(identityFile, "STAND-IN for the owner's own private key: not a real key\n", { mode: 0o600 });
    const id = "33333333-3333-4333-a333-" + String(Math.floor(this.t / 1000) % 1e12).padStart(12, "0");
    const r = this.store.register({ id, source: "import", access: "ssh", name, role: null, production: true, productionStatus: "yes", address, port: 22, user: "owner", identityFile, knownHostsFile: null, importantServices: [], collect: true, collectDisabledReason: null, hostKey: null, accessKey: null, createdAt: new Date(this.t).toISOString() } as never, "import", "import", new Date(this.t));
    if (!(r as any).ok) throw new Error(`seedImported: ${JSON.stringify(r)}`);
    return { id, identityFile };
  }
}
