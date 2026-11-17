/**
 * SSH transport: argument construction, target validation, host-key pinning.
 *
 * Technical Spec §6.2-6.4 and the execution-security steering rules:
 *  - OpenSSH client via an argument array, never a local shell string
 *  - user and system ssh config ignored (-F /dev/null)
 *  - strict host checking against a per-installation pinned known_hosts file
 *  - batch mode, bounded connect timeout, no TTY, no agent/port forwarding
 *  - the remote command is fixed; variable data never reaches it
 *
 * Key files are only ever named on the command line (-i). They are never
 * opened, read, or logged by this code.
 */

import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { homedir } from "node:os";
import { REMOTE_COMMAND } from "./script.js";

export interface SshTarget {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  /** Path to a private key file. Only passed to `ssh -i`; never opened here. */
  readonly identityFile?: string | undefined;
}

export interface SshOptions {
  readonly knownHostsFile: string;
  /** Ports the product may connect to. Technical Spec §6.2: reject unapproved ports. */
  readonly allowedPorts?: readonly number[] | undefined;
}

export const CONNECT_TIMEOUT_SECONDS = 10;
export const DEFAULT_ALLOWED_PORTS: readonly number[] = [22];

export class TargetRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TargetRejectedError";
  }
}

const HOST_LABELS = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const USER_NAME = /^[a-z_][a-z0-9_-]{0,31}$/;
const SAFE_PATH = /^[A-Za-z0-9._/@+-]+$/;

/** True for addresses Technical Spec §6.2 says must never be contacted. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === undefined || b === undefined) return true;
    return (
      a === 0 || a === 127 || (a === 169 && b === 254) || a >= 224
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    return (
      lower === "::" ||
      lower === "::1" ||
      /^fe[89ab][0-9a-f]:/.test(lower) ||
      (lower.startsWith("::ffff:") && isBlockedAddress(lower.slice(7)))
    );
  }
  return false;
}

/** Reject malformed or dangerous targets before anything is run or resolved. */
export function validateTarget(target: SshTarget, options: SshOptions): void {
  const { host, port, user } = target;
  if (host.length === 0 || host.length > 253) throw new TargetRejectedError("invalid host length");
  if (host.startsWith("-")) throw new TargetRejectedError("host may not start with '-'");
  if (host.toLowerCase() === "localhost") throw new TargetRejectedError("loopback host not allowed");
  const family = isIP(host);
  if (family === 0 && !HOST_LABELS.test(host)) throw new TargetRejectedError("malformed host");
  if (family !== 0 && isBlockedAddress(host)) throw new TargetRejectedError("address not allowed");
  const allowed = options.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  if (!Number.isInteger(port) || !allowed.includes(port)) {
    throw new TargetRejectedError("port not approved");
  }
  if (!USER_NAME.test(user)) throw new TargetRejectedError("malformed user");
  if (!SAFE_PATH.test(options.knownHostsFile)) {
    throw new TargetRejectedError("known_hosts path contains unsupported characters");
  }
  if (target.identityFile !== undefined && !SAFE_PATH.test(expandHome(target.identityFile))) {
    throw new TargetRejectedError("identity path contains unsupported characters");
  }
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? `${homedir()}${path.slice(1)}` : path;
}

/**
 * Resolve a name and refuse blocked results (loopback, link-local, metadata).
 * Limitation: ssh performs its own resolution afterwards, so this narrows but
 * does not close the rebinding window. The pinned host key is the backstop: a
 * rebound address would fail strict host-key checking.
 */
export async function assertResolvesToAllowedAddress(host: string): Promise<void> {
  if (isIP(host) !== 0) return;
  const results = await lookup(host, { all: true });
  if (results.length === 0) throw new TargetRejectedError("host did not resolve");
  for (const r of results) {
    if (isBlockedAddress(r.address)) throw new TargetRejectedError("host resolves to a blocked address");
  }
}

