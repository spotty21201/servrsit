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
  "held_back",
  "out_of_scope",
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
/** T-064 F2: "up to date apart from one waiting update" states an exception, not zero. */
const EXCEPTION_AFTER = /^.{0,12}?\b(?:apart from|except(?: for)?|other than|but for|besides|save for|aside from)\b/;
/** T-064 F3: other ways to say "nothing pending". */
const ZERO_PENDING =
  /\bfully patched\b|\ball patched\b|\b(?:all )?caught up\b|\bnothing (?:is |else )?(?:waiting|pending|left|queued)(?: to be (?:installed|updated|upgraded))?\b|\bnothing (?:to|needs to be) (?:update|upgrade|install|patch)d?\b|\b(?:packages?|software|everything|it|they)(?: \w+){0,3} (?:are|is) (?:all )?(?:current|on the latest versions?)\b|\bon the latest versions?\b|\b(?:is|are) (?:all )?current\b(?!\s+(?:state|status|check|time|load|version|data))|\bclean on updates\b|\bupdates?\s*:\s*(?:none|0|zero)\b|\b(?:don't|do not|doesn't|does not) need (?:to )?(?:be )?(?:update|updating|upgrade|upgrading)\b/;
/** T-064 F2: held-back packages are not pending updates. */
const HELD_COUNT = new RegExp(
  `\\b${Q}\\s+(?:\\w+\\s+){0,2}?(?:packages?|updates?|upgrades?)\\s+(?:(?:is|are|was|were|being|still)\\s+){0,2}(?:held|kept)\\s*back\\b`,
  "g",
);
const HELD_COUNT_AFTER = /\b(?:held|kept)[- ]back(?:\s+(?:packages?|updates?))?\s*[:=]\s*(\d+)/g;
/** T-064 F3: other ways to call a server healthy. Checked like "healthy". */
const HEALTHY_LIKE =
  /\b(?:is|are|looks?|seems?|all|running)\s+(?:fine|good|ok|okay|great|normal|normally|smoothly)\b|\bhas no (?:problems|issues)\b|\bnothing (?:is )?wrong\b|\ball good\b/g;
/** "two of them", "most of the servers": a count of servers, not a claim about each. */
const QUANTIFIED =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|some|several|most|few|many|half)\s+of\s+(?:them|these|those|(?:the|your|my)\s+(?:\w+\s+)?(?:servers|machines|hosts))\b/;
/** "Sentani has six", "Timika and Merauke have none": the noun is the previous claim's. */
const ELLIPSIS = /(?:\bha(?:s|ve)|:)\s+(\d+|no|zero|none|one|two|three|four|five|six|seven|eight|nine|ten)\s*$/;
/** "none pending", "one waiting": a pending count without the noun. */
const PENDING_ADJ = new RegExp(`\\b${Q}\\s+(?:pending|waiting|outstanding)\\b`, "g");
/** "is up", "up and running": the latest check reached the server. */
const IS_UP = /\b(?:is|are) up\b(?!\s+(?:to|for|by))|\bup and running\b/g;
/** List numbering at the start of a line is not a claim. */
const LIST_MARKER = /^\s*\d{1,2}[.)]\s+/gm;

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
const LOOSE_FLEET_WORD = /\beverything\b|\beverywhere\b|\ball good\b|\bon each\b|\bfor each\b|\beach of them\b|\ball (?:\d+|two|three|four|five|six|seven|eight|nine|ten)\b/;
const OTHER_WORD = /\b(?:the\s+)?(?:other|remaining|rest of the)\s+(?:\w+\s+)?(?:servers?|machines?|hosts?|ones?)\b/;
const ALL_NAMED_WORD = /\b(?:both|all|each|neither|none|either)\b/;


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
    add(m.heldBack);
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

/** State carried from clause to clause while checking one reply. */
interface Memo {
  /** The kind of the last counted claim, for "Sentani has six". */
  lastKind: "pending" | "held" | "failed" | null;
}

const SENTENCE_SPLIT = /[!?;\n]+|\.(?=\s|$)/;
// Joining words split clauses only as whole words: never inside "instructions-and-reply.service".
const WITHIN_SENTENCE = /,|\s[–—-]\s|(?<![\w-])(?:and(?! running\b)|but|while|whereas|although|though|however)(?![\w-])/;

