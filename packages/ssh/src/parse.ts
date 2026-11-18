/**
 * Deterministic parsers for collector output.
 *
 * No model is used to extract machine facts (Technical Spec §14). Every
 * parser is strict: output it does not recognise becomes `unavailable` with a
 * reason that we wrote, never a default value and never remote text.
 */

import {
  ok,
  unavailable,
  LIMITS,
  clockSkewed,
  isUbuntuArchiveOrigin,
  MAX_LISTED_OUTSIDE_UBUNTU,
  UNRECOGNISED_NAME,
  type Clock,
  type PendingOutsideUbuntu,
  type Field,
  type FailedUnit,
  type FilesystemEntry,
  type InodeEntry,
  type OsInfo,
} from "./schema.js";
import { isSafeUnitName, sanitizeLines, sanitizeText } from "./sanitize.js";
import { SECTION_NAMES } from "./sections.js";

// ---------------------------------------------------------------------------
// Section splitting
// ---------------------------------------------------------------------------

export interface RawSection {
  readonly name: string;
  readonly exitCode: number;
  /** Raw (not yet sanitised) section body. */
  readonly output: string;
  /** True when the body hit the per-section byte cap. */
  readonly truncated: boolean;
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split the combined output into sections.
 *
 * A boundary is recognised only when the full line is
 * `@@BEGIN <nonce> <name>@@` or `@@END <nonce> <name> <rc>@@` for a known
 * section name. Text inside a section that merely looks like a marker, but
 * lacks the per-run nonce, is ordinary data. A section without its END marker
 * (killed run, size cap) is not returned.
 */
export function splitSections(
  stdout: string,
  nonce: string,
  maxSectionBytes: number = LIMITS.maxSectionBytes,
): Map<string, RawSection> {
  const names = SECTION_NAMES.map(escapeForRegex).join("|");
  const begin = new RegExp(`^@@BEGIN ${nonce} (${names})@@$`);
  const end = new RegExp(`^@@END ${nonce} (${names}) (\\d{1,3})@@$`);

  const sections = new Map<string, RawSection>();
  let current: { name: string; chunks: string[]; bytes: number; truncated: boolean } | null =
    null;

  for (const line of stdout.split("\n")) {
    if (current === null) {
      const b = begin.exec(line);
      const name = b?.[1];
      if (name !== undefined && !sections.has(name)) {
        current = { name, chunks: [], bytes: 0, truncated: false };
      }
      continue;
    }
    const e = end.exec(line);
    if (e !== null && e[1] === current.name) {
      sections.set(current.name, {
        name: current.name,
        exitCode: Number(e[2]),
        output: current.chunks.join("\n"),
        truncated: current.truncated,
      });
      current = null;
      continue;
    }
    if (current.truncated) continue;
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;
    if (current.bytes + lineBytes > maxSectionBytes) {
      current.truncated = true;
      continue;
    }
    current.chunks.push(line);
    current.bytes += lineBytes;
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Section -> field plumbing
// ---------------------------------------------------------------------------

function exitReason(exitCode: number): string {
  if (exitCode === 127) return "command not found";
  if (exitCode === 126) return "command not executable";
  if (exitCode === 124) return "command timed out";
  return `command exited with status ${exitCode}`;
}

/** Apply `parse` to a section's sanitised lines, or explain why it cannot. */
export function fromSection<T>(
  section: RawSection | undefined,
  parse: (lines: string[], section: RawSection) => Field<T>,
): Field<T> {
  if (section === undefined) return unavailable("collector output incomplete");
  if (section.truncated) return unavailable("output exceeded size limit");
  if (section.exitCode !== 0) return unavailable(exitReason(section.exitCode));
  try {
    return parse(sanitizeLines(section.output), section);
  } catch {
    return unavailable("output could not be parsed");
  }
}

function nonEmpty(lines: string[]): string[] {
  return lines.filter((l) => l.length > 0);
}

function safeInt(text: string): number | null {
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------------------
// inspect.host.v1
// ---------------------------------------------------------------------------

export function parseHostname(lines: string[]): Field<string> {
  const first = nonEmpty(lines)[0];
  if (first === undefined) return unavailable("no hostname reported");
  return ok(sanitizeText(first, 255));
}

export function parseOsRelease(lines: string[]): Field<OsInfo> {
  const kv = new Map<string, string>();
  for (const line of lines) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m?.[1] === undefined || m[2] === undefined) continue;
    let value = m[2];
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    kv.set(m[1], value);
  }
  const id = kv.get("ID");
  const prettyName = kv.get("PRETTY_NAME");
  if (id === undefined || prettyName === undefined) {
    return unavailable("ID or PRETTY_NAME missing from os-release");
  }
  const versionId = kv.get("VERSION_ID");
  return ok({
    id: sanitizeText(id, 64),
    prettyName: sanitizeText(prettyName, 128),
    versionId: versionId === undefined ? null : sanitizeText(versionId, 32),
  });
}

export function parseArchitecture(lines: string[]): Field<string> {
  const first = nonEmpty(lines)[0];
  if (first === undefined || !/^[A-Za-z0-9_.-]{1,32}$/.test(first)) {
    return unavailable("unrecognised architecture string");
  }
  return ok(first);
}

export function parseBootId(lines: string[]): Field<string> {
  const first = nonEmpty(lines)[0]?.toLowerCase();
  if (first === undefined || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(first)) {
    return unavailable("boot id not in expected format");
  }
  return ok(first);
}

export function parseUptime(lines: string[]): Field<number> {
  const first = nonEmpty(lines)[0];
  const m = first === undefined ? null : /^(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?$/.exec(first);
  if (m?.[1] === undefined) return unavailable("uptime not in expected format");
  const seconds = Number(m[1]);
  return Number.isFinite(seconds) ? ok(seconds) : unavailable("uptime not a finite number");
}

export function parseLoad(
  lines: string[],
): Field<{ one: number; five: number; fifteen: number }> {
  const first = nonEmpty(lines)[0];
  const m =
    first === undefined
      ? null
      : /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+\d+\/\d+\s+\d+$/.exec(first);
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) {
    return unavailable("load average not in expected format");
  }
  return ok({ one: Number(m[1]), five: Number(m[2]), fifteen: Number(m[3]) });
}

export function parseCpuCount(lines: string[]): Field<number> {
  const first = nonEmpty(lines)[0];
  const n = first !== undefined && /^\d{1,5}$/.test(first) ? Number(first) : 0;
  return n > 0 ? ok(n) : unavailable("cpu count not in expected format");
}

export function parseMeminfo(
  lines: string[],
): Field<{ totalKib: number; availableKib: number; swapTotalKib: number; swapFreeKib: number }> {
  const kv = new Map<string, number>();
  for (const line of lines) {
    const m = /^([A-Za-z_()0-9]+):\s+(\d+)(?:\s+kB)?$/.exec(line);
    if (m?.[1] === undefined || m[2] === undefined) continue;
    const n = safeInt(m[2]);
    if (n !== null) kv.set(m[1], n);
  }
  const wanted = ["MemTotal", "MemAvailable", "SwapTotal", "SwapFree"] as const;
  const missing = wanted.filter((k) => !kv.has(k));
  if (missing.length > 0) return unavailable(`missing from meminfo: ${missing.join(", ")}`);
  return ok({
    totalKib: kv.get("MemTotal") ?? 0,
    availableKib: kv.get("MemAvailable") ?? 0,
    swapTotalKib: kv.get("SwapTotal") ?? 0,
    swapFreeKib: kv.get("SwapFree") ?? 0,
  });
}

const DF_ROW = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\/.*)$/;

export function parseDf(
  lines: string[],
): Field<{ entries: FilesystemEntry[]; skippedLineCount: number }> {
  const entries: FilesystemEntry[] = [];
  let skipped = 0;
  for (const line of nonEmpty(lines)) {
    if (/^Filesystem\s/.test(line)) continue;
    const m = DF_ROW.exec(line);
    const size = m?.[2] === undefined ? null : safeInt(m[2]);
    const used = m?.[3] === undefined ? null : safeInt(m[3]);
    const avail = m?.[4] === undefined ? null : safeInt(m[4]);
    const pct = m?.[5] === undefined ? null : safeInt(m[5]);
    if (
      m?.[1] === undefined || m[6] === undefined ||
      size === null || used === null || avail === null || pct === null ||
      size === 0 || pct > 100 || entries.length >= LIMITS.maxFilesystems
    ) {
      skipped += 1;
      continue;
    }
    entries.push({
      filesystem: sanitizeText(m[1], 128),
      mount: sanitizeText(m[6], 256),
      sizeKib: size,
      usedKib: used,
      availKib: avail,
      usedPercent: pct,
    });
  }
  if (entries.length === 0) return unavailable("no parsable filesystem rows");
  return ok({ entries, skippedLineCount: skipped });
}

export function parseDfInodes(
  lines: string[],
): Field<{ entries: InodeEntry[]; skippedLineCount: number }> {
  const entries: InodeEntry[] = [];
  let skipped = 0;
  for (const line of nonEmpty(lines)) {
    if (/^Filesystem\s/.test(line)) continue;
    const m = DF_ROW.exec(line);
    const total = m?.[2] === undefined ? null : safeInt(m[2]);
    const used = m?.[3] === undefined ? null : safeInt(m[3]);
    const free = m?.[4] === undefined ? null : safeInt(m[4]);
    const pct = m?.[5] === undefined ? null : safeInt(m[5]);
    if (
      m?.[1] === undefined || m[6] === undefined ||
      total === null || used === null || free === null || pct === null ||
      total === 0 || pct > 100 || entries.length >= LIMITS.maxFilesystems
    ) {
      skipped += 1;
      continue;
    }
    entries.push({
      filesystem: sanitizeText(m[1], 128),
      mount: sanitizeText(m[6], 256),
      inodes: total,
      inodesUsed: used,
      inodesFree: free,
      usedPercent: pct,
    });
  }
  if (entries.length === 0) return unavailable("no parsable inode rows");
  return ok({ entries, skippedLineCount: skipped });
}

// ---------------------------------------------------------------------------
// inspect.services.v1
// ---------------------------------------------------------------------------

const FAILED_UNIT_ROW =
  /^(\S+)\s+(loaded|not-found|masked|error|bad-setting|stub|merged)\s+(failed|activating|auto-restart|inactive|active|deactivating|maintenance)\s+(\S+)(?:\s.*)?$/;

/**
 * `systemctl --failed --no-legend --plain`. The free-text description column
 * is deliberately discarded: it is attacker-influenced and not needed.
 */
export function parseFailedUnits(
  lines: string[],
): Field<{ units: FailedUnit[]; unparsedLineCount: number }> {
  const units: FailedUnit[] = [];
  let unparsed = 0;
  for (const line of nonEmpty(lines)) {
    const m = FAILED_UNIT_ROW.exec(line);
    if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined || m[4] === undefined) {
      unparsed += 1;
      continue;
    }
    if (units.length >= LIMITS.maxFailedUnits) {
      unparsed += 1;
      continue;
    }
    const unit = sanitizeText(m[1], 256);
    units.push({
      unit,
      nameValid: isSafeUnitName(unit),
      load: m[2],
      active: m[3],
      sub: sanitizeText(m[4], 32),
    });
  }
  return ok({ units, unparsedLineCount: unparsed });
}

