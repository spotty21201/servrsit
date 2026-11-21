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

import { readFileSync } from "node:fs";
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

/** The address of a server by its display name in hosts.json (the pinned known_hosts uses it). */
export function addressOf(name: string, hostsJsonPath: string): string {
  const cfg = JSON.parse(readFileSync(hostsJsonPath, "utf8")) as { hosts: Array<{ name: string; access: string; address?: string }> };
  const h = cfg.hosts.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (h === undefined || h.access !== "ssh" || h.address === undefined) throw new Error(`no ssh host named ${name} in hosts.json`);
  return h.address;
}
