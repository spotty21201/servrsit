/**
 * Sanitisation for untrusted remote text.
 *
 * Everything that comes back from a managed server (hostnames, unit names,
 * mount points, package output) is untrusted data (execution-security
 * steering, "Untrusted data boundary"). This module removes terminal control
 * sequences and invisible/bidirectional formatting characters, and bounds
 * length. It does not make text trustworthy; it makes it inert enough to be
 * stored and rendered as plain text.
 */

const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
const DCS_PM_APC_SOS = /\u001b[P^_X][^\u001b]*(?:\u001b\\)?/g;
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]?/g;
const CHARSET_DESIGNATION = /\u001b[()*+\-./][\u0020-\u007e]/g;
const ESC_PAIR = /\u001b./g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const INVISIBLE_FORMAT = /[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

/** Remove terminal escape sequences but keep newlines so lines can still be split. */
export function stripEscapeSequences(input: string): string {
  return input
    .replace(OSC, "")
    .replace(DCS_PM_APC_SOS, "")
    .replace(CSI, "")
    .replace(CHARSET_DESIGNATION, "")
    .replace(ESC_PAIR, "");
}

/** Truncate to at most `maxChars` code points without splitting a surrogate pair. */
export function truncateCodePoints(input: string, maxChars: number): string {
  const points = Array.from(input);
  return points.length <= maxChars ? input : points.slice(0, maxChars).join("");
}

/**
 * Make a single value safe to store and display as plain text.
 * Control characters become a space (not deleted) so that "a\u0000b" cannot
 * collapse into a plausible-looking "ab" that passes a later name check.
 */
export function sanitizeText(input: string, maxChars: number): string {
  const cleaned = stripEscapeSequences(input)
    .replace(INVISIBLE_FORMAT, "")
    .replace(CONTROL, " ")
    .trim();
  return truncateCodePoints(cleaned, maxChars);
}

/** Split already-captured output into sanitised lines. */
export function sanitizeLines(raw: string, maxLineChars = 1024): string[] {
  return stripEscapeSequences(raw)
    .split(/\r\n|\n|\r/)
    .map((line) => sanitizeText(line, maxLineChars));
}

const UNIT_NAME =
  /^[A-Za-z0-9:_.\\@-]{1,200}\.(service|socket|target|device|mount|automount|swap|path|timer|slice|scope)$/;
const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const MOUNT_PATH = /^\/[A-Za-z0-9._/@:+-]{0,254}$/;

/** True only for names that look like a well-formed systemd unit name. */
export function isSafeUnitName(name: string): boolean {
  return UNIT_NAME.test(name);
}

/** True only for plain DNS-label style hostnames. */
export function isSafeHostname(name: string): boolean {
  return HOSTNAME.test(name);
}

/** True only for conservative absolute mount paths. */
export function isSafeMountPath(path: string): boolean {
  return MOUNT_PATH.test(path);
}
