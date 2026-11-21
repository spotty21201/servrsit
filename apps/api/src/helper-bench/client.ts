/**
 * T-087: the test-bench client for the target helper on Sentani (ADR-021).
 * Used ONLY by the Tester's CLI (tests/live/helper-cli). The app does not
 * use it: SshWriteTarget still refuses every write, and writesEnabled is
 * unchanged.
 *
 * It signs a manifest with the controller's persistent key and sends one
 * request to the helper's gateway over SSH with Sentani's maintenance key:
 * the same hardened argv as every ServrSit connection, strict host-key
 * checking against a pinned file (an unpinned host is never contacted), and
 * bounded output. The forced command on the server ignores the remote
 * command; the request travels on stdin.
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { SqliteServerStore } from "@servrsit/store";
import { canonicalJson, digestOf, signManifest, type Manifest, type Signer } from "@servrsit/domain";
import { buildSshArgv, pinStateFor, spawnRunner, type CommandRunner } from "@servrsit/ssh";

export const MAX_REPLY_BYTES = 256 * 1024;

export interface GatewayTarget {
  readonly host: string;
  readonly account: string;
  readonly identityFile: string;
  readonly knownHostsFile: string;
}

export type Reply =
  | { readonly ok: true; readonly reply: unknown }
  | { readonly ok: false; readonly reason: "HOST_NOT_PINNED" | "TRANSPORT_FAILED" | "TIMEOUT" | "REPLY_NOT_JSON"; readonly exitCode: number | null };

/** The signed submit request exactly as the helper expects it. */
export function submitRequest(manifest: Manifest, signer: Signer): string {
  return JSON.stringify({ version: 1, op: "submit", signed: signManifest(manifest, signer) });
}

export function queryRequest(operationId: string): string {
  return JSON.stringify({ version: 1, op: "query.operation.v1", operationId });
}

/** Facts for the Tester's record; never contains a private key. */
export function describe(manifest: Manifest, signer: Signer) {
  return { keyId: signer.keyId, digest: digestOf(manifest), canonicalBytes: Buffer.byteLength(canonicalJson(manifest), "utf8") };
}

export async function send(request: string, target: GatewayTarget, runner: CommandRunner = spawnRunner): Promise<Reply> {
  if ((await pinStateFor(target.knownHostsFile, target.host, 22)) !== "pinned") return { ok: false, reason: "HOST_NOT_PINNED", exitCode: null };
  const argv = buildSshArgv({ host: target.host, port: 22, user: target.account, identityFile: target.identityFile }, { knownHostsFile: target.knownHostsFile });
  const r = await runner({ file: "/usr/bin/ssh", args: argv, stdin: request, timeoutMs: 120_000, maxStdoutBytes: MAX_REPLY_BYTES, maxStderrBytes: 8 * 1024 });
  if (r.timedOut) return { ok: false, reason: "TIMEOUT", exitCode: null };
  if (r.spawnFailed || r.exitCode === 255) return { ok: false, reason: "TRANSPORT_FAILED", exitCode: r.exitCode };
  try {
    return { ok: true, reply: JSON.parse(r.stdout) as unknown };
  } catch {
    return { ok: false, reason: "REPLY_NOT_JSON", exitCode: r.exitCode };
  }
}

/** ADR-021/ADR-022: the only server the test bench may contact. */
export const BENCH_SERVERS: ReadonlySet<string> = new Set(["sentani"]);
/** Never contacted by the test bench, whatever is configured. */
export const PROTECTED_SERVERS: ReadonlySet<string> = new Set(["nabire", "timika", "merauke"]);

export class BenchRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BenchRefused";
  }
}

function hostPattern(host: string): string {
  return host.toLowerCase();
}

/**
 * T-088 fix: the address and pinned known_hosts file of ONE named server,
 * taken from its registry row (the per-server file registration wrote after
 * the owner confirmed the fingerprint), never the shared known_hosts.
 *
 * Refused: any name other than Sentani; Nabire, Timika and Merauke outright;
 * a row without its own known_hosts file (an imported row uses the shared
 * file, which pins other servers); a file that is a symlink, missing, or
 * pins any host other than this server's address; an override address that
 * differs from the registry's.
 */
export function benchTarget(name: string, registryPath: string, account: string, identityFile: string, overrideHost?: string): GatewayTarget {
  const key = name.toLowerCase();
  if (PROTECTED_SERVERS.has(key)) throw new BenchRefused(`${name} is protected: the test bench never contacts it`);
  if (!BENCH_SERVERS.has(key)) throw new BenchRefused(`${name} is not a test-bench server (only Sentani, ADR-021)`);
  if (!existsSync(registryPath)) throw new BenchRefused("the server registry does not exist");
  const store = new SqliteServerStore({ path: registryPath });
  try {
    const rows = store.listActive().filter((s) => s.name.toLowerCase() === key);
    if (rows.length !== 1) throw new BenchRefused(`expected exactly one connected server named ${name} in the registry, found ${rows.length}`);
    const row = rows[0]!;
    if (row.access !== "ssh" || row.address === null || row.port !== 22) throw new BenchRefused(`${name} is not an SSH server on port 22 in the registry`);
    if (row.knownHostsFile === null) {
      throw new BenchRefused(`${name} has no own pinned known_hosts file in the registry (re-register it so the new host key is confirmed)`);
    }
    if (overrideHost !== undefined && overrideHost.toLowerCase() !== row.address.toLowerCase()) {
      throw new BenchRefused(`the address given is not ${name}'s registered address`);
    }
    const kh = row.knownHostsFile;
    const st = lstatSync(kh);
    if (st.isSymbolicLink() || !st.isFile()) throw new BenchRefused(`${name}'s known_hosts file is not a plain file`);
    const lines = readFileSync(kh, "utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
    if (lines.length === 0) throw new BenchRefused(`${name}'s known_hosts file pins nothing`);
    for (const line of lines) {
      const pattern = (line.split(/\s+/)[0] ?? "").toLowerCase();
      if (pattern.startsWith("@") || pattern.startsWith("|") || pattern.split(",").some((p) => p !== hostPattern(row.address!))) {
        throw new BenchRefused(`${name}'s known_hosts file pins something other than ${name}`);
      }
    }
    if (isIP(row.address) === 0 && !/^[a-z0-9.-]+$/i.test(row.address)) throw new BenchRefused("the registered address is not valid");
    return { host: row.address, account, identityFile, knownHostsFile: kh };
  } finally {
    store.close();
  }
}
