/**
 * T-087: the test-bench client for the target helper on Sentani (ADR-021).
 * Used ONLY by the Tester's CLI (tests/live/helper-cli). The app's write
 * target (T-089) sends through the same packages/ssh gateway function, and
 * only where the controller's writes.json enables Sentani.
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
import { SqliteServerStore, type StoredServer } from "@servrsit/store";
import { canonicalJson, digestOf, signManifest, type Manifest, type Signer } from "@servrsit/domain";
import { MAX_GATEWAY_REPLY_BYTES, sendGatewayRequest, spawnRunner, type CommandRunner, type GatewayReply, type GatewayTarget } from "@servrsit/ssh";

export type { GatewayTarget } from "@servrsit/ssh";
export const MAX_REPLY_BYTES = MAX_GATEWAY_REPLY_BYTES;
export type Reply = GatewayReply;

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

/** T-089: the same send the app's write target uses (packages/ssh gateway.ts). */
export async function send(request: string, target: GatewayTarget, runner: CommandRunner = spawnRunner): Promise<Reply> {
  return sendGatewayRequest(request, target, runner);
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
    return gatewayTargetFromRegistry(name, store.listActive(), account, identityFile, overrideHost);
  } finally {
    store.close();
  }
}

/**
 * T-089: the same checks on rows already read from the registry (the app's
 * write target uses this with its open registry). Same refusals as benchTarget.
 */
export function gatewayTargetFromRegistry(name: string, active: readonly StoredServer[], account: string, identityFile: string, overrideHost?: string): GatewayTarget {
  const key = name.toLowerCase();
  if (PROTECTED_SERVERS.has(key)) throw new BenchRefused(`${name} is protected: the test bench never contacts it`);
  if (!BENCH_SERVERS.has(key)) throw new BenchRefused(`${name} is not a test-bench server (only Sentani, ADR-021)`);
  const rows = active.filter((s) => s.name.toLowerCase() === key);
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
  if (!existsSync(kh)) throw new BenchRefused(`${name}'s known_hosts file is missing`);
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
}
