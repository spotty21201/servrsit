/**
 * [FIXTURE DATA] Baselines client (T-073, moved here by T-080). Implements the
 * real BaselinesClient interface (api/baselines.ts) over an in-memory model of
 * synthetic "Fixture …" servers. Used only by /fixtures/baselines. The real
 * /baselines screen never imports this. A setup plan from here opens the
 * fixture plans of the Plan review; nothing is sent anywhere.
 */
import type { CompareStatus } from "@servrsit/contracts";
import type { Baseline, BaselineServer, BaselinesClient, BaselinesResult, Candidate, CandidatesResponse, Comparison, ComparisonRow, HistoryEvent } from "../api/baselines";
import { gate } from "../lib/fixtureState";

// ── in-memory model ────────────────────────────────────────────────

const wait = (): Promise<void> => new Promise((r) => globalThis.setTimeout(r, 150));

export function createFixtureBaselinesClient(now: () => Date = () => new Date()): BaselinesClient {
  const ago = (min: number): string => new Date(now().getTime() - min * 60_000).toISOString();
  const servers: readonly BaselineServer[] = [
    { id: "b-web1", name: "Fixture Web-1", role: "Web server (reference candidate)", production: true, writesEnabled: false, simulated: true, observedAt: ago(12) },
    { id: "b-old", name: "Fixture Web-0", role: "Web server", production: false, writesEnabled: true, simulated: true, observedAt: ago(3 * 24 * 60) },
    { id: "b-dev2", name: "Fixture Dev-2", role: "New development server", production: false, writesEnabled: true, simulated: true, observedAt: ago(8) },
    { id: "b-web2", name: "Fixture Web-2", role: "New web server", production: true, writesEnabled: false, simulated: true, observedAt: ago(15) },
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
        actionable: base.status === "missing" && c.kind === "directory",
        status: intentionalOk ? "different-by-design" : base.status,
        reason: intentionalOk ? "You marked this difference as intentional for this server only." : base.reason,
        intentional: intentionalOk ? m : null,
      };
    });
  };
  const note = (b: string, t: string, text: string): void => { const k = `${b}|${t}`; hist.set(k, [{ at: now().toISOString(), text }, ...(hist.get(k) ?? [])]); };
  return {
    async listServers() { await wait(); return gate<BaselinesResult<readonly BaselineServer[]>>(() => ({ ok: true, data: servers }), () => ({ ok: false, error: "NETWORK" })); },
    async listBaselines() { await wait(); return { ok: true, data: [...baselines.values()] }; },
    async candidatesResponse(referenceId) {
      await wait();
      const ref = servers.find((s) => s.id === referenceId);
      if (!ref) return { ok: false, error: "NOT_FOUND" };
      const data: CandidatesResponse = { referenceId, observedAt: ref.observedAt ?? now().toISOString(), source: "simulated", candidates: [...candidates], notes: ["[FIXTURE DATA] Listing from a synthetic server."] };
      return { ok: true, data };
    },
    async listCandidates(referenceId) { const r = await this.candidatesResponse(referenceId); return r.ok ? { ok: true, data: r.data.candidates } : r; },
    async saveBaseline(input) {
      await wait();
      const ref = servers.find((s) => s.id === input.referenceId);
      if (!ref) return { ok: false, error: "NOT_FOUND" };
      const chosen = candidates.filter((c) => input.conventionIds.includes(c.id));
      if (chosen.some((c) => !c.eligible) || chosen.length !== input.conventionIds.length) return { ok: false, error: "NOT_ALLOWED" };
      const b: Baseline = { id: `baseline-${++n}`, name: input.name, version: 1, referenceId: ref.id, referenceName: ref.name, source: "simulated", sourceObservedAt: ref.observedAt ?? now().toISOString(), createdAt: now().toISOString(), conventions: chosen };
      baselines.set(b.id, b);
      return { ok: true, data: b };
    },
    async comparison(baselineId, targetId) {
      await wait();
      const b = baselines.get(baselineId);
      if (!b) return { ok: false, error: "NOT_FOUND" };
      const r = rows(b, targetId);
      const data: Comparison | null = r ? { baselineId, version: b.version, targetId, observedAt: servers.find((x) => x.id === targetId)?.observedAt ?? now().toISOString(), source: "simulated", rows: r } : null;
      return data ? { ok: true, data } : { ok: false, error: "NOT_FOUND" };
    },
    async compare(baselineId, targetId) { const r = await this.comparison(baselineId, targetId); return r.ok ? { ok: true, data: r.data.rows } : r; },
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
      const b = baselines.get(baselineId);
      const r = b ? rows(b, targetId) ?? [] : [];
      const missing = r.filter((x) => x.status === "missing");
      return {
        ok: true,
        data: {
          planId: target.writesEnabled ? "fixture-plan-prepare" : "fixture-plan-prepare-blocked",
          included: missing.filter((x) => x.actionable).length,
          notIncluded: missing.filter((x) => !x.actionable).map((x) => ({ label: x.label, reason: "No supported operation installs packages yet." })),
        },
      };
    },
  };
}
