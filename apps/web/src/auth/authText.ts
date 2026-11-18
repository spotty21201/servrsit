/**
 * authText — fixed wording and small pure helpers for the sign-in and setup
 * screens (UX-01, UX Spec §7.1). No React.
 *
 * Rules carried here:
 *   - Errors never say whether an account exists. Wrong username and wrong
 *     password produce the same sentence.
 *   - A lockout says when to try again.
 *   - Server response text is never shown; only these fixed sentences.
 *   - The password hint is advice, not a gate: the API's own rule (12–256
 *     characters) decides. Pasting and password managers are not blocked.
 */
import { PASSWORD_MAX_CHARS, PASSWORD_MIN_CHARS, type AuthErrorCode } from "@servrsit/contracts";
import type { AuthClientError, AuthClientErrorKind } from "../api/auth";
import { formatClock } from "../lib/time";

export type Step = "password" | "setup-token" | "totp" | "recovery" | "enrol-confirm";

export interface ErrorView {
  readonly text: string;
  /** Set for a lockout: the owner may retry from this moment. */
  readonly retryAt: Date | null;
  /** When true the flow must restart at the password step. */
  readonly restart: boolean;
}

export function formatRetry(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

export function authError(error: AuthClientError, step: Step, now: Date, tz: string): ErrorView {
  const kind: AuthClientErrorKind = error.kind;
  const view = (text: string, extra: Partial<ErrorView> = {}): ErrorView => ({ text, retryAt: null, restart: false, ...extra });
  switch (kind) {
    case "LOCKED_OUT": {
      const secs = error.retryAfterSeconds ?? 30;
      const at = new Date(now.getTime() + secs * 1000);
      return view(`Too many failed attempts. Try again in ${formatRetry(secs)} (at ${formatClock(at, now, tz)}).`, { retryAt: at });
    }
    case "RATE_LIMITED": {
      const secs = error.retryAfterSeconds ?? 60;
      const at = new Date(now.getTime() + secs * 1000);
      return view(`Too many requests. Try again in ${formatRetry(secs)}.`, { retryAt: at });
    }
    case "INVALID_CREDENTIALS":
      return view("That username and password don't match. Check both and try again.");
    case "INVALID_CODE":
      return step === "recovery"
        ? view("That recovery code didn't work. Each code works once. Check it and try again.")
        : view("That code didn't work. Codes change every 30 seconds, and each can be used once. Check your device's clock, or use a recovery code.");
    case "MFA_REQUIRED":
      return view("The password step expired. Sign in again.", { restart: true });
    case "SETUP_UNAVAILABLE":
      return view("That setup token can't be used. It may be wrong or already used, or setup may already be done. A restart of the API prints a new one.");
    case "INVALID_INPUT":
      return view(step === "setup-token"
        ? `Check the fields. The username may use letters, digits, dots, dashes and underscores. The password needs ${PASSWORD_MIN_CHARS}–${PASSWORD_MAX_CHARS} characters.`
        : "Check what you typed and try again.");
    case "CSRF_INVALID":
      return view("The page's security check failed. Reload the page and try again.");
    case "UNAUTHENTICATED":
      return view(step === "enrol-confirm" ? "The enrolment expired. Start setup again with a new token." : "You are signed out. Sign in again.", { restart: step === "enrol-confirm" });
    case "TIMEOUT":
    case "NETWORK":
      return view("Couldn't reach ServrSit. Nothing was changed. Check the connection and try again.");
    case "INVALID_RESPONSE":
      return view("ServrSit answered in a way this page doesn't understand. Nothing was changed.");
    default: {
      const _never: never = kind;
      return view(String(_never));
    }
  }
}

export type PasswordLevel = "empty" | "short" | "ok" | "good";

export function passwordHint(pw: string): { level: PasswordLevel; text: string } {
  const n = [...pw].length;
  if (n === 0) return { level: "empty", text: `At least ${PASSWORD_MIN_CHARS} characters. A passphrase or a password manager's suggestion works well.` };
  if (n > PASSWORD_MAX_CHARS) return { level: "short", text: `Too long. The limit is ${PASSWORD_MAX_CHARS} characters.` };
  if (n < PASSWORD_MIN_CHARS) {
    const more = PASSWORD_MIN_CHARS - n;
    return { level: "short", text: `${more} more character${more === 1 ? "" : "s"} needed (${PASSWORD_MIN_CHARS} minimum).` };
  }
  if (new Set(pw).size <= 3) return { level: "short", text: "Too repetitive. Use a longer, less predictable password." };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (n >= 16 || classes >= 3) return { level: "good", text: "Good. Longer is stronger." };
  return { level: "ok", text: "Long enough. Adding more words or characters makes it stronger." };
}

export function isPasswordAcceptable(pw: string): boolean {
  const n = [...pw].length;
  return n >= PASSWORD_MIN_CHARS && n <= PASSWORD_MAX_CHARS;
}

/** "JBSW Y3DP EHPK 3PXP": easier to read and type than one long run. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

/** Digits only, so "123 456" and "123-456" work. */
export function normaliseTotp(input: string): string {
  return input.replace(/\D/g, "");
}

export const isTotpComplete = (input: string): boolean => normaliseTotp(input).length === 6;

export function normaliseRecovery(input: string): string {
  return input.trim();
}

/** Plain-text file for the recovery codes download. */
export function recoveryFileText(codes: readonly string[], when: Date): string {
  return [
    "ServrSit recovery codes",
    `Created ${when.toISOString()}`,
    "",
    "Each code works once, in place of an authenticator code.",
    "Keep this file somewhere safe and private. ServrSit cannot show these again.",
    "",
    ...codes.map((c, i) => `${String(i + 1).padStart(2, " ")}. ${c}`),
    "",
  ].join("\n");
}

export type { AuthErrorCode };
