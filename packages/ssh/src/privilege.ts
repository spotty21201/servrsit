/**
 * The privilege check (T-081, PRD FR-02/FR-03). Run once, in the first
 * check of a new server, and disclosed to the owner beforehand.
 *
 * It runs exactly `sudo -n -l` as the login user: list the sudo rules, run
 * nothing (`-l`), never prompt (`-n`). No command is run as root and no
 * password is ever given. Only a classification leaves this module; the
 * output itself is never returned or stored.
 */

import { randomBytes } from "node:crypto";
import { splitSections } from "./parse.js";
import { spawnRunner, type CommandRunner } from "./runner.js";
import { sanitizeLines } from "./sanitize.js";
import { remoteCommand, scriptPrelude } from "./script.js";
import {
  FAILURE_MESSAGES,
  TargetRejectedError,
  assertResolvesToAllowedAddress,
  buildSshArgv,
  classifySshFailure,
  pinStateFor,
  validateTarget,
  type FailureCode,
  type SshOptions,
  type SshTarget,
} from "./transport.js";

export type PrivilegeLevel = "no-sudo-rules" | "passwordless-sudo" | "unknown";

export interface PrivilegeResult {
  readonly level: PrivilegeLevel;
  readonly broad: boolean;
  readonly summary: string;
}

export type PrivilegeProbeResult = { readonly ok: true; readonly privilege: PrivilegeResult } | { readonly ok: false; readonly code: FailureCode; readonly message: string };

export const PRIVILEGE_SUMMARIES = {
  noSudo: "sudo is not installed for this account.",
  noRules: "This account has no sudo rules.",
  passwordNeeded: "Listing this account's sudo rules needs a password, which ServrSit never gives, so its privileges are unknown.",
  rulesNeedPassword: "This account has sudo rules that need a password. ServrSit never gives one, so it cannot use them.",
  passwordless: "This account can run some commands with sudo without a password.",
  broad: "Warning: this account can run any command as root without a password. ServrSit only needs to read; a narrower account is safer.",
  unreadable: "The sudo rules could not be read, so this account's privileges are unknown.",
} as const;

/** The fixed script, the same on every run. The nonce is its argument (`sh -s <nonce>`, T-091). */
export function buildPrivilegeScript(): string {
  return [
    ...scriptPrelude(),
    `printf '@@BEGIN %s sudorules@@\\n' "$N"`,
    "if command -v sudo >/dev/null 2>/dev/null; then sudo -n -l 2>&1 </dev/null; s_rc=$?; else s_rc=127; fi",
    `printf '\\n@@END %s sudorules %s@@\\n' "$N" "$s_rc"`,
    "exit 0",
    "",
  ].join("\n");
}

/** A rule line granting every command as root (or as anyone) without a password. */
const BROAD = /^\(\s*(ALL|root)\s*(:\s*ALL\s*)?\)\s+(\w+:\s*)*NOPASSWD:\s*(\w+:\s*)*ALL\s*$/;

/** Classify `sudo -n -l` output. Pure; exported for recorded-output tests. */
export function classifySudo(output: string, exitCode: number): PrivilegeResult {
  if (exitCode === 127) return { level: "no-sudo-rules", broad: false, summary: PRIVILEGE_SUMMARIES.noSudo };
  const lines = sanitizeLines(output).map((l) => l.trim()).filter((l) => l !== "");
  const text = lines.join("\n");
  if (/may not run sudo/i.test(text)) return { level: "no-sudo-rules", broad: false, summary: PRIVILEGE_SUMMARIES.noRules };
  if (/a password is required/i.test(text)) return { level: "unknown", broad: false, summary: PRIVILEGE_SUMMARIES.passwordNeeded };
  if (exitCode !== 0) return { level: "unknown", broad: false, summary: PRIVILEGE_SUMMARIES.unreadable };
  const start = lines.findIndex((l) => /may run the following commands/i.test(l));
  if (start === -1) return { level: "unknown", broad: false, summary: PRIVILEGE_SUMMARIES.unreadable };
  const rules = lines.slice(start + 1);
  if (rules.some((r) => BROAD.test(r))) return { level: "passwordless-sudo", broad: true, summary: PRIVILEGE_SUMMARIES.broad };
  if (rules.some((r) => /NOPASSWD:/.test(r))) return { level: "passwordless-sudo", broad: false, summary: PRIVILEGE_SUMMARIES.passwordless };
  return { level: "unknown", broad: false, summary: PRIVILEGE_SUMMARIES.rulesNeedPassword };
}

export interface PrivilegeDeps {
  readonly runner?: CommandRunner | undefined;
  readonly nonce?: (() => string) | undefined;
  readonly checkResolution?: ((host: string) => Promise<void>) | undefined;
}

const fail = (code: FailureCode): PrivilegeProbeResult => ({ ok: false, code, message: FAILURE_MESSAGES[code] });

/** Run the privilege check over SSH. Refuses unpinned hosts, like every collector. */
export async function probePrivilegeViaSsh(target: SshTarget, options: SshOptions, deps: PrivilegeDeps = {}): Promise<PrivilegeProbeResult> {
  try {
    validateTarget(target, options);
  } catch (error) {
    if (error instanceof TargetRejectedError) return fail("TARGET_REJECTED");
    throw error;
  }
  if ((await pinStateFor(options.knownHostsFile, target.host, target.port)) !== "pinned") return fail("HOST_UNTRUSTED");
  try {
    await (deps.checkResolution ?? assertResolvesToAllowedAddress)(target.host);
  } catch (error) {
    return fail(error instanceof TargetRejectedError ? "TARGET_REJECTED" : "ROUTE_UNAVAILABLE");
  }
  const nonce = (deps.nonce ?? (() => randomBytes(16).toString("hex")))();
  const result = await (deps.runner ?? spawnRunner)({
    file: "/usr/bin/ssh",
    args: buildSshArgv(target, options, remoteCommand(nonce)),
    stdin: buildPrivilegeScript(),
    timeoutMs: 20_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 8 * 1024,
  });
  if (result.spawnFailed) return fail("COLLECTION_FAILED");
  if (result.timedOut) return fail("TIMEOUT");
  const section = splitSections(result.stdout, nonce, 32 * 1024, ["sudorules"]).get("sudorules");
  if (section === undefined) return fail(result.exitCode === 255 ? classifySshFailure(result.stderr) : "OUTPUT_INVALID");
  if (section.truncated) return { ok: true, privilege: { level: "unknown", broad: false, summary: PRIVILEGE_SUMMARIES.unreadable } };
  return { ok: true, privilege: classifySudo(section.output, section.exitCode) };
}
