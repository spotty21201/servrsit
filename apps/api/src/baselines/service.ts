/**
 * Baselines, comparison and setup plans (T-078, PRD FR-09/FR-15).
 *
 * Every server contact here is the read-only inventory (packages/ssh
 * inventory.ts), and only when the owner asks for candidates or a
 * comparison. Nothing is copied or deleted. A setup plan goes through the
 * same plan builder as every other change, so a real server's plan is
 * blocked by writesEnabled=false.
 */

import { randomUUID } from "node:crypto";
import type {
  Baseline,
  BaselineErrorCode,
  Candidate,
  CandidatesResponse,
  Comparison,
  ComparisonRow,
  HistoryEvent,
  PlanRequest,
  SetupPlanResult,
} from "@servrsit/contracts";
import { directoryAllowed, type DirectorySpec } from "@servrsit/domain";
import type { Inventory, InventoryResult } from "@servrsit/ssh";
import type { SqliteBaselineStore, StoredBaseline } from "@servrsit/store";

/** How long candidates and a comparison's inventory may be reused. */
export const INVENTORY_REUSE_MS = 30 * 60_000;
export const MAX_PLAN_DIRECTORIES = 20;
export const MAX_CONVENTIONS = 200;

export type Convention =
  | { readonly id: string; readonly kind: "directory"; readonly root: "srv" | "home"; readonly rel: string; readonly owner: string; readonly group: string; readonly mode: string }
  | { readonly id: string; readonly kind: "package"; readonly name: string; readonly version: string };

/** "@user" in a home convention means "the login user of the target". */
const LOGIN_USER = "@user";

export interface BaselineServerInfo {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
  readonly production: boolean;
  readonly writesEnabled: boolean;
  readonly simulated: boolean;
  readonly observedAt: string | null;
  /** The SSH login user (for home conventions), or null. */
  readonly user: string | null;
}

export type Out<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly status: number; readonly error: BaselineErrorCode; readonly reason?: string };

const fail = <T>(status: number, error: BaselineErrorCode, reason?: string): Out<T> => ({ ok: false, status, error, ...(reason === undefined ? {} : { reason }) });
const ok = <T>(value: T): Out<T> => ({ ok: true, value });

export interface BaselineServiceOptions {
  readonly store: SqliteBaselineStore;
  readonly servers: () => readonly BaselineServerInfo[];
  /** Read-only inventory of one server, or null when it cannot be inspected here (with a reason). */
  readonly inventory: (serverId: string) => Promise<InventoryResult | { ok: false; code: "UNAVAILABLE"; message: string }>;
  /** The care plan builder (one path for every plan). */
  readonly plan: () => ((request: PlanRequest) => Promise<{ plan: { id: string } } | null>) | null;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
}

interface Cached {
  readonly at: number;
  readonly inventory: Inventory;
}

function dirLabel(c: Extract<Convention, { kind: "directory" }>): string {
  return c.root === "srv" ? `/srv/${c.rel}` : `~/${c.rel}`;
}

function dirDetail(owner: string, group: string, mode: string): string {
  return `owner ${owner}:${group}, mode ${mode}`;
}

function candidateOf(c: Convention, eligible: boolean, ineligibleReason: string | null): Candidate {
  if (c.kind === "directory") {
    const owner = c.owner === LOGIN_USER ? "(login user)" : c.owner;
    const group = c.group === LOGIN_USER ? "(login user)" : c.group;
    return { id: c.id, kind: "directory", label: dirLabel(c), detail: dirDetail(owner, group, c.mode), eligible, ineligibleReason };
  }
  return { id: c.id, kind: "package", label: c.name, detail: `Ubuntu archive, version ${c.version}`, eligible, ineligibleReason };
}

const DIR_REASONS = {
  permissions: "Its permissions are not allowed in a baseline: no setuid, setgid, sticky or world-writable directories, and the owner must be able to enter it.",
  path: "Hidden or unusual paths are never part of a baseline.",
} as const;

