/**
 * T-091 (D-S3): a forced command for the inspect key, so that key can run
 * only ServrSit's reviewed read-only scripts and nothing else.
 *
 * Before T-091 the inspect key's line was `restrict,from="<controller>"`
 * with no command: whoever held the key had a full shell as the owner's
 * account, and could change files the owner later runs with sudo.
 *
 * With the forced command, sshd ignores the command the client asks for and
 * runs this fixed program instead (the client's request is only visible as
 * SSH_ORIGINAL_COMMAND). The program:
 *  1. accepts only the request `sh -s <32 lowercase hex>` (the nonce);
 *  2. reads at most 256 KiB of script from stdin;
 *  3. runs it with `sh -s <nonce>` only if its SHA-256 is one of the digests
 *     written into the key line: the reviewed scripts in INSPECT_SCRIPTS.
 * Anything else exits 2 or 3 and runs nothing.
 *
 * The program is written into the key line itself, so nothing is installed
 * on the server. Changing any inspect script changes its digest: such a
 * change is reviewed, and servers keep running the old scripts until the
 * owner replaces the line (the digest snapshot test makes this visible).
 *
 * A server whose key line has no forced command (registered before T-091)
 * still works: its remote command is the same `sh -s <nonce>`.
 */

import { createHash } from "node:crypto";
import { INSTALLED_SECTIONS, PREVIEW_SECTIONS } from "./preview.js";
import { INVENTORY_SECTIONS } from "./inventory.js";
import { buildPrivilegeScript } from "./privilege.js";
import { buildCollectorScript, NONCE_CASE_PATTERN } from "./script.js";
import { COLLECTOR_SECTIONS } from "./sections.js";

/** Every script the inspect key may run. Adding one is a reviewed change and needs new key lines. */
export const INSPECT_SCRIPTS: Readonly<Record<string, string>> = {
  health: buildCollectorScript(COLLECTOR_SECTIONS),
  inventory: buildCollectorScript(INVENTORY_SECTIONS),
  privilege: buildPrivilegeScript(),
  preview: buildCollectorScript(PREVIEW_SECTIONS),
  installed: buildCollectorScript(INSTALLED_SECTIONS),
};

/** Most script bytes the forced command reads; a longer script cannot match a digest. */
export const MAX_INSPECT_SCRIPT_BYTES = 262_144;

/**
 * The digest the forced command computes: SHA-256 (hex) of the script with its
 * trailing newlines removed, which is what shell command substitution keeps.
 */
export function inspectScriptDigest(script: string): string {
  return createHash("sha256").update(script.replace(/\n+$/, ""), "utf8").digest("hex");
}

export function inspectScriptDigests(): string[] {
  return [...new Set(Object.values(INSPECT_SCRIPTS).map(inspectScriptDigest))].sort();
}

const REFUSED_REQUEST = "servrsit: this key only runs the reviewed ServrSit checks";
const REFUSED_SCRIPT = "servrsit: this check is not on the reviewed list in this key";

/**
 * The forced command as the login shell receives it (after sshd removes the
 * key-line quoting). It hands everything to /bin/sh so the owner's login
 * shell does not matter. It contains no single quote and no line break.
 */
export function inspectForcedCommand(): string {
  const digests = inspectScriptDigests().map((d) => `"${d}  -"`).join("|");
  const program = [
    'n=${SSH_ORIGINAL_COMMAND#sh -s }',
    `case "$SSH_ORIGINAL_COMMAND" in "sh -s "${NONCE_CASE_PATTERN}) ;; *) echo "${REFUSED_REQUEST}" >&2; exit 2 ;; esac`,
    `s=$(head -c ${MAX_INSPECT_SCRIPT_BYTES})`,
    `case $(printf %s "$s" | sha256sum) in ${digests}) ;; *) echo "${REFUSED_SCRIPT}" >&2; exit 3 ;; esac`,
    'printf "%s\\n" "$s" | sh -s "$n"',
  ].join("; ");
  if (program.includes("'") || program.includes("\n")) throw new Error("the forced command must not contain a single quote or a line break");
  return `exec /bin/sh -c '${program}'`;
}

/** The authorized_keys options for an inspect key: from= and the forced command, quoted for sshd. */
export function inspectKeyOptions(from: string): string {
  if (!/^[A-Za-z0-9.:-]{1,253}$/.test(from)) throw new Error("the controller address is not valid for from=");
  return `restrict,from="${from}",command="${inspectForcedCommand().replace(/"/g, '\\"')}"`;
}
