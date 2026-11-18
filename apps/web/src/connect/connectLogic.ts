/**
 * connectLogic — validation, request building, local form draft, fingerprint
 * comparison and error wording for the Connect a server flow (UX-03, UX Spec
 * §7.3). Pure; no React. Request and response shapes come from
 * @servrsit/contracts (T-069); the regexes below are the contract's own.
 *
 * Safety rules carried here (execution-security steering, "Target safety"):
 *   - the address field accepts a hostname or IP only: no scheme, credentials,
 *     shell syntax or option-like leading dash; loopback, link-local (incl.
 *     169.254.169.254), unspecified and multicast are refused; private and
 *     CGNAT are fine. The API repeats and extends these checks;
 *   - only port 22 or 1024–65535;
 *   - the contract carries `production: boolean`. "Not sure" is sent as
 *     production (extra precautions) and never inferred from the name;
 *   - the saved local form draft is a whitelist of non-secret fields; the
 *     server-side draft holds no secret either.
 */
import {
  SERVER_DISPLAY_NAME,
  SERVER_ROLE,
  SSH_FINGERPRINT,
  SSH_USER,
  type ServerDraftRequest,
  type ServerRegistrationError,
} from "@servrsit/contracts";

export type Classification = "production" | "non-production" | "not-sure";
export type CheckInterval = "15" | "60";

export interface ConnectDraft {
  readonly name: string;
  readonly address: string;
  readonly port: string;
  readonly user: string;
  /** "What is this server for?", sent as the contract's `role` (optional). */
  readonly role: string;
  readonly classification: Classification | null;
  /** Schedule choice. The contract has no schedule field yet, so this is not sent. */
  readonly interval: CheckInterval;
}

export const EMPTY_DRAFT: ConnectDraft = { name: "", address: "", port: "22", user: "", role: "", classification: null, interval: "15" };

export type FieldErrors = Partial<Record<"name" | "address" | "port" | "user" | "role" | "classification", string>>;

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
  if (!lower.split(".").every((l) => HOST_LABEL.test(l))) return "A hostname may use letters, digits and dashes, separated by dots.";
  return null;
}

export function validatePort(raw: string): string | null {
  const t = raw.trim();
  if (!/^\d{1,5}$/.test(t)) return "Enter a port number.";
  const n = Number(t);
  return n === 22 || (n >= 1024 && n <= 65535) ? null : "ServrSit connects on port 22 or a port from 1024 to 65535.";
}

export function validateUser(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "Enter the SSH user name.";
  return SSH_USER.test(t) ? null : "Use a Linux user name: lower-case letters, digits, dash or underscore, up to 32 characters.";
}

export function validateName(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return "Give the server a name.";
  return SERVER_DISPLAY_NAME.test(t) ? null : "Use letters, digits, spaces, dots, dashes and underscores, starting with a letter or digit, up to 64 characters.";
}

export function validateRole(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null; // optional
  return SERVER_ROLE.test(t) ? null : "Keep it short: letters, digits, spaces and basic punctuation, up to 64 characters.";
}

export function validateMeet(d: ConnectDraft): FieldErrors {
  const e: FieldErrors = {};
  const set = <K extends keyof FieldErrors>(k: K, msg: string | null): void => { if (msg) e[k] = msg; };
  set("name", validateName(d.name));
  set("address", validateAddress(d.address));
  set("port", validatePort(d.port));
  set("user", validateUser(d.user));
  set("role", validateRole(d.role));
  if (d.classification === null) e.classification = "Choose one. If you are not sure, pick \"Not sure\".";
  return e;
}

export const hasErrors = (e: FieldErrors): boolean => Object.keys(e).length > 0;

/** "Not sure" is handled as production until the owner decides. */
export const treatedAsProduction = (c: Classification | null): boolean => c === "production" || c === "not-sure";

export const NOT_SURE_NOTE =
  "ServrSit records this server as production until you decide: changes will need the extra production confirmations. The name is never used to guess.";

/** The contract request for a validated form. */
export function toDraftRequest(d: ConnectDraft): ServerDraftRequest {
  return {
    address: d.address.trim(),
    port: Number(d.port.trim()),
    user: d.user.trim(),
    name: d.name.trim(),
    role: d.role.trim() === "" ? null : d.role.trim(),
    production: treatedAsProduction(d.classification),
  };
}

// ── Local form draft (non-secret fields only) + the server draft's id ───────

export const DRAFT_KEY = "servrsit.connect.form.v2";
export const DRAFT_ID_KEY = "servrsit.connect.draftId.v1";
const DRAFT_FIELDS = ["name", "address", "port", "user", "role", "classification", "interval"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Serialise exactly the whitelisted fields; anything else on the object is dropped. */
export function serializeDraft(d: ConnectDraft): string {
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_FIELDS) out[k] = d[k];
  return JSON.stringify(out);
}

