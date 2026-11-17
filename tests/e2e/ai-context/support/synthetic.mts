/**
 * [FIXTURE DATA]
 *
 * Synthetic servers for the AI tests. Nothing here describes a real machine,
 * and NOTHING from the real fleet is ever sent to the AI provider by these tests.
 * Numbers are chosen to be easy to confuse on purpose (the Nabire/Merauke
 * misattribution replay): neighbours in the list carry different counts.
 */
import { ok, unavailable, type InspectionObservation } from "../../../../packages/ssh/src/index.ts";
import type { ExplainableServer } from "../../../../packages/ai/src/index.ts";

export interface Spec {
  name: string;
  role?: string | null;
  production?: boolean;
  pending?: number;
  held?: number;
  disk?: number;       // percent used on "/"
  inode?: number | null;
  memUsedPct?: number; // percent used
  uptimeDays?: number;
  load1?: number;
  cpu?: number;
  failedUnits?: string[];
  reboot?: boolean;
  status?: string;
  reason?: string;
  withObservation?: boolean;
  findings?: ExplainableServer["findings"];
  access?: "ssh" | "local";
  /** A host that could not be reached: its last attempt FAILED (default keeps the older, inconsistent shape used by stored real answers). */
  lastAttemptFailed?: boolean;
}

const NOW = Date.parse("2026-11-17T08:20:00.000Z");
export const CTX = { timeZone: "Asia/Jakarta", now: new Date(NOW) };

export function synth(s: Spec): ExplainableServer {
  const withObs = s.withObservation ?? true;
  const total = 1_000_000;
  const used = Math.round(((s.memUsedPct ?? 30) / 100) * total);
  const obs: InspectionObservation = {
    schemaVersion: 1,
    collectedAt: "2026-11-17T08:00:00.000Z",
    source: s.access === "local" ? "local" : "ssh",
    durationMs: 700,
    truncated: false,
    truncatedSections: [],
    host: {
      collector: "inspect.host.v1",
      hostname: ok(`fixture-${s.name.toLowerCase()}`),
      os: ok({ id: "ubuntu", prettyName: "Ubuntu 24.04.5 LTS", versionId: "24.04" }),
      architecture: ok("x86_64"),
      bootId: ok("00000000-0000-4000-8000-000000000000"),
      uptimeSeconds: ok(Math.round((s.uptimeDays ?? 3) * 86400) + 60),
      load: ok({ one: s.load1 ?? 0.2, five: 0.1, fifteen: 0.1 }),
      cpuCount: ok(s.cpu ?? 4),
      memory: ok({ totalKib: total, availableKib: total - used, swapTotalKib: 0, swapFreeKib: 0 }),
      filesystems: ok({
        entries: [{ filesystem: "/dev/sda1", mount: "/", sizeKib: 1000, usedKib: (s.disk ?? 40) * 10, availKib: 1000 - (s.disk ?? 40) * 10, usedPercent: s.disk ?? 40 }],
        skippedLineCount: 0,
      }),
      inodes: s.inode == null
        ? unavailable("no parsable inode rows")
        : ok({ entries: [{ filesystem: "/dev/sda1", mount: "/", inodes: 1000, inodesUsed: s.inode * 10, inodesFree: 1000 - s.inode * 10, usedPercent: s.inode }], skippedLineCount: 0 }),
    },
    services: {
      collector: "inspect.services.v1",
      failedUnits: ok({
        units: (s.failedUnits ?? []).map((unit) => ({ unit, nameValid: true, load: "loaded", active: "failed", sub: "failed" })),
        unparsedLineCount: 0,
      }),
    },
    packages: {
      collector: "inspect.packages.v1",
      pendingCount: ok(s.pending ?? 0),
      heldBackCount: ok(s.held ?? 0),
      metadataUpdatedAt: ok("2026-11-17T02:00:00.000Z"),
      rebootRequired: ok(s.reboot ?? false),
    },
  };
  return {
    name: s.name,
    role: s.role ?? null,
    production: s.production ?? false,
    access: s.access ?? "ssh",
    status: s.status ?? "fresh",
    statusReason: s.reason ?? "All checks ran and were within their freshness window.",
    observedAt: withObs ? "2026-11-17T08:00:00.000Z" : null,
    freshUntil: withObs ? "2026-11-17T08:30:00.000Z" : null,
    coverage: withObs ? { passed: 15, total: 15, unavailable: [] } : null,
    latestAttempt: s.lastAttemptFailed
      ? { at: "2026-11-17T08:00:01.000Z", succeeded: false, failure: { code: "ROUTE_UNAVAILABLE", message: "route unavailable" }, consecutiveFailures: 2 }
      : { at: "2026-11-17T08:00:01.000Z", succeeded: true, failure: null, consecutiveFailures: 0 },
    findings: s.findings ?? (s.pending ? [{ severity: "advisory", rule: "packages.pending.v1", summary: `${s.pending} package updates pending, from the host's existing package information (not refreshed by ServrSit).` }] : []),
    observation: withObs ? obs : null,
  };
}

/** The four servers. Neighbouring entries have different counts, the shape of the original incident. */
export const FACTS = {
  Timika:  { name: "Timika",  role: "Remote VPS in Europe, client-facing", production: true,  pending: 0, held: 0, disk: 42, inode: 8,  memUsedPct: 35, uptimeDays: 41, load1: 0.31, cpu: 2 },
  Nabire:  { name: "Nabire",  role: "Development server (home studio)",    production: false, pending: 1, held: 0, disk: 11, inode: 2,  memUsedPct: 20, uptimeDays: 2,  load1: 0.13, cpu: 4 },
  Sentani: { name: "Sentani", role: "Personal server (home studio)",       production: false, pending: 6, held: 0, disk: 71, inode: 5,  memUsedPct: 83, uptimeDays: 9,  load1: 1.4,  cpu: 2 },
  Merauke: { name: "Merauke", role: "Development server (dev host)",       production: false, pending: 0, held: 1, disk: 9,  inode: 2,  memUsedPct: 40, uptimeDays: 1,  load1: 0.6,  cpu: 4, access: "local" as const },
} satisfies Record<string, Spec>;

export const fleet = (): ExplainableServer[] => Object.values(FACTS).map((f) => synth(f));
export const only = (...names: (keyof typeof FACTS)[]): ExplainableServer[] => names.map((n) => synth(FACTS[n]));