/** Inventory -> candidate conventions, each with eligibility. */
export function candidatesFrom(inv: Inventory, user: string | null): { conventions: Map<string, { convention: Convention; candidate: Candidate }>; notes: string[] } {
  const out = new Map<string, { convention: Convention; candidate: Candidate }>();
  const notes: string[] = [];
  const home = inv.home.status === "ok" ? inv.home.value : null;
  if (inv.directories.status === "unavailable") notes.push("Directories could not be listed on this server.");
  else {
    if (inv.directories.partial) notes.push("Some directories could not be read, so the list may be incomplete.");
    for (const d of inv.directories.value) {
      let root: "srv" | "home";
      let rel: string;
      if (d.path.startsWith("/srv/")) {
        root = "srv";
        rel = d.path.slice(5);
      } else if (home !== null && d.path.startsWith(`${home}/`)) {
        root = "home";
        rel = d.path.slice(home.length + 1);
      } else continue;
      const isUser = root === "home" && user !== null;
      const convention: Convention = {
        id: `dir:${root}:${rel}`,
        kind: "directory",
        root,
        rel,
        owner: isUser && d.owner === user ? LOGIN_USER : d.owner,
        group: isUser && d.group === user ? LOGIN_USER : d.group,
        mode: d.mode,
      };
      // Checked as the target would create it: under /srv, or under /home/<user>.
      const checkUser = user ?? "nobody";
      const path = root === "srv" ? d.path : `/home/${checkUser}/${rel}`;
      const allowed = directoryAllowed({ path, owner: d.owner, group: d.group, mode: d.mode }, checkUser);
      const mode = Number.parseInt(d.mode, 8);
      const permissionsBad = mode > 0o777 || (mode & 0o002) !== 0 || (mode & 0o700) !== 0o700;
      const reason = allowed ? null : permissionsBad ? DIR_REASONS.permissions : DIR_REASONS.path;
      out.set(convention.id, { convention, candidate: candidateOf(convention, allowed, reason) });
    }
  }
  if (inv.packages.status === "unavailable") notes.push("Installed packages could not be read on this server.");
  else {
    const ubuntu = inv.ubuntuPackages.status === "ok" ? new Set(inv.ubuntuPackages.value) : null;
    if (ubuntu === null) notes.push("Ubuntu's archive lists could not be read, so no package can be confirmed as Ubuntu's.");
    for (const [name, version] of Object.entries(inv.packages.value).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const convention: Convention = { id: `pkg:${name}`, kind: "package", name, version };
      const eligible = ubuntu !== null && ubuntu.has(name);
      const reason = eligible
        ? null
        : ubuntu === null
          ? "ServrSit could not confirm that this package comes from Ubuntu's archive."
          : "It comes from outside Ubuntu's archive. Third-party sources are never part of a baseline.";
      const c = candidateOf(convention, eligible, reason);
      out.set(convention.id, { convention, candidate: eligible ? c : { ...c, detail: `version ${version}` } });
    }
  }
  return { conventions: out, notes };
}

export class BaselineService {
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly candidateCache = new Map<string, Cached & { conventions: Map<string, { convention: Convention; candidate: Candidate }> }>();
  private readonly targetCache = new Map<string, Cached>();

  constructor(private readonly o: BaselineServiceOptions) {
    this.now = o.now ?? (() => new Date());
    this.newId = o.newId ?? (() => randomUUID());
  }

  private server(id: string): BaselineServerInfo | undefined {
    return this.o.servers().find((s) => s.id === id);
  }

  listServers(): BaselineServerInfo[] {
    return [...this.o.servers()];
  }

  private async collect(serverId: string): Promise<Out<Inventory>> {
    const r = await this.o.inventory(serverId);
    if (!r.ok) return fail(503, "UNAVAILABLE", r.message);
    return ok(r.inventory);
  }

  async candidates(referenceId: string): Promise<Out<CandidatesResponse>> {
    const server = this.server(referenceId);
    if (server === undefined) return fail(404, "NOT_FOUND");
    const inv = await this.collect(referenceId);
    if (!inv.ok) return inv;
    const { conventions, notes } = candidatesFrom(inv.value, server.user);
    this.candidateCache.set(referenceId, { at: this.now().getTime(), inventory: inv.value, conventions });
    return ok({ referenceId, observedAt: inv.value.collectedAt, source: inv.value.source, candidates: [...conventions.values()].map((c) => c.candidate), notes });
  }

  private view(b: StoredBaseline<Convention>): Baseline {
    return {
      id: b.id, name: b.name, version: b.version, referenceId: b.referenceId, referenceName: b.referenceName, source: b.source,
      sourceObservedAt: b.sourceObservedAt, createdAt: b.createdAt, conventions: b.conventions.map((c) => candidateOf(c, true, null)),
    };
  }

  list(): Baseline[] {
    return this.o.store.listLatest<Convention>().map((b) => this.view(b));
  }

  get(id: string): Out<Baseline> {
    const b = this.o.store.latest<Convention>(id);
    return b === null ? fail(404, "NOT_FOUND") : ok(this.view(b));
  }