export function parseDraft(text: string | null): ConnectDraft | null {
  if (!text || text.length > 4096) return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (typeof j !== "object" || j === null) return null;
    const str = (k: string, max: number): string => (typeof j[k] === "string" ? (j[k] as string).slice(0, max) : "");
    const cls = j["classification"];
    return {
      name: str("name", 64), address: str("address", 253), port: str("port", 5) || "22", user: str("user", 32), role: str("role", 64),
      classification: cls === "production" || cls === "non-production" || cls === "not-sure" ? cls : null,
      interval: j["interval"] === "60" ? "60" : "15",
    };
  } catch {
    return null;
  }
}

/** Only a well-formed UUID is accepted back from storage. */
export const parseDraftId = (text: string | null): string | null => (text && UUID.test(text) ? text : null);

// ── Fingerprint comparison ──────────────────────────────────────────────────

/** Trim and remove whitespace; add the "SHA256:" prefix when only the 43 characters were given. */
export function normaliseFingerprint(s: string): string {
  const t = s.trim().replace(/\s+/g, "");
  return /^[A-Za-z0-9+/]{43}$/.test(t) ? `SHA256:${t}` : t;
}

export type Comparison = "empty" | "malformed" | "match" | "mismatch";

export function compareFingerprint(shown: string, entered: string): Comparison {
  const e = normaliseFingerprint(entered);
  if (e === "") return "empty";
  if (!SSH_FINGERPRINT.test(e)) return "malformed";
  return e === shown ? "match" : "mismatch";
}

// ── Error wording (fixed text; the API's own `reason` is shown only for the
//    codes where it is the explanation, and it is our text, never server output) ─

type AnyError = ServerRegistrationError | { readonly error: "NETWORK" | "TIMEOUT" | "INVALID_RESPONSE" | "CSRF_INVALID" | "UNAUTHENTICATED"; readonly reason?: undefined };

export function registrationError(e: AnyError): string {
  switch (e.error) {
    case "ADDRESS_REJECTED": return `That address is not allowed. ${e.reason ?? ""}`.trim();
    case "DUPLICATE_SERVER": return "This server is already registered.";
    case "DRAFT_NOT_FOUND": return "This setup no longer exists. Start again from step 1.";
    case "DRAFT_EXPIRED": return "This setup expired after 24 hours. Start again from step 1.";
    case "HOST_KEY_NOT_CONFIRMED": return "Confirm the host key first.";
    case "FINGERPRINT_MISMATCH": return "That fingerprint is not the one the server presented. Nothing was trusted.";
    case "HOST_KEY_CHANGED": return "The server's host key changed while ServrSit was connecting. Nothing was trusted. Stop and check the network path.";
    case "ROUTE_UNAVAILABLE": return "ServrSit cannot reach this address yet.";
    case "STATE_CONFLICT": return `That step is not available yet. ${e.reason ?? ""}`.trim();
    case "SERVER_NOT_FOUND": return "That server no longer exists.";
    case "INVALID_INPUT": return "The API did not accept those details. Check the fields and try again.";
    // A lost answer does not prove the step did not happen, so these never say "nothing was changed".
    case "NETWORK": return "Couldn't reach ServrSit. This step may or may not have happened. Reload the page to see where the setup stands.";
    case "TIMEOUT": return "ServrSit did not answer in time. This step may or may not have happened. Reload the page to see where the setup stands.";
    case "INVALID_RESPONSE": return "ServrSit answered in a way this page doesn't understand. This step may or may not have happened. Reload the page to see where the setup stands.";
    case "CSRF_INVALID": return "The page's security check failed twice. Nothing was changed. Reload the page and try again.";
    case "UNAUTHENTICATED": return "You are signed out. Sign in again; your setup is kept for 24 hours.";
  }
}

export const FAILURE_TEXT: Readonly<Record<string, string>> = {
  HOST_UNTRUSTED: "The host key is not trusted yet, so ServrSit did not connect.",
  HOST_KEY_CHANGED: "The host key changed since you confirmed it. ServrSit stopped. Do not continue until you know why.",
  ROUTE_UNAVAILABLE: "ServrSit could not reach the server. Check the private route and the address.",
  AUTH_FAILED: "The server refused ServrSit's key. Check that the line was added for this user and the file permissions.",
  TIMEOUT: "The check took too long and was stopped.",
  TARGET_REJECTED: "The address or user was rejected by ServrSit's safety rules.",
  OUTPUT_INVALID: "The server answered in a way ServrSit could not read.",
  COLLECTION_FAILED: "The check could not complete.",
};

// ── Steps (contract order: host key before access key) ──────────────────────

export const STEPS = ["Meet the server", "Verify identity", "Set up access", "First check"] as const;
