/**
 * [FIXTURE] STUB client for baselines, comparison and server preparation
 * (T-073, PRD FR-09 and FR-15, UX Spec §12). No baseline API or contract
 * exists yet, so these types are local and PROVISIONAL; Coder should propose a
 * contract in packages/contracts and replace this file. Every server here is a
 * synthetic "Fixture …" machine: a comparison against a real server would have
 * to come from real observations of directories, which the API does not
 * collect yet. Proposed endpoints:
 *
 *   GET  /api/baselines/candidates?reference=:id         eligible and ineligible conventions with reasons
 *   POST /api/baselines {name, referenceId, conventionIds}  -> Baseline (versioned, with the source observation)
 *   POST /api/baselines/:id/compare {targetId}            -> ComparisonRow[] (read-only)
 *   PUT  /api/baselines/:id/exceptions {targetId, conventionId, reason?}   mark intentional (record only)
 *   DELETE /api/baselines/:id/exceptions/:targetId/:conventionId
 *   GET  /api/baselines/:id/history?target=:id            append-only record of marks and edits
 *   POST /api/baselines/:id/setup-plan {targetId}         -> {planId}: opens the canonical Plan review (/plans/:id)
 *
 * Rules the API must keep (the UI relies on them): a comparison copies and
 * deletes nothing; marking intentional changes only the exception record, never
 * the server; the setup plan excludes credentials, SSH host keys, application
 * data, databases, personal files and machine-specific network settings; every
 * real host's plan is blocked by writesEnabled=false like any other plan.
 */

import { gate } from "../../lib/fixtureState";

export type ConventionKind = "directory" | "package";

export interface BaselineServer {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
  readonly production: boolean;
  /** False for every real host (ADR-014): a setup plan for it opens blocked. */
  readonly writesEnabled: boolean;
  /** When the facts about this server were last observed. */
  readonly observedAt: string;
}

export interface Candidate {
  readonly id: string;
  readonly kind: ConventionKind;
  /** The path or package name. */
  readonly label: string;
  /** For example "owner deploy:deploy, mode 0755" or "version 1.24.0". */
  readonly detail: string;
  readonly eligible: boolean;
  /** Why an ineligible item cannot be part of a baseline. */
  readonly ineligibleReason: string | null;
}

export interface Baseline {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly referenceId: string;
  readonly referenceName: string;
  readonly sourceObservedAt: string;
  readonly createdAt: string;
  readonly conventions: readonly Candidate[];
}

export type CompareStatus = "matches" | "missing" | "different-by-design" | "conflict" | "not-checked";

export interface ComparisonRow {
  readonly conventionId: string;
  readonly kind: ConventionKind;
  readonly label: string;
  readonly expected: string;
  /** What the target has, or null when nothing was found or it was not checked. */
  readonly found: string | null;
  readonly status: CompareStatus;
  /** Our own explanation of the status. */
  readonly reason: string;
  /** Set when the owner marked this difference intentional on this machine. */
  readonly intentional: { readonly reason: string | null; readonly markedAt: string } | null;
}

export interface HistoryEvent {
  readonly at: string;
  readonly text: string;
}

export interface SetupPlanResult {
  /** Opens at /plans/:planId, the same Plan review used for updates. */
  readonly planId: string;
}

export type BaselinesResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: "NOT_FOUND" | "NOT_ALLOWED" | "NETWORK" };

export interface BaselinesClient {
  listServers(): Promise<BaselinesResult<readonly BaselineServer[]>>;
  listCandidates(referenceId: string): Promise<BaselinesResult<readonly Candidate[]>>;
  saveBaseline(input: { name: string; referenceId: string; conventionIds: readonly string[] }): Promise<BaselinesResult<Baseline>>;
  compare(baselineId: string, targetId: string): Promise<BaselinesResult<readonly ComparisonRow[]>>;
  markIntentional(baselineId: string, targetId: string, conventionId: string, reason: string | null): Promise<BaselinesResult<readonly ComparisonRow[]>>;
  unmarkIntentional(baselineId: string, targetId: string, conventionId: string): Promise<BaselinesResult<readonly ComparisonRow[]>>;
  history(baselineId: string, targetId: string): Promise<BaselinesResult<readonly HistoryEvent[]>>;
  createSetupPlan(baselineId: string, targetId: string): Promise<BaselinesResult<SetupPlanResult>>;
}