  save(input: { name: string; referenceId: string; conventionIds: readonly string[]; baselineId?: string | undefined }, actor: string): Out<Baseline> {
    const server = this.server(input.referenceId);
    if (server === undefined) return fail(404, "NOT_FOUND");
    if (input.baselineId !== undefined && this.o.store.latest(input.baselineId) === null) return fail(404, "NOT_FOUND");
    const cached = this.candidateCache.get(input.referenceId);
    if (cached === undefined || this.now().getTime() - cached.at > INVENTORY_REUSE_MS) {
      return fail(409, "STALE_CANDIDATES", "Load the reference server's candidates again before saving.");
    }
    const chosen: Convention[] = [];
    for (const id of new Set(input.conventionIds)) {
      const c = cached.conventions.get(id);
      if (c === undefined || !c.candidate.eligible) return fail(400, "INVALID_INPUT", "A selected item is not an eligible candidate.");
      chosen.push(c.convention);
    }
    if (chosen.length > MAX_CONVENTIONS) return fail(400, "INVALID_INPUT");
    const stored = this.o.store.insert<Convention>({
      id: input.baselineId ?? this.newId(),
      name: input.name,
      referenceId: input.referenceId,
      referenceName: server.name,
      source: cached.inventory.source,
      sourceObservedAt: cached.inventory.collectedAt,
      createdAt: this.now().toISOString(),
      createdBy: actor,
      conventions: chosen,
    });
    return ok(this.view(stored));
  }

  private rows(b: StoredBaseline<Convention>, targetId: string, target: BaselineServerInfo, inv: Inventory): ComparisonRow[] {
    const marks = new Map(this.o.store.exceptions(b.id, targetId).map((e) => [e.conventionId, e]));
    const dirs = inv.directories.status === "ok" ? new Map(inv.directories.value.map((d) => [d.path, d])) : null;
    const home = inv.home.status === "ok" ? inv.home.value : null;
    return b.conventions.map((c): ComparisonRow => {
      const mark = marks.get(c.id);
      const intentional = mark === undefined ? null : { reason: mark.reason, markedAt: mark.markedAt };
      let row: Omit<ComparisonRow, "intentional" | "conventionId" | "kind">;
      if (c.kind === "directory") {
        const owner = c.owner === LOGIN_USER ? target.user : c.owner;
        const group = c.group === LOGIN_USER ? target.user : c.group;
        const path = c.root === "srv" ? `/srv/${c.rel}` : home === null ? null : `${home}/${c.rel}`;
        const expected = dirDetail(owner ?? "(login user)", group ?? "(login user)", c.mode);
        if (dirs === null || path === null || owner === null || group === null) {
          row = { label: dirLabel(c), expected, found: null, status: "not-checked", reason: "Directories could not be listed on this server.", actionable: false };
        } else {
          const d = dirs.get(path);
          if (d === undefined) {
            row = inv.directories.status === "ok" && inv.directories.partial
              ? { label: path, expected, found: null, status: "not-checked", reason: "Some directories could not be read, so ServrSit cannot tell whether this one exists.", actionable: false }
              : { label: path, expected, found: null, status: "missing", reason: "Missing. A setup plan can create it.", actionable: true };
          } else if (d.owner === owner && d.group === group && d.mode === c.mode) {
            row = { label: path, expected, found: dirDetail(d.owner, d.group, d.mode), status: "matches", reason: "Matches the baseline.", actionable: false };
          } else {
            row = { label: path, expected, found: dirDetail(d.owner, d.group, d.mode), status: "conflict", reason: "It exists with different ownership or mode. ServrSit never changes an existing directory.", actionable: false };
          }
        }
      } else {
        const expected = `version ${c.version}`;
        if (inv.packages.status !== "ok") {
          row = { label: c.name, expected, found: null, status: "not-checked", reason: "Installed packages could not be read on this server.", actionable: false };
        } else {
          const v = inv.packages.value[c.name];
          row =
            v === undefined
              ? { label: c.name, expected, found: null, status: "missing", reason: "Not installed. Installing packages is not a supported operation yet, so a setup plan cannot add it.", actionable: false }
              : v === c.version
                ? { label: c.name, expected, found: `version ${v}`, status: "matches", reason: "Matches the baseline.", actionable: false }
                : { label: c.name, expected, found: `version ${v}`, status: "conflict", reason: "A different version is installed. A baseline never changes package versions.", actionable: false };
        }
      }
      if (intentional !== null && row.status !== "matches" && row.status !== "not-checked") {
        return { conventionId: c.id, kind: c.kind, ...row, status: "different-by-design", reason: "Marked intentional on this server.", actionable: false, intentional };
      }
      return { conventionId: c.id, kind: c.kind, ...row, intentional };
    });
  }

