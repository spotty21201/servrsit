/**
 * Owner-local time for everything the model sees or the owner reads (DEF-L1).
 *
 * The model is never given a raw timestamp. Every time is pre-formatted in the
 * owner's time zone, with an age we computed, and the model is told to quote
 * only those strings. `timesAreQuoted` then checks the reply deterministically:
 * a clock time the model wrote must be one it was given.
 */

import { z } from "zod";

export const DEFAULT_TIME_ZONE = "Asia/Jakarta";

export interface TimeContext {
  /** IANA time zone, for example "Asia/Jakarta". */
  readonly timeZone: string;
  /** The moment the answer is produced. Ages are relative to this. */
  readonly now: Date;
}

/** A time as shown to the model and the owner: local text plus age. */
export const LocalTimeSchema = z
  .object({
    at: z.string().max(40),
    age: z.string().max(40),
  })
  .strict();
export type LocalTime = z.infer<typeof LocalTimeSchema>;

export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** "18 Nov 2026, 00:10 GMT+7" */
export function formatLocal(when: Date, timeZone: string): string {
  return formatter(timeZone).format(when);
}

/** "just now" (under a minute either way), "12 min ago", "8 h 41 min ago", "3 days ago", or "in 18 min". */
export function formatAge(when: Date, now: Date): string {
  const diffMs = now.getTime() - when.getTime();
  const future = diffMs < 0;
  const minutes = Math.floor(Math.abs(diffMs) / 60_000);
  let span: string;
  // A sub-minute gap either way is clock skew or rounding, not a future event.
  if (minutes < 1) return "just now";
  if (minutes < 60) span = `${minutes} min`;
  else if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    span = m === 0 ? `${h} h` : `${h} h ${m} min`;
  } else span = `${Math.floor(minutes / (24 * 60))} days`;
  return future ? `in ${span}` : `${span} ago`;
}

/** Format an ISO timestamp for the model and the owner. Null for null or unparsable input. */
export function localTime(iso: string | null, ctx: TimeContext): LocalTime | null {
  if (iso === null) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return { at: formatLocal(when, ctx.timeZone), age: formatAge(when, ctx.now) };
}

// ---------------------------------------------------------------------------
// Checking the reply
// ---------------------------------------------------------------------------

const ISO_DATETIME = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const UTC_WORD = /\bUTC\b|\bZulu\b/i;
/** 17:10, 5:10, 5:10 PM, 12:10 a.m. */
const CLOCK = /\b(\d{1,2}):([0-5]\d)(?:\s*([ap])\.?\s?m\.?)?(?![\d:])/gi;

/** Every clock time in `text`, normalised to 24-hour "HH:MM". */
export function clockTimes(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CLOCK)) {
    let hour = Number(m[1]);
    const minute = m[2] ?? "00";
    const meridiem = m[3]?.toLowerCase();
    if (meridiem !== undefined) {
      if (hour < 1 || hour > 12) continue;
      if (meridiem === "a" && hour === 12) hour = 0;
      if (meridiem === "p" && hour !== 12) hour += 12;
    }
    if (hour > 23) continue;
    out.push(`${String(hour).padStart(2, "0")}:${minute}`);
  }
  return out;
}

export type TimeCheck = { readonly ok: true } | { readonly ok: false; readonly offending: string };

/**
 * The reply may only state clock times that appear in what it was given, and
 * may never contain an ISO timestamp or the word UTC.
 */
export function timesAreQuoted(reply: string, givenText: string): TimeCheck {
  const iso = ISO_DATETIME.exec(reply);
  if (iso !== null) return { ok: false, offending: "iso-timestamp" };
  if (UTC_WORD.test(reply)) return { ok: false, offending: "utc" };
  const allowed = new Set(clockTimes(givenText));
  for (const t of clockTimes(reply)) {
    if (!allowed.has(t)) return { ok: false, offending: t };
  }
  return { ok: true };
}