// ---------------------------------------------------------------------------
// inspect.packages.v1
// ---------------------------------------------------------------------------

const APT_SUMMARY =
  /^(\d+) upgraded, (\d+) newly installed, (\d+) to remove and (\d+) not upgraded\.?$/;

export interface AptSimulation {
  readonly pendingCount: number;
  readonly heldBackCount: number;
  /** T-062: pending updates from outside Ubuntu's archive (count, and the first 50 by name). */
  readonly outsideUbuntu: { readonly count: number; readonly packages: PendingOutsideUbuntu[] };
}

/** `Inst name [old] (new ORIGIN [arch])`; the origin may contain spaces ("Docker CE:noble"). */
const APT_INST = /^Inst\s+(\S+)\s+(?:\[[^\]]*\]\s+)?\((\S+)\s+(.+?)\s+\[[^\]]+\]\)/;
const DEB_PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]{0,99}$/;
const ORIGIN_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:\/,+~-]{0,63}$/;

/** Classify one `Inst` line. Anything not clearly from Ubuntu's archive counts as outside it. */
function instOrigin(line: string): { inUbuntu: boolean; entry: PendingOutsideUbuntu } {
  const m = APT_INST.exec(line);
  const rawName = m?.[1] ?? "";
  const rawOrigin = m === null || m[3] === undefined ? "" : sanitizeText(m[3], 64);
  const name = DEB_PACKAGE_NAME.test(rawName) ? rawName : UNRECOGNISED_NAME;
  const origin = ORIGIN_LABEL.test(rawOrigin) ? rawOrigin : UNRECOGNISED_NAME;
  // A line that does not fully parse is not clearly from Ubuntu, whatever origin it claims.
  const inUbuntu = name !== UNRECOGNISED_NAME && origin !== UNRECOGNISED_NAME && isUbuntuArchiveOrigin(origin);
  return { inUbuntu, entry: { name, origin } };
}

