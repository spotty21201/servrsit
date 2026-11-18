/**
 * serverDetailViewModel — /api/fleet server → Server detail (UX-05, UX Spec §8.4).
 * Pure; no React.
 *
 * Rules carried here:
 *   - Empty data is an em dash plus a reason, never zero. A zero is shown only
 *     when the server reported zero.
 *   - Metrics carry units and the sample time (the observation's collectedAt).
 *   - Findings come first. "No findings" always names how many checks ran.
 *   - Nothing healthy is claimed beyond the checks performed.
 *   - Only what the API sends is shown. The address and the key in use are not
 *     in /api/fleet yet; they show an em dash and say so.
 *   - API strings (names, units, package names, origins) are untrusted and
 *     rendered as plain text.
 */
import {
  clockSkewed,
  describeClockSkew,
  type Field,
  type FleetServer,
  type InspectionObservation,
} from "@servrsit/contracts";
import { toServerCard } from "../components/overview/fleetViewModel";
import type { ServerCardVM } from "../components/overview/fleetViewModel";
import { formatClockWithAge, parseIso } from "../lib/time";
import { WRITES_OFF_TEXT } from "../care/planViewModel";

export const DASH = "—";

/** A displayed value, or an em dash with the reason it is missing. */
export interface Shown {
  readonly value: string;
  /** Why the value is missing. Null when the value is real. */
  readonly why: string | null;
}

export const shown = (value: string): Shown => ({ value, why: null });
export const missing = (why: string): Shown => ({ value: DASH, why });

function fromField<T>(f: Field<T>, show: (v: T) => string): Shown {
  return f.status === "ok" ? shown(show(f.value)) : missing(f.reason);
}

const NO_OBSERVATION = "No successful check yet, so there is nothing to show.";

// ── Units ───────────────────────────────────────────────────────────────────

