/**
 * connectLogic — validation, draft handling and fingerprint comparison for
 * the Connect a server flow (UX-03, UX Spec §7.3). Pure; no React.
 *
 * Safety rules carried here (execution-security steering, "Target safety"):
 *   - the address field accepts a hostname or IP only: no scheme, no
 *     credentials, no shell syntax, no option-like leading dash;
 *   - loopback, link-local (including 169.254.169.254), unspecified and
 *     multicast addresses are refused; private and CGNAT addresses are fine;
 *   - only port 22 or an unprivileged port (1024–65535) is accepted;
 *   - "not sure" is treated as production (extra precautions), and the
 *     classification is never inferred from the name;
 *   - the saved draft is a whitelist of non-secret fields. No key, password,
 *     token or fingerprint confirmation is ever stored.
 */

export type Classification = "production" | "non-production" | "not-sure";
export type AccessChoice = "inspect-only" | "maintenance";
export type CheckInterval = "15" | "60";

export interface ConnectDraft {
  readonly name: string;
  readonly address: string;
  readonly port: string;
  readonly username: string;
  readonly purpose: string;
  readonly classification: Classification | null;
  readonly access: AccessChoice;
  readonly interval: CheckInterval;
}

export const EMPTY_DRAFT: ConnectDraft = {
  name: "", address: "", port: "22", username: "", purpose: "", classification: null, access: "inspect-only", interval: "15",
};

export type FieldErrors = Partial<Record<"name" | "address" | "port" | "username" | "classification", string>>;

