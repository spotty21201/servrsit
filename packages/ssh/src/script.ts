/**
 * The fixed, reviewed read-only collector script.
 *
 * Technical Spec §7.1: inspect-only mode runs fixed, reviewed, nonprivileged
 * collectors with bounded output. This script is sent over stdin to `sh -s`,
 * so no variable input is ever placed in a remote command line. The only
 * generated part is a random hex nonce used to delimit sections.
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

import { COLLECTOR_SECTIONS } from "./sections.js";

const NONCE_PATTERN = /^[0-9a-f]{32}$/;

export function isValidNonce(nonce: string): boolean {
  return NONCE_PATTERN.test(nonce);
}

/** Remote command line. Fixed. `sh -s` reads the script from stdin. */
export const REMOTE_COMMAND: readonly string[] = ["sh", "-s"];

export function buildCollectorScript(nonce: string): string {
  if (!isValidNonce(nonce)) {
    throw new Error("collector nonce must be 32 lowercase hex characters");
  }
  const lines = [
    "LC_ALL=C; export LC_ALL",
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; export PATH",
    'T=""',
    'if command -v timeout >/dev/null 2>/dev/null; then T="timeout 15"; fi',
    "section() {",
    "  s_name=$1",
    "  shift",
    `  printf '@@BEGIN ${nonce} %s@@\\n' "$s_name"`,
    '  "$@" 2>/dev/null </dev/null',
    "  s_rc=$?",
    `  printf '\\n@@END ${nonce} %s %s@@\\n' "$s_name" "$s_rc"`,
    "}",
    ...COLLECTOR_SECTIONS.map((s) => `section ${s.name} ${s.command}`),
    "exit 0",
    "",
  ];
  return lines.join("\n");
}
