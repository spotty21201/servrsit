/**
 * Fact check of the assistant's reply (T-051).
 *
 * Before an AI answer is shown, the claims it makes are extracted and compared
 * with the same sanitized facts the model was given, server by server:
 *  - pending update counts, "up to date"
 *  - reboot required yes/no
 *  - failed services: count and unit names
 *  - disk, inode and memory percentages
 *  - status words: healthy, fresh, stale, unreachable
 *  - which server each claim is about
 * Any other number must be a fact of the server it is attributed to, a time,
 * a date, an age, a version that was in the data, or a plausible server count.
 *
 * Tone does not loosen anything (ADR-015 revised): a cheeky line is checked
 * like any other sentence.
 *
 * Attribution: the reply is cut into clauses. A clause that names a server is
 * about that server; a clause that names none is about the last-named server;
 * fleet words ("all servers", "everything") mean every server in scope. Before
 * any server is named, a single-server scope means that server and a fleet
 * scope means every server. When one clause names several servers, each claim
 * belongs to the nearest name, unless the clause says "both", "all", "each",
 * "neither" or "none".
 *
 * The checker is deliberately strict: a false alarm costs a deterministic
 * answer, a missed mismatch shows the owner a wrong fact. It reports only the
 * mismatch type, never the reply text.
 */

import type { AiServerInput } from "./input.js";

export const FACT_MISMATCHES = [
  "pending_updates",
  "reboot_required",
  "failed_services",
  "disk_percent",
  "inode_percent",
  "memory_percent",
  "status_word",
  "server_count",
  "unattributed_number",
] as const;
export type FactMismatch = (typeof FACT_MISMATCHES)[number];

export type FactCheck = { readonly ok: true } | { readonly ok: false; readonly mismatch: FactMismatch };

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  no: 0, zero: 0, none: 0,
  one: 1, "a single": 1, single: 1,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
/** "a"/"an" before a count noun: at least one. */
const AT_LEAST_ONE = -1;

const Q =
  "(\\d+|no|zero|none|a single|single|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|an?)";

function quantity(token: string): number {
  const t = token.toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  if (t === "a" || t === "an") return AT_LEAST_ONE;
  return WORD_NUMBERS[t] ?? Number.NaN;
}

function countMatches(claimed: number, actual: number | null): boolean {
  if (actual === null || Number.isNaN(claimed)) return false;
  return claimed === AT_LEAST_ONE ? actual >= 1 : claimed === actual;
}

// ---------------------------------------------------------------------------
// Claim patterns (run on a lower-cased clause)
// ---------------------------------------------------------------------------