// ── [FIXTURE] in-memory model ────────────────────────────────────────────────

const wait = (): Promise<void> => new Promise((r) => globalThis.setTimeout(r, 150));

export function createFixtureBaselinesClient(now: () => Date = () => new Date()): BaselinesClient {
  const ago = (min: number): string => new Date(now().getTime() - min * 60_000).toISOString();
  const servers: readonly BaselineServer[] = [
    { id: "b-web1", name: "Fixture Web-1", role: "Web server (reference candidate)", production: true, writesEnabled: false, observedAt: ago(12) },
    { id: "b-old", name: "Fixture Web-0", role: "Web server", production: false, writesEnabled: true, observedAt: ago(3 * 24 * 60) },
    { id: "b-dev2", name: "Fixture Dev-2", role: "New development server", production: false, writesEnabled: true, observedAt: ago(8) },
    { id: "b-web2", name: "Fixture Web-2", role: "New web server", production: true, writesEnabled: false, observedAt: ago(15) },
  ];
  const candidates: readonly Candidate[] = [
    { id: "d-app", kind: "directory", label: "/srv/app", detail: "owner deploy:deploy, mode 0755", eligible: true, ineligibleReason: null },
    { id: "d-backups", kind: "directory", label: "/var/backups/app", detail: "owner root:root, mode 0750", eligible: true, ineligibleReason: null },
    { id: "d-tools", kind: "directory", label: "/opt/tools", detail: "owner root:root, mode 0755", eligible: true, ineligibleReason: null },
    { id: "p-nginx", kind: "package", label: "nginx", detail: "Ubuntu archive, version 1.24.0-2ubuntu7.1", eligible: true, ineligibleReason: null },
    { id: "p-logrotate", kind: "package", label: "logrotate", detail: "Ubuntu archive, version 3.21.0-2build1", eligible: true, ineligibleReason: null },
    { id: "p-docker", kind: "package", label: "docker-ce", detail: "Docker CE repository, version 5:27.3.1", eligible: false, ineligibleReason: "It comes from outside Ubuntu's archive. Third-party sources are never part of a baseline." },
    { id: "d-ssh", kind: "directory", label: "/etc/ssh", detail: "host keys and daemon settings", eligible: false, ineligibleReason: "It holds SSH host keys, which are never copied." },
    { id: "d-home", kind: "directory", label: "/home/deploy", detail: "personal files", eligible: false, ineligibleReason: "It holds personal files. Home directories are never part of a baseline." },
    { id: "d-netplan", kind: "directory", label: "/etc/netplan", detail: "network settings", eligible: false, ineligibleReason: "Network settings are specific to one machine." },
    { id: "d-data", kind: "directory", label: "/var/lib/postgresql", detail: "database files", eligible: false, ineligibleReason: "It holds application data and databases." },
  ];
  // What each target "has": per convention a found value and a base status.
  const TARGETS: Record<string, Record<string, { found: string | null; status: CompareStatus; reason: string }>> = {
    "b-dev2": {
      "d-app": { found: null, status: "missing", reason: "The directory does not exist." },
      "d-backups": { found: null, status: "missing", reason: "The directory does not exist." },
      "d-tools": { found: "owner alice:alice, mode 0700", status: "conflict", reason: "It exists with a different owner and mode. ServrSit will not change an existing directory." },
      "p-nginx": { found: "not installed", status: "missing", reason: "The package is not installed." },
      "p-logrotate": { found: "version 3.21.0-2build1", status: "matches", reason: "The same version is installed." },
    },
    "b-web2": {
      "d-app": { found: "owner deploy:deploy, mode 0755", status: "matches", reason: "Owner and mode match." },
      "d-backups": { found: null, status: "missing", reason: "The directory does not exist." },
      "d-tools": { found: null, status: "not-checked", reason: "The directory listing could not be read on the last check." },
      "p-nginx": { found: "version 1.22.1-1", status: "conflict", reason: "A different version is installed. ServrSit will not downgrade or replace it." },
      "p-logrotate": { found: "version 3.21.0-2build1", status: "matches", reason: "The same version is installed." },
    },
  };
  const baselines = new Map<string, Baseline>();
  const marks = new Map<string, { reason: string | null; markedAt: string }>(); // key: baseline|target|convention
  const hist = new Map<string, HistoryEvent[]>();
  let n = 0;
  const mk = (b: string, t: string, c: string): string => `${b}|${t}|${c}`;
  const rows = (b: Baseline, targetId: string): ComparisonRow[] | null => {
    const spec = TARGETS[targetId];
    if (!spec) return null;
    return b.conventions.map((c) => {
      const base = spec[c.id] ?? { found: null, status: "not-checked" as const, reason: "This convention was not checked on this server." };
      const m = marks.get(mk(b.id, targetId, c.id)) ?? null;
      const intentionalOk = m !== null && (base.status === "missing" || base.status === "conflict");
      return {
        conventionId: c.id, kind: c.kind, label: c.label, expected: c.detail, found: base.found,
        status: intentionalOk ? "different-by-design" : base.status,
        reason: intentionalOk ? "You marked this difference as intentional for this server only." : base.reason,
        intentional: intentionalOk ? m : null,
      };
    });
  };
  const note = (b: string, t: string, text: string): void => { const k = `${b}|${t}`; hist.set(k, [{ at: now().toISOString(), text }, ...(hist.get(k) ?? [])]); };
  return {
    async listServers() { await wait(); return gate<BaselinesResult<readonly BaselineServer[]>>(() => ({ ok: true, data: servers }), () => ({ ok: false, error: "NETWORK" })); },
    async listCandidates(referenceId) { await wait(); return servers.some((s) => s.id === referenceId) ? { ok: true, data: candidates } : { ok: false, error: "NOT_FOUND" }; },
    async saveBaseline(input) {
      await wait();
      const ref = servers.find((s) => s.id === input.referenceId);
      if (!ref) return { ok: false, error: "NOT_FOUND" };
      const chosen = candidates.filter((c) => input.conventionIds.includes(c.id));
      if (chosen.some((c) => !c.eligible) || chosen.length !== input.conventionIds.length) return { ok: false, error: "NOT_ALLOWED" };
      const b: Baseline = { id: `baseline-${++n}`, name: input.name, version: 1, referenceId: ref.id, referenceName: ref.name, sourceObservedAt: ref.observedAt, createdAt: now().toISOString(), conventions: chosen };
      baselines.set(b.id, b);
      return { ok: true, data: b };
    },
    async compare(baselineId, targetId) {
      await wait();
      const b = baselines.get(baselineId);
      if (!b) return { ok: false, error: "NOT_FOUND" };
      const r = rows(b, targetId);
      return r ? { ok: true, data: r } : { ok: false, error: "NOT_FOUND" };
    },
    async markIntentional(baselineId, targetId, conventionId, reason) {
      await wait();
      const b = baselines.get(baselineId);
      const r0 = b ? rows(b, targetId)?.find((r) => r.conventionId === conventionId) : undefined;
      if (!b || !r0) return { ok: false, error: "NOT_FOUND" };
      if (r0.status !== "missing" && r0.status !== "conflict") return { ok: false, error: "NOT_ALLOWED" };
      marks.set(mk(baselineId, targetId, conventionId), { reason: reason && reason.trim() !== "" ? reason.trim() : null, markedAt: now().toISOString() });
      note(baselineId, targetId, `Marked "${r0.label}" intentional${reason?.trim() ? `: ${reason.trim()}` : " (no reason given)"}. This changed the exception record only, not the server.`);
      return { ok: true, data: rows(b, targetId) ?? [] };
    },
    async unmarkIntentional(baselineId, targetId, conventionId) {
      await wait();
      const b = baselines.get(baselineId);
      if (!b || !marks.delete(mk(baselineId, targetId, conventionId))) return { ok: false, error: "NOT_FOUND" };
      note(baselineId, targetId, `Removed the intentional mark from "${b.conventions.find((c) => c.id === conventionId)?.label ?? conventionId}". The server was not changed.`);
      return { ok: true, data: rows(b, targetId) ?? [] };
    },
    async history(baselineId, targetId) { await wait(); return { ok: true, data: hist.get(`${baselineId}|${targetId}`) ?? [] }; },
    async createSetupPlan(baselineId, targetId) {
      await wait();
      const target = servers.find((s) => s.id === targetId);
      if (!baselines.has(baselineId) || !target) return { ok: false, error: "NOT_FOUND" };
      return { ok: true, data: { planId: target.writesEnabled ? "fixture-plan-prepare" : "fixture-plan-prepare-blocked" } };
    },
  };
}
