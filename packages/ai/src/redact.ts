/**
 * Secret scrubbing for logs, errors and responses.
 *
 * Two layers: (1) the exact secret values we know about (and their URL-encoded
 * form) are replaced wherever they appear in a string; (2) anything shaped like
 * a bearer credential is replaced even if we do not know the value. Object
 * keys that name credentials have their values replaced outright.
 *
 * Only plain objects, arrays, Errors and strings are walked. Other objects
 * (for example a live HTTP request) are left to their own serializers.
 */

export const REDACTED = "[REDACTED]";

const MIN_SECRET_LENGTH = 8;
const MAX_DEPTH = 6;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
const SECRET_KEY_NAME = /authorization|api[-_]?key|token|secret|password|passwd|cookie|credential/i;

export type Scrub = (value: unknown) => unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function createScrubber(secrets: readonly string[]): Scrub {
  const needles = new Set<string>();
  for (const s of secrets) {
    if (s.length < MIN_SECRET_LENGTH) continue;
    needles.add(s);
    needles.add(encodeURIComponent(s));
  }
  // Longest first, so a secret that contains another is replaced whole.
  const ordered = [...needles].sort((a, b) => b.length - a.length);

  const scrubString = (text: string): string => {
    let out = text;
    for (const n of ordered) out = out.split(n).join(REDACTED);
    return out.replace(BEARER, (_m, scheme: string) => `${scheme} ${REDACTED}`);
  };

  const walk = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
    if (typeof value === "string") return scrubString(value);
    if (typeof value !== "object" || value === null) return value;
    if (depth >= MAX_DEPTH) return REDACTED;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (value instanceof Error) {
      return {
        type: value.name,
        message: scrubString(value.message),
        ...(value.stack === undefined ? {} : { stack: scrubString(value.stack) }),
      };
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1, seen));
    if (!isPlainObject(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SECRET_KEY_NAME.test(key) && v !== null && v !== undefined ? REDACTED : walk(v, depth + 1, seen);
    }
    return out;
  };

  return (value) => walk(value, 0, new WeakSet());
}
