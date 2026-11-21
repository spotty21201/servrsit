/**
 * T-089: one request to the target helper's gateway (ADR-021), over SSH with
 * the server's maintenance key. Moved here from the T-087 test-bench client
 * so the app's write target and the Tester's CLI send requests the same way.
 *
 * Same hardened argv as every ServrSit connection: strict host-key checking
 * against a pinned file (an unpinned host is never contacted), no agent, no
 * forwarding, bounded output. The key's forced command on the server ignores
 * the remote command line; the request travels on stdin as one JSON document,
 * so no variable input reaches a remote shell.
 */

import { buildSshArgv, pinStateFor } from "./transport.js";
import { spawnRunner, type CommandRunner } from "./runner.js";

export const MAX_GATEWAY_REPLY_BYTES = 256 * 1024;
export const GATEWAY_TIMEOUT_MS = 120_000;

export interface GatewayTarget {
  readonly host: string;
  readonly account: string;
  /** The maintenance key. Only passed to `ssh -i`; never opened here. */
  readonly identityFile: string;
  readonly knownHostsFile: string;
}

export type GatewayReply =
  | { readonly ok: true; readonly reply: unknown }
  | {
      readonly ok: false;
      /**
       * HOST_NOT_PINNED: nothing was sent. The others: the request may or may
       * not have reached the helper; the caller must treat that as unknown.
       */
      readonly reason: "HOST_NOT_PINNED" | "TRANSPORT_FAILED" | "TIMEOUT" | "REPLY_NOT_JSON";
      readonly exitCode: number | null;
    };

export async function sendGatewayRequest(request: string, target: GatewayTarget, runner: CommandRunner = spawnRunner): Promise<GatewayReply> {
  if ((await pinStateFor(target.knownHostsFile, target.host, 22)) !== "pinned") return { ok: false, reason: "HOST_NOT_PINNED", exitCode: null };
  const argv = buildSshArgv({ host: target.host, port: 22, user: target.account, identityFile: target.identityFile }, { knownHostsFile: target.knownHostsFile });
  const r = await runner({ file: "/usr/bin/ssh", args: argv, stdin: request, timeoutMs: GATEWAY_TIMEOUT_MS, maxStdoutBytes: MAX_GATEWAY_REPLY_BYTES, maxStderrBytes: 8 * 1024 });
  if (r.timedOut) return { ok: false, reason: "TIMEOUT", exitCode: null };
  if (r.spawnFailed || r.exitCode === 255) return { ok: false, reason: "TRANSPORT_FAILED", exitCode: r.exitCode };
  if (r.stdoutTruncated) return { ok: false, reason: "REPLY_NOT_JSON", exitCode: r.exitCode };
  try {
    return { ok: true, reply: JSON.parse(r.stdout) as unknown };
  } catch {
    return { ok: false, reason: "REPLY_NOT_JSON", exitCode: r.exitCode };
  }
}