const SHELL_CHARS = /[\s;|&$`<>()\\'"*?,{}[\]!#%^=~]/;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const BLOCKED_NAMES = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data"]);

function ipv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n >= 0 && n <= 255) ? o : null;
}

/** An error sentence, or null when the address is acceptable. */
export function validateAddress(raw: string): string | null {
  const a = raw.trim();
  if (a === "") return "Enter the server's hostname or IP address.";
  if (a.length > 253) return "That address is too long.";
  if (a.startsWith("-")) return "An address cannot start with a dash.";
  if (a.includes("://") || a.includes("@") || SHELL_CHARS.test(a) || a.includes("/")) {
    return "Enter only a hostname or IP address. No scheme, user name, port, path or commands.";
  }
  if (a.includes(":")) {
    if (!/^[0-9a-f:]+$/i.test(a) || (a.match(/::/g) ?? []).length > 1 || a.split(":").length < 3) return "That does not look like an IPv6 address.";
    const lower = a.toLowerCase();
    if (lower === "::1" || lower === "::" || lower.startsWith("fe80:")) return "Loopback, unspecified and link-local addresses are not allowed.";
    return null;
  }
  const v4 = ipv4(a);
  if (v4) {
    const [o1, o2] = v4 as [number, number, number, number];
    if (o1 === 127 || o1 === 0) return "Loopback and unspecified addresses are not allowed.";
    if (o1 === 169 && o2 === 254) return "Link-local addresses (including cloud metadata) are not allowed.";
    if (o1 >= 224) return "Multicast and reserved addresses are not allowed.";
    return null;
  }
  if (/^\d+(\.\d+)*$/.test(a)) return "That is not a valid IPv4 address.";
  const lower = a.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_NAMES.has(lower) || lower.endsWith(".localhost")) return "That name points back at this machine and is not allowed.";
  const labels = lower.split(".");
  if (!labels.every((l) => HOST_LABEL.test(l))) return "A hostname may use letters, digits and dashes, separated by dots.";
  return null;
}

export function validatePort(raw: string): string | null {
  const t = raw.trim();
  if (!/^\d{1,5}$/.test(t)) return "Enter a port number.";
  const n = Number(t);
  if (n === 22 || (n >= 1024 && n <= 65535)) return null;
  return "ServrSit connects on port 22 or a port from 1024 to 65535.";
}

const USERNAME = /^[a-z_][a-z0-9_-]{0,31}$/;

export function validateUsername(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "Enter the SSH user name.";
  if (!USERNAME.test(t)) return "Use a Linux user name: lower-case letters, digits, dash or underscore, up to 32 characters.";
  return null;
}

export function validateName(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "Give the server a name.";
  if (t.length > 40) return "Keep the name to 40 characters.";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) return "The name cannot contain control characters.";
  return null;
}

export function validateMeet(d: ConnectDraft): FieldErrors {
  const e: FieldErrors = {};
  const set = <K extends keyof FieldErrors>(k: K, msg: string | null): void => { if (msg) e[k] = msg; };
  set("name", validateName(d.name));
  set("address", validateAddress(d.address));
  set("port", validatePort(d.port));
  set("username", validateUsername(d.username));
  if (d.classification === null) e.classification = "Choose one. If you are not sure, pick \"Not sure\".";
  return e;
}

export const hasErrors = (e: FieldErrors): boolean => Object.keys(e).length > 0;

/** "Not sure" is handled as production until the owner decides. */
export const treatedAsProduction = (c: Classification | null): boolean => c === "production" || c === "not-sure";

export const NOT_SURE_NOTE =
  "ServrSit will treat this server as production until you decide: changes will need the extra production confirmations. The name is never used to guess.";

// ── Draft (non-secret fields only) ──────────────────────────────────────────

export const DRAFT_KEY = "servrsit.connect.draft.v1";
const DRAFT_FIELDS = ["name", "address", "port", "username", "purpose", "classification", "access", "interval"] as const;

export interface StoredDraft { readonly step: number; readonly draft: ConnectDraft }

/** Serialise exactly the whitelisted fields; anything else on the object is dropped. */
export function serializeDraft(step: number, d: ConnectDraft): string {
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_FIELDS) out[k] = d[k];
  return JSON.stringify({ step, draft: out });
}

export function parseDraft(text: string | null): StoredDraft | null {
  if (!text || text.length > 8192) return null;
  try {
    const j = JSON.parse(text) as { step?: unknown; draft?: Record<string, unknown> };
    if (typeof j.step !== "number" || !j.draft || typeof j.draft !== "object") return null;
    const str = (k: string, max: number): string => (typeof j.draft?.[k] === "string" ? (j.draft[k] as string).slice(0, max) : "");
    const cls = j.draft["classification"];
    const access = j.draft["access"];
    const interval = j.draft["interval"];
    return {
      step: Math.min(Math.max(Math.trunc(j.step), 0), 1), // never resume past the identity check: that must be redone
      draft: {
        name: str("name", 40), address: str("address", 253), port: str("port", 5) || "22", username: str("username", 32), purpose: str("purpose", 300),
        classification: cls === "production" || cls === "non-production" || cls === "not-sure" ? cls : null,
        access: access === "maintenance" ? "inspect-only" : "inspect-only", // maintenance is not available yet
        interval: interval === "60" ? "60" : "15",
      },
    };
  } catch {
    return null;
  }
}

// ── Fingerprint comparison ──────────────────────────────────────────────────

/** "SHA256:abc…" or bare "abc…", trimmed. Case matters (base64). */
export function normaliseFingerprint(s: string): string {
  const t = s.trim().replace(/\s+/g, "");
  return t.startsWith("SHA256:") ? t.slice(7) : t;
}

const B64_43 = /^[A-Za-z0-9+/]{43}$/;

export type Comparison = "empty" | "malformed" | "match" | "mismatch";

export function compareFingerprint(shown: string, entered: string): Comparison {
  const e = normaliseFingerprint(entered);
  if (e === "") return "empty";
  if (!B64_43.test(e)) return "malformed";
  return e === normaliseFingerprint(shown) ? "match" : "mismatch";
}

// ── Steps ───────────────────────────────────────────────────────────────────

export const STEPS = ["Meet the server", "Set up access", "Verify identity", "First check"] as const;
export type StepIndex = 0 | 1 | 2 | 3;
