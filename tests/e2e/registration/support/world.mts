/**
 * A fake network for the registration tests: scripted DNS, scripted SSH servers with real ed25519 host keys,
 * and a log of every connection the controller tries. Synthetic only. Nothing here opens a socket.
 * The reference model uses it directly; a real binding wires it into the product's resolver and transport seams.
 */
import { newEd25519, parseAuthorizedKeysLine, type FakeHostKey } from "./ssh.mts";

export type Behavior = "ok" | "auth-fail" | "unreachable" | "timeout" | "unprivileged" | "output-garbage" | "hostile-output";

export class ConnectError extends Error { constructor(public readonly code: "ROUTE_UNAVAILABLE" | "TIMEOUT") { super(code); } }

export class FakeTarget {
  hostKey: FakeHostKey = newEd25519();
  behavior: Behavior;
  private authorized = new Set<string>();   // public-key fingerprints the owner "installed"
  private conns = 0; private auths = 0; private cmds: string[] = []; private offered: string[] = [];
  constructor(readonly ip: string, readonly port: number, behavior: Behavior = "ok") { this.behavior = behavior; }
  get fingerprint(): string { return this.hostKey.fingerprint; }
  readonly algorithm = "ED25519" as const;
  connections(): number { return this.conns; } authAttempts(): number { return this.auths; }
  commands(): readonly string[] { return this.cmds; } offeredKeys(): readonly string[] { return this.offered; }
  setBehavior(b: Behavior): void { this.behavior = b; }
  changeHostKey(): string { this.hostKey = newEd25519(); return this.hostKey.fingerprint; }
  /** The owner pastes the line into authorized_keys. The fake honours `restrict` and `from=` like sshd would. */
  authorizeKey(line: string, controllerAddress: string): void {
    const p = parseAuthorizedKeysLine(line);
    const from = (p.options.find((o) => o.startsWith("from=")) ?? "").replace(/^from="|"$/g, "");
    if (from && !from.split(",").includes(controllerAddress)) return; // sshd would refuse a connection from elsewhere
    this.authorized.add(p.fingerprint);
  }
  // ---- called by the controller side
  _connect(): { hostKeyBlob: Buffer } { this.conns++; if (this.behavior === "unreachable") throw new ConnectError("ROUTE_UNAVAILABLE"); if (this.behavior === "timeout") throw new ConnectError("TIMEOUT"); return { hostKeyBlob: this.hostKey.blob }; }
  _auth(pubFingerprint: string): boolean { this.auths++; this.offered.push(pubFingerprint); return this.behavior !== "auth-fail" && this.authorized.has(pubFingerprint); }
  _exec(cmd: string): string { this.cmds.push(cmd); return this.behavior; }
}

export class World {
  private dnsTable = new Map<string, string[][]>(); private dnsCalls = new Map<string, number>();
  private targetsByEndpoint = new Map<string, FakeTarget>();
  private log: { ip: string; port: number }[] = []; private lookupLog: string[] = [];
  private nextIp = 10;
  controllerAddresses: string[] = ["100.64.0.2"];
  operatorAddresses: string[] = ["100.64.0.250"];
  enrolledRoutes: string[] = ["100.64.0.0/10"];

  addTarget(o: { address: string; port?: number; behavior?: Behavior; ip?: string }): FakeTarget {
    const port = o.port ?? 22; const isIp = /^[0-9.]+$/.test(o.address) || o.address.includes(":");
    const ip = o.ip ?? (isIp ? o.address : `100.64.1.${this.nextIp++}`);
    if (!isIp) this.dns(o.address, [ip]);
    const t = new FakeTarget(ip, port, o.behavior); this.targetsByEndpoint.set(`${ip}:${port}`, t); return t;
  }
  /** `answers` as an array of arrays gives successive answers (the last one repeats): DNS rebinding. */
  dns(name: string, answers: string[] | string[][]): void { this.dnsTable.set(name.toLowerCase().replace(/\.$/, ""), (Array.isArray(answers[0]) ? answers : [answers]) as string[][]); }
  /** Resolver seam. Records every lookup. */
  resolve(name: string): string[] {
    const key = name.toLowerCase().replace(/\.$/, ""); this.lookupLog.push(key);
    const seq = this.dnsTable.get(key); if (!seq) return [];
    const n = this.dnsCalls.get(key) ?? 0; this.dnsCalls.set(key, n + 1); return seq[Math.min(n, seq.length - 1)]!;
  }
  /** Transport seam. Records every attempt, even to addresses with no server. */
  connect(ip: string, port: number): { target: FakeTarget; hostKeyBlob: Buffer } {
    this.log.push({ ip, port });
    const t = this.targetsByEndpoint.get(`${ip}:${port}`); if (!t) throw new ConnectError("ROUTE_UNAVAILABLE");
    return { target: t, hostKeyBlob: t._connect().hostKeyBlob };
  }
  allConnections(): readonly { ip: string; port: number }[] { return this.log; }
  connectionsTo(ip: string): number { return this.log.filter((c) => c.ip === ip).length; }
  lookups(): readonly string[] { return this.lookupLog; }
  targetAt(ip: string, port = 22): FakeTarget | undefined { return this.targetsByEndpoint.get(`${ip}:${port}`); }
}