  private comparison(b: StoredBaseline<Convention>, targetId: string, target: BaselineServerInfo, inv: Inventory): Comparison {
    return { baselineId: b.id, version: b.version, targetId, observedAt: inv.collectedAt, source: inv.source, rows: this.rows(b, targetId, target, inv) };
  }

  async compare(baselineId: string, targetId: string): Promise<Out<Comparison>> {
    const b = this.o.store.latest<Convention>(baselineId);
    const target = this.server(targetId);
    if (b === null || target === undefined) return fail(404, "NOT_FOUND");
    const inv = await this.collect(targetId);
    if (!inv.ok) return inv;
    this.targetCache.set(targetId, { at: this.now().getTime(), inventory: inv.value });
    return ok(this.comparison(b, targetId, target, inv.value));
  }

  /** The last comparison's inventory, if fresh enough; otherwise a new read-only inventory. */
  private async targetInventory(targetId: string): Promise<Out<Inventory>> {
    const c = this.targetCache.get(targetId);
    if (c !== undefined && this.now().getTime() - c.at <= INVENTORY_REUSE_MS) return ok(c.inventory);
    const inv = await this.collect(targetId);
    if (inv.ok) this.targetCache.set(targetId, { at: this.now().getTime(), inventory: inv.value });
    return inv;
  }

  async setException(baselineId: string, targetId: string, conventionId: string, reason: string | null | undefined, actor: string): Promise<Out<Comparison>> {
    const b = this.o.store.latest<Convention>(baselineId);
    const target = this.server(targetId);
    const c = b?.conventions.find((x) => x.id === conventionId);
    if (b === null || target === undefined || c === undefined) return fail(404, "NOT_FOUND");
    const label = c.kind === "directory" ? dirLabel(c) : c.name;
    const at = this.now().toISOString();
    if (reason === undefined) this.o.store.unmark(baselineId, targetId, conventionId, label, actor, at);
    else this.o.store.mark(baselineId, targetId, conventionId, label, reason, actor, at);
    const inv = await this.targetInventory(targetId);
    if (!inv.ok) return inv;
    return ok(this.comparison(b, targetId, target, inv.value));
  }

  history(baselineId: string, targetId: string | null): Out<HistoryEvent[]> {
    if (this.o.store.latest(baselineId) === null) return fail(404, "NOT_FOUND");
    return ok(this.o.store.history(baselineId, targetId));
  }

  async setupPlan(baselineId: string, targetId: string, actor: string): Promise<Out<SetupPlanResult>> {
    const b = this.o.store.latest<Convention>(baselineId);
    const target = this.server(targetId);
    if (b === null || target === undefined) return fail(404, "NOT_FOUND");
    const planner = this.o.plan();
    if (planner === null) return fail(503, "UNAVAILABLE", "Plans cannot be made right now.");
    const inv = await this.targetInventory(targetId);
    if (!inv.ok) return inv;
    const rows = this.rows(b, targetId, target, inv.value);
    const byId = new Map(b.conventions.map((c) => [c.id, c]));
    const specs: DirectorySpec[] = [];
    const notIncluded: Array<{ label: string; reason: string }> = [];
    for (const r of rows) {
      const c = byId.get(r.conventionId);
      if (c === undefined || r.status === "matches") continue;
      if (c.kind === "directory" && r.actionable && r.status === "missing") {
        const owner = c.owner === LOGIN_USER ? target.user : c.owner;
        const group = c.group === LOGIN_USER ? target.user : c.group;
        if (owner === null || group === null) notIncluded.push({ label: r.label, reason: "The target's login user is unknown." });
        else specs.push({ path: r.label, owner, group, mode: c.mode });
      } else if (r.status !== "different-by-design") {
        notIncluded.push({ label: r.label, reason: r.reason });
      }
    }
    specs.sort((x, y) => (x.path < y.path ? -1 : 1)); // parents before children
    for (const extra of specs.splice(MAX_PLAN_DIRECTORIES)) notIncluded.push({ label: extra.path, reason: `A plan holds at most ${MAX_PLAN_DIRECTORIES} directories. Make another plan after this one.` });
    if (specs.length === 0) return fail(409, "NOT_ALLOWED", "Nothing to prepare: no directory from this baseline is missing.");
    const made = await planner({ operation: "prepare.directories.v1", serverId: targetId, directories: specs });
    if (made === null) return fail(404, "NOT_FOUND");
    this.o.store.recordEvent(baselineId, targetId, actor, `Setup plan ${made.plan.id} proposed for ${specs.length} directories.`, this.now().toISOString());
    return ok({ planId: made.plan.id, included: specs.length, notIncluded });
  }
}