/**
 * Parse `apt-get -s upgrade`. The count of `Inst` lines is cross-checked
 * against APT's own summary line so that a forged or truncated list cannot
 * silently become "0 pending".
 */
export function parseAptSimulation(lines: string[]): Field<AptSimulation> {
  let inst = 0;
  let outsideCount = 0;
  const outside: PendingOutsideUbuntu[] = [];
  let summary: RegExpExecArray | null = null;
  for (const line of lines) {
    if (/^Inst\s+\S+/.test(line)) {
      inst += 1;
      const o = instOrigin(line);
      if (!o.inUbuntu) {
        outsideCount += 1;
        if (outside.length < MAX_LISTED_OUTSIDE_UBUNTU) outside.push(o.entry);
      }
    }
    const s = APT_SUMMARY.exec(line);
    if (s !== null) summary = s;
  }
  if (summary?.[1] === undefined || summary[2] === undefined || summary[4] === undefined) {
    return unavailable("apt summary line not found");
  }
  const upgraded = Number(summary[1]);
  const added = Number(summary[2]);
  if (upgraded + added !== inst) return unavailable("apt output inconsistent with its summary");
  return ok({ pendingCount: inst, heldBackCount: Number(summary[4]), outsideUbuntu: { count: outsideCount, packages: outside } });
}

