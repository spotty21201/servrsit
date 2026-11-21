/**
 * The fixed, reviewed read-only collector scripts.
 *
 * Technical Spec §7.1: inspect-only mode runs fixed, reviewed, nonprivileged
 * collectors with bounded output. A script is sent over stdin to `sh -s`, and
 * its text is the same on every run. T-091: the per-run nonce that delimits
 * sections travels as the script's only argument (`sh -s <nonce>`), so a key
 * with a forced command can check each script against a list of SHA-256
 * digests (inspect-access.ts). The script checks the nonce's form again.
 *
 * Rules enforced by tests (see script.test.ts):
 *  - no sudo, no privilege change
 *  - no package refresh (`apt-get update`, `apt update`)
 *  - no file writes or redirects other than to /dev/null
 *  - no service control (restart/start/stop/reload/enable)
 *
 * Package state is read with a simulated upgrade (`apt-get -s`) and
 * `Debug::NoLocking=1`, which neither refreshes metadata nor takes the APT
 * lock, so it cannot interfere with a concurrent package operation.
 */

import { COLLECTOR_SECTIONS, type CollectorSection } from "./sections.js";

const NONCE_PATTERN = /^[0-9a-f]{32}$/;

export function isValidNonce(nonce: string): boolean {
  return NONCE_PATTERN.test(nonce);
}

/** A shell `case` pattern for exactly 32 lowercase hex characters. */
export const NONCE_CASE_PATTERN = "[0-9a-f]".repeat(32);

/** Fixed remote command without a nonce (the helper gateway ignores it). */
export const REMOTE_COMMAND: readonly string[] = ["sh", "-s"];

/** The remote command for one inspect run: `sh -s <nonce>`. Only a valid nonce is accepted. */
export function remoteCommand(nonce: string): readonly string[] {
  if (!isValidNonce(nonce)) throw new Error("collector nonce must be 32 lowercase hex characters");
  return ["sh", "-s", nonce];
}

/** Lines every script starts with: the nonce from $1, checked, then a fixed environment. */
export function scriptPrelude(): string[] {
  return [
    "N=$1",
    `case $N in ${NONCE_CASE_PATTERN}) ;; *) exit 2 ;; esac`,
    "LC_ALL=C; export LC_ALL",
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; export PATH",
  ];
}

/** The script for a fixed list of reviewed sections (default: the health collector). Same text on every run. */
export function buildCollectorScript(sections: readonly CollectorSection[] = COLLECTOR_SECTIONS): string {
  const lines = [
    ...scriptPrelude(),
    'T=""',
    'if command -v timeout >/dev/null 2>/dev/null; then T="timeout 15"; fi',
    "section() {",
    "  s_name=$1",
    "  shift",
    `  printf '@@BEGIN %s %s@@\\n' "$N" "$s_name"`,
    '  "$@" 2>/dev/null </dev/null',
    "  s_rc=$?",
    `  printf '\\n@@END %s %s %s@@\\n' "$N" "$s_name" "$s_rc"`,
    "}",
    ...sections.map((s) => `section ${s.name} ${s.command}`),
    "exit 0",
    "",
  ];
  return lines.join("\n");
}
