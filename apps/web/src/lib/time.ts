/**
 * time — the ONE module that formats times for the UI (T-052).
 *
 * Every time shown to the owner is rendered in the owner's time zone
 * (`ownerTimeZone` from /api/fleet), never the browser's. Locale is fixed
 * ("en-GB", 24-hour) so output does not change between devices.
 *
 * Where a clock time stands alone it carries a short zone label ("09:42 WIB");
 * pair it with a relative age ("3 min ago") so the owner can read either.
 * Pure functions: `now` is always passed in.
 */

export const DEFAULT_OWNER_TIME_ZONE = "Asia/Jakarta";

const LOCALE = "en-GB";

/** Indonesian zones have no CLDR abbreviation in en-GB ("GMT+7"), so name them. */
const ZONE_LABELS: Readonly<Record<string, string>> = {
  "Asia/Jakarta": "WIB",
  "Asia/Pontianak": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
  UTC: "UTC",
  "Etc/UTC": "UTC",
};

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The API value if it is a usable IANA zone, otherwise the default. */
export function resolveTimeZone(tz: string | null | undefined): string {
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_OWNER_TIME_ZONE;
}

/** "WIB", "UTC", or Intl's short name ("GMT+1", "CET") at the given moment. */
export function zoneLabel(tz: string, at: Date): string {
  const known = ZONE_LABELS[tz];
  if (known) return known;
  const part = new Intl.DateTimeFormat(LOCALE, { timeZone: tz, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}

function ymd(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function hhmm(d: Date, tz: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

function dayMonth(d: Date, tz: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: tz, day: "numeric", month: "short" }).format(d);
}

/**
 * "09:42" for a time on the owner's current day, otherwise "16 Nov 09:42".
 * `withZone` appends the zone label: "09:42 WIB".
 */
export function formatClock(d: Date, now: Date, tz: string, withZone = true): string {
  const zone = resolveTimeZone(tz);
  const time = hhmm(d, zone);
  const text = ymd(d, zone) === ymd(now, zone) ? time : `${dayMonth(d, zone)} ${time}`;
  return withZone ? `${text} ${zoneLabel(zone, d)}` : text;
}

/**
 * "just now", "4 min ago", "2 h ago", or a dated clock time for 24 h or more.
 * `uncertain` (ServrSit's own clock is not trusted) prefixes ages with "≈ ".
 * Dated clock times are not ages and are left alone.
 */
export function formatRelative(d: Date, now: Date, tz: string, uncertain = false): string {
  const mark = (t: string): string => (uncertain ? `≈ ${t}` : t);
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 0) return formatClock(d, now, tz); // clock skew: don't claim the future
  if (sec < 45) return mark("just now");
  const min = Math.round(sec / 60);
  if (min < 60) return mark(`${min} min ago`);
  const h = Math.round(min / 60);
  if (h < 24) return mark(`${h} h ago`);
  return formatClock(d, now, tz);
}

/** Standalone time plus age: "09:42 WIB (3 min ago)". Past-24h times already read as a date. */
export function formatClockWithAge(d: Date, now: Date, tz: string, uncertain = false): string {
  const rel = formatRelative(d, now, tz, uncertain);
  const clock = formatClock(d, now, tz);
  return rel === clock ? clock : `${clock} (${rel})`;
}

/** Parse an ISO string; null when missing or invalid. */
export function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "09:42:10" in the owner zone, for step lists and logs where seconds matter. */
export function formatTimeSeconds(d: Date, tz: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: resolveTimeZone(tz), hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(d);
}

/** Time until `d`: "in 12 min", "in 45 s", or "expired". Not announced per second. */
export function formatUntil(d: Date, now: Date, uncertain = false): string {
  const mark = (t: string): string => (uncertain ? `≈ ${t}` : t);
  const sec = Math.round((d.getTime() - now.getTime()) / 1000);
  if (sec <= 0) return mark("expired");
  if (sec < 60) return mark(`in ${sec} s`);
  const min = Math.round(sec / 60);
  if (min < 60) return mark(`in ${min} min`);
  return mark(`in ${Math.round(min / 60)} h`);
}