/** The complete ssh argument vector. Contains no secrets and no shell string. */
export function buildSshArgv(target: SshTarget, options: SshOptions): string[] {
  validateTarget(target, options);
  const argv: string[] = [
    "-F", "/dev/null",
    "-T",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${options.knownHostsFile}`,
    "-o", "GlobalKnownHostsFile=/dev/null",
    "-o", "VerifyHostKeyDNS=no",
    "-o", "CheckHostIP=no",
    "-o", "UpdateHostKeys=no",
    "-o", `ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`,
    "-o", "ServerAliveInterval=5",
    "-o", "ServerAliveCountMax=3",
    "-o", "ForwardAgent=no",
    "-o", "ForwardX11=no",
    "-o", "ClearAllForwardings=yes",
    "-o", "PermitLocalCommand=no",
    "-o", "ProxyCommand=none",
    "-o", "ProxyJump=none",
    "-o", "ControlMaster=no",
    "-o", "ControlPath=none",
    "-o", "IdentityAgent=none",
    "-o", "PasswordAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no",
    "-o", "NumberOfPasswordPrompts=0",
    "-o", "LogLevel=ERROR",
  ];
  if (target.identityFile !== undefined) {
    argv.push("-o", "IdentitiesOnly=yes", "-i", expandHome(target.identityFile));
  }
  argv.push("-p", String(target.port), "-l", target.user, "--", target.host, ...REMOTE_COMMAND);
  return argv;
}

// ---------------------------------------------------------------------------
// Host-key pinning
// ---------------------------------------------------------------------------

export type PinState = "pinned" | "not-pinned" | "revoked";

function hostPattern(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

/**
 * Check, without contacting the host, whether the pinned known_hosts file has
 * an entry for it. A missing file means nothing is pinned. Hashed entries are
 * not recognised: the pinned file is written by this product in plain form.
 * Only public host-key lines are read.
 */
export async function pinStateFor(
  knownHostsFile: string,
  host: string,
  port: number,
): Promise<PinState> {
  let content: string;
  try {
    content = await readFile(knownHostsFile, "utf8");
  } catch {
    return "not-pinned";
  }
  const wanted = hostPattern(host.toLowerCase(), port);
  let pinned = false;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("|")) continue;
    const parts = line.split(/\s+/);
    const marker = parts[0]?.startsWith("@") ? parts.shift() : undefined;
    if (marker === "@cert-authority") continue;
    const patterns = (parts[0] ?? "").toLowerCase().split(",");
    if (!patterns.includes(wanted)) continue;
    if (marker === "@revoked") return "revoked";
    if (parts.length >= 3) pinned = true;
  }
  return pinned ? "pinned" : "not-pinned";
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export type FailureCode =
  | "HOST_UNTRUSTED"
  | "HOST_KEY_CHANGED"
  | "ROUTE_UNAVAILABLE"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "TARGET_REJECTED"
  | "OUTPUT_INVALID"
  | "COLLECTION_FAILED";

export const FAILURE_MESSAGES: Readonly<Record<FailureCode, string>> = {
  HOST_UNTRUSTED: "The host key has not been verified and pinned. The host was not contacted.",
  HOST_KEY_CHANGED: "The host key no longer matches the pinned key. Inspection is blocked until it is reverified.",
  ROUTE_UNAVAILABLE: "The host could not be reached.",
  AUTH_FAILED: "The host rejected the configured credentials.",
  TIMEOUT: "The check did not finish within its time budget.",
  TARGET_REJECTED: "The configured target is not allowed.",
  OUTPUT_INVALID: "The host returned output that could not be validated.",
  COLLECTION_FAILED: "The check could not be completed.",
};

/** Map ssh's own exit status and stderr to a fixed code. stderr is never returned. */
export function classifySshFailure(stderr: string): FailureCode {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) return "HOST_KEY_CHANGED";
  if (/Host key verification failed/i.test(stderr)) return "HOST_UNTRUSTED";
  if (/Permission denied/i.test(stderr)) return "AUTH_FAILED";
  if (
    /timed out|No route to host|Connection refused|Network is unreachable|Could not resolve hostname|Connection closed|Connection reset|Name or service not known/i.test(
      stderr,
    )
  ) {
    return "ROUTE_UNAVAILABLE";
  }
  return "COLLECTION_FAILED";
}