/** Binary units: 8131772 KiB → "7.8 GiB". One decimal above MiB, none for KiB. */
export function formatKib(kib: number): string {
  if (kib < 1024) return `${Math.round(kib)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MiB`;
  const gib = mib / 1024;
  if (gib < 1024) return `${gib < 10 ? gib.toFixed(1) : Math.round(gib)} GiB`;
  return `${(gib / 1024).toFixed(1)} TiB`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

/** "12 days 3 h", "5 h 20 min", "4 min". */
export function formatUptime(seconds: number): string {
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} day${d === 1 ? "" : "s"} ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

// ── View model ──────────────────────────────────────────────────────────────

export interface MountRow {
  readonly mount: string;
  readonly filesystem: string;
  readonly space: Shown;
  readonly spacePercent: number | null;
  readonly inodes: Shown;
}

export interface FindingRow {
  readonly id: string;
  readonly severity: "critical" | "warning" | "advisory";
  readonly label: string;
  readonly summary: string;
}

export interface ServerDetailVM {
  readonly card: ServerCardVM;
  readonly id: string;
  readonly accessLabel: string;
  readonly accessNote: string;
  readonly coverageText: string;
  readonly freshnessText: string;
  readonly sampleText: string | null;
  readonly hasObservation: boolean;
  readonly findings: readonly FindingRow[];
  readonly findingsEmpty: string;
  readonly checks: { readonly summary: string; readonly unavailable: readonly { check: string; reason: string }[] };
  readonly facts: {
    readonly load: Shown;
    readonly memory: Shown;
    readonly swap: Shown;
    readonly mounts: readonly MountRow[];
    readonly mountsWhy: string | null;
    readonly platform: Shown;
    readonly architecture: Shown;
    readonly uptime: Shown;
    readonly bootId: Shown;
    readonly clock: Shown;
    readonly failedUnits: Shown;
    readonly importantServices: readonly { name: string; note: string }[];
  };
  readonly care: {
    readonly pending: Shown;
    readonly packageInfoAge: Shown;
    readonly packageInfoCaveat: string | null;
    readonly ubuntu: Shown;
    readonly outside: Shown;
    readonly outsideList: readonly { name: string; origin: string }[];
    readonly heldBack: Shown;
    readonly reboot: Shown;
    readonly reviewDisabledReason: string;
    readonly operations: Shown;
    readonly baseline: Shown;
  };
  readonly settings: {
    readonly name: string;
    readonly role: Shown;
    readonly classification: string;
    readonly address: Shown;
    readonly keyInUse: Shown;
    readonly access: string;
    readonly importantServices: Shown;
  };
}

const SEVERITY_LABEL = { critical: "Critical", warning: "Needs attention", advisory: "Advisory" } as const;
const SEVERITY_RANK = { critical: 0, warning: 1, advisory: 2 } as const;

function mounts(o: InspectionObservation): { rows: MountRow[]; why: string | null } {
  const fs = o.host.filesystems;
  if (fs.status !== "ok") return { rows: [], why: fs.reason };
  const inodes = o.host.inodes.status === "ok" ? o.host.inodes.value.entries : null;
  const inodeWhy = o.host.inodes.status === "ok" ? "" : o.host.inodes.reason;
  const rows = fs.value.entries.map((e): MountRow => {
    const ino = inodes?.find((i) => i.mount === e.mount && i.filesystem === e.filesystem) ?? inodes?.find((i) => i.mount === e.mount);
    return {
      mount: e.mount,
      filesystem: e.filesystem,
      space: shown(`${formatKib(e.usedKib)} used of ${formatKib(e.sizeKib)} (${e.usedPercent} %), ${formatKib(e.availKib)} free`),
      spacePercent: e.usedPercent,
      inodes: ino
        ? shown(`${ino.usedPercent} % of ${formatCount(ino.inodes)} inodes used`)
        : missing(inodes === null ? inodeWhy : "No inode figure was reported for this mount."),
    };
  });
  return { rows, why: rows.length === 0 ? "No mounted filesystems were reported." : null };
}

export function toServerDetailVM(s: FleetServer, index: number, now: Date, tz: string, agesUncertain = false): ServerDetailVM {
  const card = toServerCard(s, index, now, tz, agesUncertain);
  const o = s.observation;
  const collected = o ? parseIso(o.collectedAt) : null;
  const cov = s.coverage;

  const findings: FindingRow[] = [...s.findings]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .map((f) => ({ id: f.id, severity: f.severity, label: SEVERITY_LABEL[f.severity], summary: f.summary }));

  const ran = cov ? `${cov.passed} of ${cov.total}` : null;
  const findingsEmpty = !o
    ? `${DASH} ${NO_OBSERVATION}`
    : ran
      ? `No findings from the ${ran} checks that ran.`
      : "No findings from the checks that ran.";

  const m = o ? mounts(o) : { rows: [], why: NO_OBSERVATION };

  const importantServices = s.importantServices.map((name) => {
    if (!o) return { name, note: `${DASH} not checked: ${NO_OBSERVATION}` };
    const fu = o.services.failedUnits;
    if (fu.status !== "ok") return { name, note: `${DASH} not checked: ${fu.reason}` };
    const bad = fu.value.units.find((u) => u.unit === name || u.unit === `${name}.service`);
    return { name, note: bad ? `Failed (${bad.active}/${bad.sub})` : "No failure reported" };
  });

  const pk = o?.packages;
  const pending = pk ? fromField(pk.pendingCount, (n) => formatCount(n)) : missing(NO_OBSERVATION);
  let ubuntu: Shown = missing(pk ? "Needs both the pending count and the origin list." : NO_OBSERVATION);
  let outside: Shown = pk ? fromField(pk.pendingOutsideUbuntu, (v) => formatCount(v.count)) : missing(NO_OBSERVATION);
  if (pk && pk.pendingCount.status === "ok" && pk.pendingOutsideUbuntu.status === "ok") {
    ubuntu = shown(formatCount(Math.max(0, pk.pendingCount.value - pk.pendingOutsideUbuntu.value.count)));
  } else if (pk && pk.pendingOutsideUbuntu.status !== "ok") {
    ubuntu = missing(pk.pendingOutsideUbuntu.reason);
  }
  const outsideList = pk && pk.pendingOutsideUbuntu.status === "ok" ? pk.pendingOutsideUbuntu.value.packages.map((p) => ({ name: p.name, origin: p.origin })) : [];

  let packageInfoAge: Shown = missing(pk ? "" : NO_OBSERVATION);
  let caveat: string | null = null;
  if (pk) {
    if (pk.metadataUpdatedAt.status === "ok") {
      const at = parseIso(pk.metadataUpdatedAt.value);
      packageInfoAge = at ? shown(formatClockWithAge(at, now, tz, agesUncertain)) : missing("The server reported a time ServrSit could not read.");
      caveat =
        pk.metadataClock === "corrected" ? "Corrected for the server's clock, which is off."
        : pk.metadataClock === "unverified" ? "The server's clock could not be read, so this age may be wrong."
        : null;
    } else {
      packageInfoAge = missing(pk.metadataUpdatedAt.reason);
    }
  }

  const clock: Shown = o
    ? fromField(o.host.clock, (c) => (clockSkewed(c) ? `Off: ${describeClockSkew(c)}` : `Within tolerance (about ${Math.abs(c.skewSeconds)} s)`))
    : missing(NO_OBSERVATION);

  const host = o?.host;
  const mem: Shown = host
    ? fromField(host.memory, (v) => {
        const used = v.totalKib - v.availableKib;
        const pct = v.totalKib > 0 ? Math.round((used / v.totalKib) * 100) : 0;
        return `${formatKib(used)} used of ${formatKib(v.totalKib)} (${pct} %), ${formatKib(v.availableKib)} available`;
      })
    : missing(NO_OBSERVATION);
  const swap: Shown = host
    ? fromField(host.memory, (v) => (v.swapTotalKib === 0 ? "No swap configured" : `${formatKib(v.swapTotalKib - v.swapFreeKib)} used of ${formatKib(v.swapTotalKib)}`))
    : missing(NO_OBSERVATION);

  const load: Shown = host
    ? host.load.status === "ok"
      ? shown(`${host.load.value.one.toFixed(2)} · ${host.load.value.five.toFixed(2)} · ${host.load.value.fifteen.toFixed(2)} (1, 5, 15 min)${host.cpuCount.status === "ok" ? ` on ${host.cpuCount.value} CPU${host.cpuCount.value === 1 ? "" : "s"}` : ""}`)
      : missing(host.load.reason)
    : missing(NO_OBSERVATION);

  const accessLabel = s.access === "local" ? "Read-only · this machine" : "Read-only · SSH";
  const accessNote = "ServrSit can look at this server. It cannot change anything on it yet.";

  return {
    card,
    id: s.id,
    accessLabel,
    accessNote,
    coverageText: cov ? `${cov.passed} of ${cov.total} checks ran` : `${DASH} no checks have run`,
    freshnessText: [card.observedText, card.freshUntilText].filter(Boolean).join(" · "),
    sampleText: collected ? `Sampled ${formatClockWithAge(collected, now, tz, agesUncertain)}` : null,
    hasObservation: o !== null,
    findings,
    findingsEmpty,
    checks: {
      summary: cov ? `${cov.passed} of ${cov.total} checks passed${cov.unavailable.length > 0 ? `, ${cov.unavailable.length} unavailable` : ""}` : `${DASH} ${NO_OBSERVATION}`,
      unavailable: cov?.unavailable ?? [],
    },
    facts: {
      load,
      memory: mem,
      swap,
      mounts: m.rows,
      mountsWhy: m.why,
      platform: host ? fromField(host.os, (v) => v.prettyName) : missing(NO_OBSERVATION),
      architecture: host ? fromField(host.architecture, (v) => v) : missing(NO_OBSERVATION),
      uptime: host ? fromField(host.uptimeSeconds, formatUptime) : missing(NO_OBSERVATION),
      bootId: host ? fromField(host.bootId, (v) => v.slice(0, 8)) : missing(NO_OBSERVATION),
      clock,
      failedUnits: o
        ? fromField(o.services.failedUnits, (v) => (v.units.length === 0 ? "None reported" : `${v.units.length}: ${v.units.slice(0, 5).map((u) => u.unit).join(", ")}${v.units.length > 5 ? ", …" : ""}`))
        : missing(NO_OBSERVATION),
      importantServices,
    },
    care: {
      pending,
      packageInfoAge,
      packageInfoCaveat: caveat,
      ubuntu,
      outside,
      outsideList,
      heldBack: pk ? fromField(pk.heldBackCount, (n) => formatCount(n)) : missing(NO_OBSERVATION),
      reboot: pk ? fromField(pk.rebootRequired, (v) => (v ? "Reboot required" : "No reboot flagged by the server")) : missing(NO_OBSERVATION),
      reviewDisabledReason: WRITES_OFF_TEXT,
      operations: missing("Operation history is not available from the API yet."),
      baseline: missing("Baseline comparison is not available yet."),
    },
    settings: {
      name: s.name,
      role: s.role ? shown(s.role) : missing("No role has been set in the server's configuration."),
      classification: s.production ? "Production" : "Non-production",
      address: missing("The API does not send the address yet."),
      keyInUse: missing("The API does not say which key is used yet. It will show \"dedicated ServrSit key\" or \"owner key\", never a path."),
      access: s.access === "local" ? "Inspect only, on this machine" : "Inspect only, over SSH",
      importantServices: s.importantServices.length > 0 ? shown(s.importantServices.join(", ")) : missing("None selected yet."),
    },
  };
}