/**
 * `date +%s` on the target, read during a collection that ServrSit timed from
 * `started` to `finished` (T-061). The target read its clock somewhere in that
 * window, so the skew is measured against the window's midpoint and the
 * uncertainty is half the window plus the one-second resolution.
 */
export function parseClock(lines: string[], started: Date, finished: Date): Field<Clock> {
  const first = nonEmpty(lines)[0]?.trim();
  if (first === undefined || !/^\d{1,12}$/.test(first)) return unavailable("target time not in expected format");
  const targetEpochSeconds = Number(first);
  if (targetEpochSeconds <= 0) return unavailable("target time not in expected format");
  const windowMs = Math.max(0, finished.getTime() - started.getTime());
  const midpointMs = started.getTime() + windowMs / 2;
  return ok({
    targetEpochSeconds,
    // `|| 0` turns a rounded -0 into 0.
    skewSeconds: Math.round((targetEpochSeconds * 1000 - midpointMs) / 1000) || 0,
    uncertaintySeconds: Math.ceil(windowMs / 2000) + 1,
  });
}

/**
 * Put a time the TARGET's clock wrote into ServrSit's time (T-061). Corrected
 * only when the measured skew is beyond the tolerance; unverified when the
 * clock could not be read.
 */
export function correctTargetTime(
  stamp: Field<string>,
  clock: Field<Clock>,
): { stamp: Field<string>; basis: "in-sync" | "corrected" | "unverified" } {
  if (clock.status !== "ok") return { stamp, basis: "unverified" };
  if (!clockSkewed(clock.value)) return { stamp, basis: "in-sync" };
  if (stamp.status !== "ok") return { stamp, basis: "corrected" };
  const corrected = new Date(Date.parse(stamp.value) - clock.value.skewSeconds * 1000);
  return { stamp: ok(corrected.toISOString()), basis: "corrected" };
}

export function parseAptStamp(lines: string[], now: Date): Field<string> {
  const first = nonEmpty(lines)[0];
  const epoch = first !== undefined && /^\d{1,12}$/.test(first) ? Number(first) : 0;
  const ms = epoch * 1000;
  if (epoch <= 0 || ms > now.getTime() + 24 * 60 * 60 * 1000) {
    return unavailable("apt update timestamp not in expected format");
  }
  return ok(new Date(ms).toISOString());
}

/** `test -e /var/run/reboot-required`: 0 present, 1 absent, anything else unknown. */
export function rebootRequiredFrom(section: RawSection | undefined): Field<boolean> {
  if (section === undefined) return unavailable("collector output incomplete");
  if (section.exitCode === 0) return ok(true);
  if (section.exitCode === 1) return ok(false);
  return unavailable(exitReason(section.exitCode));
}