const PENDING_COUNT = new RegExp(
  `\\b${Q}\\s+(?:(?:more|pending|available|outstanding|waiting|new|package|security|apt|software|system)\\s+){0,3}(?:updates?|upgrades?|packages?)\\b(?!\\s+lists?)`,
  "g",
);
const PENDING_COUNT_AFTER = /\b(?:updates?|upgrades?)\s*(?:pending|waiting|available)?\s*[:=]\s*(\d+)/g;
const PENDING_NONE = /(?:n't|\bnot|\bnever)\s+(?:have\s+|got\s+|need\s+|show\s+)?any\s+(?:\w+\s+){0,2}(?:updates?|upgrades?)\b/;
const PENDING_SOME = /\b(?:has|have|there (?:are|is)|with)\s+(?:some\s+)?(?:pending|available|outstanding|waiting)\s+(?:package\s+)?(?:updates?|upgrades?)\b/;
const UP_TO_DATE = /\bup[ -]to[ -]date\b/;

const FAILED_COUNT = new RegExp(
  `\\b${Q}\\s+(?:failed|failing|crashed|broken)\\s+(?:systemd\\s+)?(?:services?|units?)\\b`,
  "g",
);
const FAILED_COUNT_VERB = new RegExp(
  `\\b${Q}\\s+(?:systemd\\s+)?(?:services?|units?)\\s+(?:(?:have|has|are|is)\\s+)?(?:failed|failing|crashed|down)\\b`,
  "g",
);
const FAILED_NONE = /(?:n't|\bnot|\bnever)\s+(?:have\s+|show\s+)?any\s+(?:failed|failing|crashed|broken)\b/;
const UNIT_NAME = /\b[a-z0-9][a-z0-9@_:.-]*\.(?:service|socket|timer|mount|target|path|slice|scope)\b/g;
const FAIL_WORD = /\b(?:failed|failing|crashed|broken|not running|is down|are down)\b/;

const REBOOT_NEED =
  /\b(?:needs?|requires?|required|needed|need of|pending|waiting for|wants?)\s+(?:a\s+|an?\s+|to\s+)?(?:system\s+)?(?:reboot|restart of the (?:server|machine|system))\b|\breboot\s+(?:is\s+|isn't\s+|is not\s+|still\s+)*(?:required|needed|pending)\b|\bno\s+reboot\b/;
const NEGATION = /(?:\b(?:no|not|never|without|none|neither|nor|nothing)\b|n't)/;

const PERCENT = /\b(\d{1,3})\s?(?:%|percent\b)/g;
const STATUS_WORD = /\b(healthy|fresh|stale|unreachable)\b/g;
const STATUS_NEGATION = /(?:\b(?:not|never|no longer|isn't|aren't|wasn't|weren't)\b|n't)(?:\s+\w+){0,2}\s*$/;

// ---------------------------------------------------------------------------
// Spans that are not claims: times, dates, ages, versions, names
// ---------------------------------------------------------------------------

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const EXEMPT: readonly RegExp[] = [
  /\b\d{1,2}:[0-5]\d(?:\s*[ap]\.?\s?m\.?)?/g, // clock (checked by timesAreQuoted)
  new RegExp(`\\b\\d{1,2}\\s+${MONTH}(?:\\s+\\d{4})?`, "g"), // 18 Nov 2026
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`, "g"), // Nov 18, 2026
  /\b(?:19|20)\d{2}\b/g, // years
  /\bgmt\s?[+-]\s?\d{1,2}\b/g, // GMT+7
  /\b\d+\s*(?:min|mins|minutes?|h|hrs?|hours?|s|secs?|seconds?)\b(?:\s+\d+\s*(?:min|mins|minutes?)\b)?/g, // ages, windows
  /\b\d+\s+(?:days?|weeks?)\s+ago\b/g,
  /\bin\s+\d+\s+(?:days?|weeks?)\b/g,
];
const VERSION = /\b\d+(?:\.\d+)+\b/g;
const MOUNT_PATH = /(?:^|\s|\()(\/[a-z0-9/_.-]*)/g;
const DIGITS = /\b\d+\b/g;
const SERVER_NOUN = /^\s*(?:of\s+(?:(?:your|the|my)\s+)?(?:\d+\s+)?)?(?:servers?|machines?|hosts?|boxes)\b/;

const FLEET_WORD =
  /\b(?:all|every|each|both|none|neither|any)\s+(?:of\s+)?(?:your\s+|the\s+|my\s+|these\s+)?(?:\w+\s+)?(?:servers?|machines?|hosts?|boxes)\b|\b(?:your|the|whole)\s+fleet\b|\ball of them\b|\bacross the board\b/;
/** Fleet-wide only before any server is named; after that they mean the named server. */
const LOOSE_FLEET_WORD = /\beverything\b|\beverywhere\b|\ball good\b/;
const OTHER_WORD = /\b(?:the\s+)?(?:other|remaining|rest of the)\s+(?:\w+\s+)?(?:servers?|machines?|hosts?|ones?)\b/;
const ALL_NAMED_WORD = /\b(?:both|all|each|neither|none|either)\b/;

const CLAUSE_SPLIT = /[!?;\n]+|\.(?=\s|$)|,|\s[–—-]\s|\b(?:and|but|while|whereas|although|though|however)\b/;

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

interface ServerFacts {
  readonly name: string;
  readonly input: AiServerInput;
}

function failedCount(input: AiServerInput): number | null {
  const f = input.metrics?.failedUnits ?? null;
  return f === null ? null : f.names.length + f.unrecognisedCount;
}

function isHealthy(input: AiServerInput): boolean {
  const statusOk = input.status === "fresh" || input.status === "partial";
  const noBadFindings = input.findings.every((f) => f.severity === "advisory");
  const failed = failedCount(input);
  return statusOk && noBadFindings && (failed === null || failed === 0);
}

function statusWordHolds(word: string, input: AiServerInput): boolean {
  const failedReach =
    input.latestAttempt !== null &&
    !input.latestAttempt.succeeded &&
    (input.latestAttempt.failureCode === "ROUTE_UNAVAILABLE" || input.latestAttempt.failureCode === "TIMEOUT");
  switch (word) {
    case "healthy":
      return isHealthy(input);
    case "fresh":
      return input.status === "fresh" || input.status === "partial";
    case "stale":
      return input.status !== "fresh" && input.status !== "partial";
    case "unreachable":
      return input.status === "unreachable" || failedReach;
    default:
      return false;
  }
}

/** Every number the model was given for this server. */
function numericFacts(input: AiServerInput): Set<number> {
  const out = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (n !== null && n !== undefined) out.add(n);
  };
  const m = input.metrics;
  if (m !== null) {
    add(m.cpuCount);
    add(m.load1);
    add(m.memoryUsedPercent);
    add(m.uptimeDays);
    add(m.pendingUpdates);
    // T-062: "3 from Docker's repository", "0 from Ubuntu".
    if (m.pendingOutsideUbuntu !== null) {
      add(m.pendingOutsideUbuntu.count);
      if (m.pendingUpdates !== null) add(m.pendingUpdates - m.pendingOutsideUbuntu.count);
    }
    add(failedCount(input));
    for (const f of m.filesystems ?? []) add(f.usedPercent);
    for (const f of m.inodes ?? []) add(f.usedPercent);
    add(m.importantServicesFailed?.length);
  }
  if (input.coverage !== null) {
    add(input.coverage.passed);
    add(input.coverage.total);
    add(input.coverage.total - input.coverage.passed);
    add(input.coverage.unavailableChecks.length);
  }
  add(input.latestAttempt?.consecutiveFailures);
  add(input.findings.length);
  add(input.server.importantServices.length);
  return out;
}

/** Counts of servers that a reply could reasonably mention ("2 servers are fresh"). */
function plausibleServerCounts(servers: readonly ServerFacts[]): Set<number> {
  const predicates: Array<(i: AiServerInput) => boolean> = [
    (i) => (i.metrics?.pendingUpdates ?? 0) > 0,
    (i) => i.metrics?.pendingUpdates === 0,
    (i) => i.metrics?.rebootRequired === true,
    (i) => i.metrics?.rebootRequired === false,
    (i) => (failedCount(i) ?? 0) > 0,
    (i) => failedCount(i) === 0,
    (i) => i.server.production,
    (i) => !i.server.production,
    isHealthy,
    (i) => !isHealthy(i),
    (i) => i.metrics === null,
    (i) => i.metrics !== null,
    ...(["fresh", "stale", "unreachable", "partial"] as const).map((w) => (i: AiServerInput) => i.status === w || statusWordHolds(w, i)),
  ];
  const out = new Set<number>([servers.length]);
  for (const p of predicates) out.add(servers.filter((s) => p(s.input)).length);
  return out;
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

interface NameHit {
  readonly server: ServerFacts;
  readonly index: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameHits(clause: string, servers: readonly ServerFacts[]): NameHit[] {
  const hits: NameHit[] = [];
  const taken: Array<[number, number]> = [];
  const byLength = [...servers].sort((a, b) => b.name.length - a.name.length);
  for (const server of byLength) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(server.name.toLowerCase())}(?![a-z0-9])`, "g");
    for (const m of clause.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      hits.push({ server, index: start });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Blank out matched spans so later patterns do not see them again. */
function blank(text: string, re: RegExp): string {
  return text.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), (m) => " ".repeat(m.length));
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

interface Clause {
  readonly text: string;
  /** Servers each claim in this clause is about, as a function of the claim's position. */
  readonly subjectAt: (index: number) => readonly ServerFacts[];
  readonly explicit: boolean;
}

function clauses(reply: string, servers: readonly ServerFacts[]): Clause[] {
  const raw = reply.toLowerCase().split(CLAUSE_SPLIT).map((c) => c ?? "").filter((c) => c.trim().length > 0);
  const out: Clause[] = [];
  let subject: readonly ServerFacts[] = servers;
  let explicit = servers.length === 1;
  const named = new Set<ServerFacts>();
  let pendingList: ServerFacts[] | null = null;

  for (const text of raw) {
    const hits = nameHits(text, servers);
    const hasClaims = claimLike(text);
    if (OTHER_WORD.test(text) && hits.length === 0) {
      subject = servers.filter((s) => !named.has(s));
      explicit = true;
      out.push({ text, subjectAt: () => subject, explicit });
      pendingList = null;
      continue;
    }
    if (hits.length === 0 && (FLEET_WORD.test(text) || (named.size === 0 && LOOSE_FLEET_WORD.test(text)))) {
      subject = servers;
      explicit = true;
      out.push({ text, subjectAt: () => servers, explicit });
      pendingList = null;
      continue;
    }
    if (hits.length > 0) {
      for (const h of hits) named.add(h.server);
      const own = [...new Set(hits.map((h) => h.server))];
      explicit = true;
      if (pendingList !== null) {
        // "Nabire and Merauke have no failed services": a bare list before the claim.
        const all = [...new Set([...pendingList, ...own])];
        subject = all;
        out.push({ text, subjectAt: () => all, explicit });
      } else if (own.length > 1 && !ALL_NAMED_WORD.test(text)) {
        subject = own;
        out.push({
          text,
          subjectAt: (index) => {
            let best = hits[0] as NameHit;
            for (const h of hits) if (Math.abs(h.index - index) < Math.abs(best.index - index)) best = h;
            return [best.server];
          },
          explicit,
        });
      } else {
        subject = own;
        out.push({ text, subjectAt: () => own, explicit });
      }
      pendingList = hasClaims ? null : [...new Set([...(pendingList ?? []), ...own])];
      continue;
    }
    pendingList = null;
    const current = subject;
    out.push({ text, subjectAt: () => current, explicit });
  }
  return out;
}

function claimLike(text: string): boolean {
  return (
    /\d/.test(text) ||
    /\b(?:updates?|upgrades?|packages?|reboot|failed|failing|healthy|fresh|stale|unreachable|up[ -]to[ -]date|percent|services?|units?)\b/.test(text)
  );
}

function checkClause(clause: Clause, given: string, all: readonly ServerFacts[]): FactMismatch | null {
  let rest = clause.text;
  const every = (index: number, test: (input: AiServerInput) => boolean) =>
    clause.subjectAt(index).every((s) => test(s.input));

  // Names and paths first, so their digits are not read as claims.
  for (const s of all) rest = blank(rest, new RegExp(`(?<![a-z0-9])${escapeRegExp(s.name.toLowerCase())}(?![a-z0-9])`, "g"));

  // Unit names.
  for (const m of rest.matchAll(UNIT_NAME)) {
    const unit = m[0];
    const failedHere = FAIL_WORD.test(clause.text) && !NEGATION.test(clause.text);
    const ok = every(m.index ?? 0, (i) => {
      const failed = i.metrics?.failedUnits?.names ?? [];
      return failedHere ? failed.includes(unit) : failed.includes(unit) || i.server.importantServices.includes(unit);
    });
    if (!ok) return "failed_services";
  }
  rest = blank(rest, UNIT_NAME);

  // Mount paths; a mentioned mount narrows a percentage claim.
  const mounts: string[] = [];
  for (const m of rest.matchAll(MOUNT_PATH)) if (m[1] !== undefined) mounts.push(m[1].replace(/[.,)]+$/, ""));
  if (/\broot\b/.test(rest)) mounts.push("/");
  rest = rest.replace(MOUNT_PATH, (m) => " ".repeat(m.length));

  for (const re of EXEMPT) rest = blank(rest, re);

  // Versions: only ones that were in the data ("24.04").
  for (const m of rest.matchAll(VERSION)) {
    if (!given.includes(m[0])) return "unattributed_number";
  }
  rest = blank(rest, VERSION);

  // Pending updates.
  for (const m of rest.matchAll(PENDING_COUNT)) {
    const n = quantity(m[1] ?? "");
    if (!every(m.index ?? 0, (i) => countMatches(n, i.metrics?.pendingUpdates ?? null))) return "pending_updates";
  }
  rest = blank(rest, PENDING_COUNT);
  for (const m of rest.matchAll(PENDING_COUNT_AFTER)) {
    const n = quantity(m[1] ?? "");
    if (!every(m.index ?? 0, (i) => countMatches(n, i.metrics?.pendingUpdates ?? null))) return "pending_updates";
  }
  rest = blank(rest, PENDING_COUNT_AFTER);
  const noneIdx = rest.search(PENDING_NONE);
  if (noneIdx >= 0 && !every(noneIdx, (i) => i.metrics?.pendingUpdates === 0)) return "pending_updates";
  const someIdx = rest.search(PENDING_SOME);
  if (someIdx >= 0) {
    // "has pending updates" claims at least one; "neither has pending updates" claims none.
    const none = NEGATION.test(clause.text);
    const ok = every(someIdx, (i) => {
      const p = i.metrics?.pendingUpdates ?? null;
      return p !== null && (none ? p === 0 : p >= 1);
    });
    if (!ok) return "pending_updates";
  }
  const utdIdx = rest.search(UP_TO_DATE);
  if (utdIdx >= 0 && !NEGATION.test(rest.slice(0, utdIdx))) {
    if (!every(utdIdx, (i) => i.metrics?.pendingUpdates === 0)) return "status_word";
  }

  // Failed services.
  for (const re of [FAILED_COUNT, FAILED_COUNT_VERB]) {
    for (const m of rest.matchAll(re)) {
      const n = quantity(m[1] ?? "");
      if (!every(m.index ?? 0, (i) => countMatches(n, failedCount(i)))) return "failed_services";
    }
    rest = blank(rest, re);
  }
  const failedNoneIdx = rest.search(FAILED_NONE);
  if (failedNoneIdx >= 0 && !every(failedNoneIdx, (i) => failedCount(i) === 0)) return "failed_services";

  // Reboot required.
  const rebootIdx = rest.search(REBOOT_NEED);
  if (rebootIdx >= 0) {
    const claimed = !NEGATION.test(rest);
    if (!every(rebootIdx, (i) => i.metrics?.rebootRequired === claimed)) return "reboot_required";
  }

  // Percentages.
  for (const m of rest.matchAll(PERCENT)) {
    const n = Number(m[1]);
    const at = m.index ?? 0;
    let kind: FactMismatch;
    let test: (i: AiServerInput) => boolean;
    const pick = (list: ReadonlyArray<{ mount: string; usedPercent: number }> | null | undefined) => {
      if (list === null || list === undefined) return false;
      const narrowed = mounts.length > 0 ? list.filter((f) => mounts.includes(f.mount)) : list;
      return (narrowed.length > 0 ? narrowed : list).some((f) => f.usedPercent === n);
    };
    if (/\binodes?\b/.test(clause.text)) {
      kind = "inode_percent";
      test = (i) => pick(i.metrics?.inodes);
    } else if (/\b(?:memory|ram)\b/.test(clause.text)) {
      kind = "memory_percent";
      test = (i) => i.metrics?.memoryUsedPercent === n;
    } else if (/\b(?:disk|space|storage|filesystems?|full|partition|drive|volume)\b/.test(clause.text) || mounts.length > 0) {
      kind = "disk_percent";
      test = (i) => pick(i.metrics?.filesystems);
    } else {
      kind = "unattributed_number";
      test = (i) => numericFacts(i).has(n);
    }
    if (!every(at, test)) return kind;
  }
  rest = blank(rest, PERCENT);

  // Status words (positive statements only; "not fresh" is not checked).
  for (const m of rest.matchAll(STATUS_WORD)) {
    const at = m.index ?? 0;
    if (STATUS_NEGATION.test(rest.slice(0, at))) continue;
    if (!every(at, (i) => statusWordHolds(m[1] ?? "", i))) return "status_word";
  }

  // Every other number.
  for (const m of rest.matchAll(DIGITS)) {
    const n = Number(m[0]);
    const at = m.index ?? 0;
    const after = rest.slice(at + m[0].length);
    if (SERVER_NOUN.test(after)) {
      if (!plausibleServerCounts(all).has(n)) return "server_count";
      continue;
    }
    if (!clause.explicit && all.length > 1) return "unattributed_number";
    if (!every(at, (i) => numericFacts(i).has(n))) return "unattributed_number";
  }
  return null;
}

/**
 * Compare the claims in `reply` with the facts in `inputs`.
 * @param given the exact prompt the model received (versions must appear in it)
 */
export function checkFacts(reply: string, inputs: readonly AiServerInput[], given: string): FactCheck {
  const servers: ServerFacts[] = inputs.map((input) => ({ name: input.server.name, input }));
  if (servers.length === 0) return /\d/.test(reply) ? { ok: false, mismatch: "unattributed_number" } : { ok: true };
  for (const clause of clauses(reply, servers)) {
    const mismatch = checkClause(clause, given.toLowerCase(), servers);
    if (mismatch !== null) return { ok: false, mismatch };
  }
  return { ok: true };
}
