/**
 * Owner-context layer (T-050).
 *
 * The owner keeps a short, plain-text description of their servers and
 * preferences in apps/api/config/assistant-context.md. It is injected AFTER
 * the fixed, code-owned rules, fenced as a JSON string in <owner_context>.
 *
 * It describes intent and preferences. It can never grant permissions,
 * override the fixed rules, or count as evidence of current server state.
 *
 * Preparation fails closed: anything that looks like a secret rejects the
 * whole file (no owner context at all). Unfilled TODO(owner) placeholder
 * lines are dropped, so placeholders never reach the model as "facts".
 */

import { stripEscapeSequences } from "@servrsit/ssh";
import { looksLikeSecret } from "./assistant.js";

/**
 * T-064 F1: the owner-context file never needs a credential, so it is stricter
 * than chat. Any line that names a secret kind and then gives it a value
 * ("x: ...", "x = ...", "x is ...") rejects the whole file.
 */
const SECRET_WORD = /(?:password|passwd|passphrase|passcode|token|secret|api[_ -]?key|access[_ -]?key|private[_ -]?key|auth[_ -]?key|credentials?)/i;
export function pairsSecretWordWithValue(text: string): boolean {
  return text.split("\n").some((line) => {
    const m = SECRET_WORD.exec(line);
    if (m === null) return false;
    const after = line.slice(m.index + m[0].length);
    return /^[A-Za-z0-9_]*\s*[=:]\s*\S/.test(after) || /^[^.]{0,40}?\b(?:is|was)\s+["']?\S{6,}/i.test(after);
  });
}

export const OWNER_CONTEXT_MAX_BYTES = 4096;
export const PLACEHOLDER_MARK = "TODO(owner)";

export type OwnerContextResult =
  | { readonly ok: true; readonly text: string; readonly bytes: number; readonly truncated: boolean; readonly droppedPlaceholders: number }
  | { readonly ok: false; readonly reason: "secret" | "empty" };

const INVISIBLE_FORMAT = /[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

function cleanText(raw: string): string {
  return stripEscapeSequences(raw)
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE_FORMAT, "")
    .replace(CONTROL_EXCEPT_NEWLINE, " ");
}

/** Cut to at most `max` UTF-8 bytes, preferring a line boundary, never splitting a code point. */
function capBytes(text: string, max: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= max) return { text, truncated: false };
  let out = "";
  let bytes = 0;
  for (const ch of text) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > max) break;
    out += ch;
    bytes += n;
  }
  const lastBreak = out.lastIndexOf("\n");
  return { text: (lastBreak > max / 2 ? out.slice(0, lastBreak) : out).trimEnd(), truncated: true };
}

export function prepareOwnerContext(raw: string, knownSecrets: readonly string[] = []): OwnerContextResult {
  const cleaned = cleanText(raw);
  // The secret check runs on the WHOLE cleaned file, before any capping, so a
  // secret cannot hide past the 4 KB cut.
  if (looksLikeSecret(cleaned, knownSecrets) || pairsSecretWordWithValue(cleaned)) return { ok: false, reason: "secret" };

  let dropped = 0;
  const kept = cleaned
    .split("\n")
    .filter((line) => {
      if (line.includes(PLACEHOLDER_MARK)) {
        dropped += 1;
        return false;
      }
      return true;
    })
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (kept.replace(/^#.*$/gm, "").trim().length === 0) return { ok: false, reason: "empty" };
  const capped = capBytes(kept, OWNER_CONTEXT_MAX_BYTES);
  return {
    ok: true,
    text: capped.text,
    bytes: Buffer.byteLength(capped.text, "utf8"),
    truncated: capped.truncated,
    droppedPlaceholders: dropped,
  };
}