function clauses(reply: string, servers: readonly ServerFacts[]): Clause[] {
  // T-064 F2: a bare list of names ("Nabire and Merauke are quiet") never carries into the next sentence.
  const raw: Array<{ text: string; sentenceStart: boolean; sentenceNames: readonly ServerFacts[] }> = [];
  for (const sentence of reply.toLowerCase().split(SENTENCE_SPLIT)) {
    let first = true;
    const sentenceNames = [...new Set(nameHits(sentence, servers).map((h) => h.server))];
    for (const part of sentence.split(WITHIN_SENTENCE)) {
      if (part === undefined || part.trim().length === 0) continue;
      raw.push({ text: part, sentenceStart: first, sentenceNames });
      first = false;
    }
  }
  const out: Clause[] = [];
  let subject: readonly ServerFacts[] = servers;
  let explicit = servers.length === 1;
  const named = new Set<ServerFacts>();
  let pendingList: ServerFacts[] | null = null;

  for (const { text, sentenceStart, sentenceNames } of raw) {
    if (sentenceStart) pendingList = null;
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
    // T-064 F2: "Its last attempt ... so treat Sentani as unchecked": a nameless clause is about the
    // server its own sentence names, unless the carried subject is already one of them.
    if (sentenceNames.length > 0 && !subject.every((s) => sentenceNames.includes(s))) {
      subject = sentenceNames;
      explicit = true;
    }
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

function checkClause(clause: Clause, given: string, all: readonly ServerFacts[], memo: Memo): FactMismatch | null {
  let rest = clause.text;
  const every = (index: number, test: (input: AiServerInput) => boolean) =>
    clause.subjectAt(index).every((s) => test(s.input));

  // T-064 F2: "two of them have pending updates" is a count of servers, not a claim about each.
  const quantified = QUANTIFIED.exec(rest);
  if (quantified !== null) {
    const n = quantity(quantified[1] ?? "");
    if (!Number.isNaN(n) && n !== AT_LEAST_ONE && !plausibleServerCounts(all).has(n)) return "server_count";
    return null;
  }

  // Names and paths first, so their digits are not read as claims.
  for (const s of all) rest = blank(rest, new RegExp(`(?<![a-z0-9])${escapeRegExp(s.name.toLowerCase())}(?![a-z0-9])`, "g"));

  // Unit names.
  for (const m of rest.matchAll(UNIT_NAME)) {
    const unit = m[0];
    const failedHere = FAIL_WORD.test(clause.text) && !NEGATION.test(clause.text);
    const ok = every(m.index ?? 0, (i) => {
      // The clause is lower-cased; unit names are compared the same way.
      const failed = (i.metrics?.failedUnits?.names ?? []).map((n) => n.toLowerCase());
      const important = i.server.importantServices.map((n) => n.toLowerCase());
      return failedHere ? failed.includes(unit) : failed.includes(unit) || important.includes(unit);
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

  // Decimals and versions. T-064 F3: checked per server: a load must be that server's load, a
  // version must be in that server's OS name.
  for (const m of rest.matchAll(VERSION)) {
    const tok = m[0];
    const ok = every(m.index ?? 0, (i) => numericFacts(i).has(Number(tok)) || (i.metrics?.os ?? "").toLowerCase().includes(tok));
    if (!ok && !(clause.subjectAt(m.index ?? 0).length === all.length && given.includes(tok) && !/^\d+\.\d+$/.test(tok))) {
      return "unattributed_number";
    }
  }
  rest = blank(rest, VERSION);

  // T-064 F2: held-back packages first, so "one package is held back" is not read as pending.
  for (const re of [HELD_COUNT, HELD_COUNT_AFTER]) {
    for (const m of rest.matchAll(re)) {
      const n = quantity(m[1] ?? "");
      if (!every(m.index ?? 0, (i) => countMatches(n, i.metrics?.heldBack ?? null))) return "held_back";
      memo.lastKind = "held";
    }
    rest = blank(rest, re);
  }

  // Pending updates.
  for (const m of rest.matchAll(PENDING_COUNT)) {
    memo.lastKind = "pending";
    const n = quantity(m[1] ?? "");
    if (!every(m.index ?? 0, (i) => countMatches(n, i.metrics?.pendingUpdates ?? null))) return "pending_updates";
  }
  rest = blank(rest, PENDING_COUNT);
  for (const m of rest.matchAll(PENDING_COUNT_AFTER)) {
    const n = quantity(m[1] ?? "");
    if (!every(m.index ?? 0, (i) => countMatches(n, i.metrics?.pendingUpdates ?? null))) return "pending_updates";
  }
  rest = blank(rest, PENDING_COUNT_AFTER);
  for (const m of rest.matchAll(PENDING_ADJ)) {
    memo.lastKind = "pending";
    const n = quantity(m[1] ?? "");
    if (!every(m.index ?? 0, (i) => countMatches(n, i.metrics?.pendingUpdates ?? null))) return "pending_updates";
  }
  rest = blank(rest, PENDING_ADJ);
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
  const utdException = utdIdx >= 0 && EXCEPTION_AFTER.test(rest.slice(utdIdx + 10));
  if (utdIdx >= 0 && !utdException && !NEGATION.test(rest.slice(0, utdIdx))) {
    if (!every(utdIdx, (i) => i.metrics?.pendingUpdates === 0)) return "status_word";
  }
  // T-064 F3: "fully patched", "nothing to update", "on the latest versions" claim zero pending.
  const zero = ZERO_PENDING.exec(rest);
  if (zero !== null && !/(?:\bnot|n't)\s+(?:\w+\s+)?$/.test(rest.slice(0, zero.index))) {
    if (!every(zero.index, (i) => i.metrics?.pendingUpdates === 0)) return "pending_updates";
    memo.lastKind = "pending";
  }

  // Failed services.
  for (const re of [FAILED_COUNT, FAILED_COUNT_VERB]) {
    for (const m of rest.matchAll(re)) {
      memo.lastKind = "failed";
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

  // Status words. T-064 F3: a negated one is checked too ("Timika is not healthy" must be true).
  for (const m of rest.matchAll(STATUS_WORD)) {
    const at = m.index ?? 0;
    const before = rest.slice(0, at);
    // "is not healthy" is a claim that must be true; other negation nearby ("doesn't match the
    // unreachable status") makes the claim unclear, so it is not checked either way.
    const copularNegation = /(?:\b(?:is|are|was|were)\s+(?:not|no longer|never)|\b(?:isn't|aren't|wasn't|weren't))(?:\s+\w+)?\s*$/.test(before);
    if (!copularNegation && STATUS_NEGATION.test(before)) continue;
    if (!every(at, (i) => statusWordHolds(m[1] ?? "", i) !== copularNegation)) return "status_word";
  }
  // T-064 F3: "is up", "up and running": the latest check must have reached it.
  for (const m of rest.matchAll(IS_UP)) {
    if (/(?:\bnot|n't)\s*$/.test(rest.slice(0, m.index ?? 0))) continue;
    if (!every(m.index ?? 0, (i) => i.latestAttempt?.succeeded === true)) return "status_word";
  }
  rest = blank(rest, IS_UP);
  // T-064 F3: "is fine", "looks good" are health claims.
  for (const m of rest.matchAll(HEALTHY_LIKE)) {
    const at = m.index ?? 0;
    if (/(?:\bnot|n't|\bnever)\s*(?:\w+\s+)?$/.test(rest.slice(0, at)) || /\bnot\b/.test(m[0])) continue;
    // "Load and memory are fine" is about those metrics, not a claim that the whole server is healthy.
    if (/\b(?:load|memory|ram|cpu|disk|space|uptime|swap|network|inodes?|services?|checks?|else)\b/.test(rest.slice(0, at))) continue;
    if (!every(at, (i) => statusWordHolds("healthy", i))) return "status_word";
  }
  rest = blank(rest, HEALTHY_LIKE);

  // T-064 F3: "Sentani has six", "Timika and Merauke have none": the previous claim's noun.
  const ellipsis = ELLIPSIS.exec(rest);
  // No earlier noun: "Nabire has none." cannot be checked, so it is not shown.
  if (ellipsis !== null && memo.lastKind === null && /^(?:none|no|zero)$/.test(ellipsis[1] ?? "")) return "unattributed_number";
  if (ellipsis !== null && memo.lastKind !== null) {
    const n = quantity(ellipsis[1] ?? "");
    const at = ellipsis.index;
    const metric = (i: AiServerInput) =>
      memo.lastKind === "pending" ? i.metrics?.pendingUpdates ?? null : memo.lastKind === "held" ? i.metrics?.heldBack ?? null : failedCount(i);
    if (!every(at, (i) => countMatches(n, metric(i)))) {
      return memo.lastKind === "pending" ? "pending_updates" : memo.lastKind === "held" ? "held_back" : "failed_services";
    }
    rest = rest.slice(0, at);
  }

  // Every other number.
  for (const m of rest.matchAll(DIGITS)) {
    const n = Number(m[0]);
    const at = m.index ?? 0;
    const after = rest.slice(at + m[0].length);
    const allN = /\ball\s+$/.test(rest.slice(0, at)) && /^\s*(?:(?:were|are|have|of them)\b|$)/.test(after);
    if (SERVER_NOUN.test(after) || allN) {
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
/**
 * T-064 F3: a claim about a server whose facts were not given ("Timika has no
 * failed services" when only Nabire is in scope). A capitalised name, not one
 * of the servers given and not an ordinary word, as the subject of a factual
 * verb, in a sentence that makes a claim.
 */
const NOT_A_SERVER = new Set(
  ("It Its This That These Those There They Their Everything Nothing Something All Both Each Every Neither None Either No " +
    "Your You The A An And But So Also Yes Note Overall Today Right Now Load Disk Memory Uptime Inodes Updates Update Packages " +
    "Package Checks Check Reboot Ubuntu Docker Debian ServrSit Coverage Status Services Service Kernel Pending Held " +
    "Inode Cpu Swap Root Usage Use Space Storage Filesystem Network System Server Servers Machine Host Fleet Plan Approval").split(" ").map((w) => w.toLowerCase()),
);
const SUBJECT_VERB = /\b([A-Z][a-z]{2,})(?:'s)?\s+(?:has|have|is|are|was|were|needs?|shows?|reports?|runs?|uses?)\b/g;

function outOfScope(reply: string, servers: readonly ServerFacts[]): boolean {
  const known = new Set(servers.map((s) => s.name.toLowerCase()));
  for (const sentence of reply.split(SENTENCE_SPLIT)) {
    const lower = sentence.toLowerCase();
    if (!claimLike(lower)) continue;
    const namesKnown = nameHits(lower, servers).length > 0;
    for (const m of sentence.matchAll(SUBJECT_VERB)) {
      const word = (m[1] ?? "").toLowerCase();
      const stem = word.endsWith("s") ? word.slice(0, -1) : word;
      if (NOT_A_SERVER.has(word) || NOT_A_SERVER.has(stem) || known.has(word)) continue;
      // A capital at the start of a sentence is ordinary English unless the sentence names no server.
      const sentenceInitial = sentence.slice(0, m.index ?? 0).trim().length === 0;
      if (!sentenceInitial || !namesKnown) return true;
    }
  }
  return false;
}

export function checkFacts(reply: string, inputs: readonly AiServerInput[], given: string): FactCheck {
  const servers: ServerFacts[] = inputs.map((input) => ({ name: input.server.name, input }));
  // T-064 F2: "1. ..." / "2) ..." list numbering is not a claim.
  const text = reply.replace(LIST_MARKER, "");
  if (servers.length > 0 && outOfScope(text, servers)) return { ok: false, mismatch: "out_of_scope" };
  if (servers.length === 0) return /\d/.test(text) ? { ok: false, mismatch: "unattributed_number" } : { ok: true };
  const memo: Memo = { lastKind: null };
  for (const clause of clauses(text, servers)) {
    const mismatch = checkClause(clause, given.toLowerCase(), servers, memo);
    if (mismatch !== null) return { ok: false, mismatch };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tone (T-064 F4, ADR-015 revised)
// ---------------------------------------------------------------------------

/** Words that make a reply bad news: failures, outages, data loss, security, a full disk. */
const BAD_NEWS =
  /\b(?:fail(?:ed|ing|ure|ures)?|down|unreachable|outage|offline|critical|crash(?:ed|ing)?|broken|breach(?:ed)?|compromised|attack(?:ed)?|intrusion|data loss|lost data|corrupt(?:ed|ion)?|full|errors?)\b|\b(?:can't|cannot|could not|couldn't) (?:reach|connect)\b|\b(?:9\d|100)\s?%/i;
/** Jokes and comic markers. Cheeky lines belong only in routine good news. */
const JOKE =
  /\b(?:yikes|oops(?:ie|y)?|whoops(?:ie)?|uh[- ]?oh|oh no|oof|napping|snoozing|taking a nap|nap time|lol|lmao|rofl|haha+|hehe+|no biggie|welp|derp)\b|[\u{1F605}\u{1F648}\u{1F62C}\u{1F926}\u{1F602}\u{1F923}\u{1F643}\u{1F937}]/iu;

/**
 * True when a reply jokes while giving bad news. ADR-015: never cheeky about
 * failures, outages, data loss, security or Timika client impact. A reply
 * that contains any bad news is not a routine good-news moment.
 */
export function jokesAboutBadNews(reply: string): boolean {
  return BAD_NEWS.test(reply) && JOKE.test(reply);
}
