/**
 * Server registration client (T-068, aligned to the T-069 contract).
 *
 * All request and response types come from @servrsit/contracts
 * (packages/contracts/src/servers.ts); nothing is copied locally. The
 * endpoints are CONTRACT ONLY at the moment (the API does not implement them
 * yet), so the Connect screen uses `createFixtureServersClient()`: an
 * in-memory model of the contract's state machine, with synthetic [FIXTURE]
 * data and the contract's error codes. `createServersClient()` is the real
 * HTTP client for the same interface; switching the screen to it is a
 * one-line change once Coder ships the routes. Coder owns apps/web/src/api/*
 * and may replace this file.
 *
 * Order enforced by the contract (and by the fixture): host key -> owner
 * confirms the fingerprint -> access key -> first check -> activate. Out of
 * order is STATE_CONFLICT. No call ever carries a private key or a password.
 */
import {
  ActivateResponseSchema,
  FirstCheckSchema,
  ServerDraftSchema,
  ServerRegistrationErrorSchema,
  type ActivateResponse,
  type FirstCheck,
  type HostKeyConfirmRequest,
  type ServerDraft,
  type ServerDraftRequest,
  type ServerRegistrationError,
  type ServerRegistrationErrorCode,
} from "@servrsit/contracts";
import { csrfHeaders } from "../auth";

export type ServersResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ServerRegistrationError | { readonly error: "NETWORK" | "INVALID_RESPONSE"; readonly reason?: undefined } };

export interface ServersClient {
  createDraft(req: ServerDraftRequest): Promise<ServersResult<ServerDraft>>;
  getDraft(id: string): Promise<ServersResult<ServerDraft>>;
  deleteDraft(id: string): Promise<ServersResult<null>>;
  /** Read-only key scan. Fills hostKey. */
  scanHostKey(id: string): Promise<ServersResult<ServerDraft>>;
  /** The owner's typed/compared fingerprint; must equal hostKey.fingerprint exactly. */
  confirmHostKey(id: string, body: HostKeyConfirmRequest): Promise<ServersResult<ServerDraft>>;
  /** A key made for THIS server; only the public line is returned. */
  issueAccessKey(id: string): Promise<ServersResult<ServerDraft>>;
  startFirstCheck(id: string): Promise<ServersResult<FirstCheck>>;
  getFirstCheck(id: string): Promise<ServersResult<FirstCheck>>;
  activate(id: string): Promise<ServersResult<ActivateResponse>>;
}

// ── Real HTTP client (same interface; routes are not live yet) ───────────────

interface Parser<T> { safeParse(v: unknown): { success: true; data: T } | { success: false } }

export function createServersClient(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): ServersClient {
  async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body: unknown, schema: Parser<T> | null): Promise<ServersResult<T>> {
    try {
      const r = await fetchImpl(path, {
        method,
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(method === "GET" ? {} : csrfHeaders()) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        credentials: "same-origin",
      });
      const text = r.status === 204 ? "" : await r.text();
      if (text.length > 64 * 1024) return { ok: false, error: { error: "INVALID_RESPONSE" } };
      let json: unknown = null;
      try { json = text === "" ? null : JSON.parse(text); } catch { return { ok: false, error: { error: "INVALID_RESPONSE" } }; }
      if (!r.ok) {
        const e = ServerRegistrationErrorSchema.safeParse(json);
        return e.success ? { ok: false, error: e.data } : { ok: false, error: { error: "INVALID_RESPONSE" } };
      }
      if (schema === null) return { ok: true, data: null as T };
      const p = schema.safeParse(json);
      return p.success ? { ok: true, data: p.data } : { ok: false, error: { error: "INVALID_RESPONSE" } };
    } catch {
      return { ok: false, error: { error: "NETWORK" } };
    }
  }
  const e = encodeURIComponent;
  return {
    createDraft: (req) => call("POST", "/api/servers/drafts", req, ServerDraftSchema),
    getDraft: (id) => call("GET", `/api/servers/drafts/${e(id)}`, undefined, ServerDraftSchema),
    deleteDraft: (id) => call("DELETE", `/api/servers/drafts/${e(id)}`, undefined, null),
    scanHostKey: (id) => call("POST", `/api/servers/drafts/${e(id)}/host-key`, undefined, ServerDraftSchema),
    confirmHostKey: (id, body) => call("POST", `/api/servers/drafts/${e(id)}/host-key/confirm`, body, ServerDraftSchema),
    issueAccessKey: (id) => call("POST", `/api/servers/drafts/${e(id)}/access-key`, undefined, ServerDraftSchema),
    startFirstCheck: (id) => call("POST", `/api/servers/drafts/${e(id)}/first-check`, undefined, FirstCheckSchema),
    getFirstCheck: (id) => call("GET", `/api/servers/drafts/${e(id)}/first-check`, undefined, FirstCheckSchema),
    activate: (id) => call("POST", `/api/servers/drafts/${e(id)}/activate`, undefined, ActivateResponseSchema),
  };
}

// ── [FIXTURE] in-memory model of the contract ────────────────────────────────

/** [FIXTURE] An existing server used to demonstrate DUPLICATE_SERVER. */
export const FIXTURE_DUPLICATE = { address: "192.0.2.10", id: "00000000-0000-4000-8000-0000000000aa", name: "Fixture Existing" } as const;
/** [FIXTURE] An address that demonstrates ROUTE_UNAVAILABLE. */
export const FIXTURE_UNREACHABLE_ADDRESS = "10.99.99.99";
/** [FIXTURE] The fingerprint the fixture host "presents". Not a real key. */
export const FIXTURE_FINGERPRINT = "SHA256:bX7Qf0Zt3m9H2cJkL8aVwYpR5nUe1dGsTiOoNqMxEhA";
const FIXTURE_KEY_FINGERPRINT = "SHA256:Zk3Hn8Wq1Rt6Yp0LcVb4Ju9Ms2DxEaGfOiTgNhUyQwA";

const wait = (ms: number): Promise<void> => new Promise((r) => globalThis.setTimeout(r, ms));
const fail = (error: ServerRegistrationErrorCode, reason?: string): { ok: false; error: ServerRegistrationError } => ({ ok: false, error: { error, ...(reason ? { reason } : {}) } });

const CHECKS: ReadonlyArray<{ id: FirstCheck["steps"][number]["id"]; label: string; unavailable?: string }> = [
  { id: "connect", label: "Connecting to the server" },
  { id: "auth", label: "Signing in with ServrSit's key" },
  { id: "host", label: "Reading host facts (CPU, memory, storage, uptime)" },
  { id: "services", label: "Reading failed services" },
  { id: "clock", label: "Comparing the server's clock" },
  { id: "packages", label: "Reading package state", unavailable: "Reading pending updates needs a permission this account does not have. Everything else still works." },
];

interface Run { polls: number }

export function createFixtureServersClient(now: () => Date = () => new Date(), delayMs = 350): ServersClient {
  const drafts = new Map<string, ServerDraft>();
  const runs = new Map<string, Run>();
  let n = 0;
  const iso = (): string => now().toISOString();
  const save = (d: ServerDraft): ServerDraft => { drafts.set(d.id, d); return d; };
  const find = (id: string): ServerDraft | null => {
    const d = drafts.get(id) ?? null;
    return d;
  };

  function snapshot(d: ServerDraft, run: Run): FirstCheck {
    const steps = CHECKS.map((c, i) => {
      const at = new Date(now().getTime() + i * 1000).toISOString();
      if (i < run.polls - 1) return { id: c.id, label: c.label, state: c.unavailable ? ("unavailable" as const) : ("done" as const), reason: c.unavailable ?? null, at };
      if (i === run.polls - 1) return { id: c.id, label: c.label, state: "running" as const, reason: null, at: null };
      return { id: c.id, label: c.label, state: "waiting" as const, reason: null, at: null };
    });
    const finished = run.polls > CHECKS.length;
    return {
      draftId: d.id,
      steps,
      finished,
      platform: run.polls > 3 ? { supported: true, name: "Ubuntu 24.04.1 LTS" } : null,
      coverage: finished ? { passed: CHECKS.length - 1, total: CHECKS.length } : null,
      failureCode: null,
    };
  }

  return {
    async createDraft(req) {
      await wait(delayMs);
      const dup = req.address === FIXTURE_DUPLICATE.address;
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const t = now();
      return { ok: true, data: save({
        id, state: "draft", address: req.address, port: req.port, user: req.user, name: req.name, role: req.role, production: req.production,
        duplicateOf: dup ? { id: FIXTURE_DUPLICATE.id, name: FIXTURE_DUPLICATE.name } : null,
        reachability: req.address === FIXTURE_UNREACHABLE_ADDRESS
          ? { reachable: false, reason: "It needs a private route to the network the address is on." }
          : { reachable: true, note: "The network path is open. This does not test signing in." },
        hostKey: null, hostKeyConfirmedAt: null, accessKey: null, createdAt: t.toISOString(), expiresAt: new Date(t.getTime() + 24 * 3600_000).toISOString(),
      }) };
    },
    async getDraft(id) { await wait(delayMs / 2); const d = find(id); return d ? { ok: true, data: d } : fail("DRAFT_NOT_FOUND"); },
    async deleteDraft(id) { await wait(delayMs / 2); drafts.delete(id); runs.delete(id); return { ok: true, data: null }; },
    async scanHostKey(id) {
      await wait(delayMs);
      const d = find(id);
      if (!d) return fail("DRAFT_NOT_FOUND");
      if (d.state !== "draft" && d.state !== "host-key-seen") return fail("STATE_CONFLICT", "The host key was already confirmed for this draft.");
      if (!d.reachability.reachable) return fail("ROUTE_UNAVAILABLE", "ServrSit cannot reach this address yet.");
      return { ok: true, data: save({ ...d, state: "host-key-seen", hostKey: { algorithm: "ED25519", fingerprint: FIXTURE_FINGERPRINT, observedAt: iso() } }) };
    },
    async confirmHostKey(id, body) {
      await wait(delayMs);
      const d = find(id);
      if (!d) return fail("DRAFT_NOT_FOUND");
      if (d.state !== "host-key-seen" || !d.hostKey) return fail("STATE_CONFLICT", "Scan the host key first.");
      if (body.fingerprint !== d.hostKey.fingerprint) return fail("FINGERPRINT_MISMATCH", "That fingerprint is not the one the server presented.");
      return { ok: true, data: save({ ...d, state: "host-key-confirmed", hostKeyConfirmedAt: iso() }) };
    },
    async issueAccessKey(id) {
      await wait(delayMs);
      const d = find(id);
      if (!d) return fail("DRAFT_NOT_FOUND");
      if (d.state === "key-issued" && d.accessKey) return { ok: true, data: d };
      if (d.state !== "host-key-confirmed") return fail("HOST_KEY_NOT_CONFIRMED", "Confirm the host key before a key is made.");
      const slug = d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return { ok: true, data: save({ ...d, state: "key-issued", accessKey: {
        authorizedKeysLine: `restrict,from="100.64.0.1" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixtureFixt servrsit-${slug}`,
        algorithm: "ED25519", keyFingerprint: FIXTURE_KEY_FINGERPRINT, controllerAddress: "100.64.0.1", createdAt: iso(),
      } }) };
    },
    async startFirstCheck(id) {
      await wait(delayMs);
      const d = find(id);
      if (!d) return fail("DRAFT_NOT_FOUND");
      if (!["key-issued", "check-failed", "checked"].includes(d.state)) return fail("STATE_CONFLICT", "Issue the access key first.");
      const run: Run = { polls: 0 };
      runs.set(id, run);
      save({ ...d, state: "checking" });
      return { ok: true, data: snapshot(d, run) };
    },
    async getFirstCheck(id) {
      await wait(delayMs);
      const d = find(id);
      const run = runs.get(id);
      if (!d || !run) return fail("DRAFT_NOT_FOUND");
      run.polls++;
      const s = snapshot(d, run);
      if (s.finished && d.state === "checking") save({ ...d, state: "checked" });
      return { ok: true, data: s };
    },
    async activate(id) {
      await wait(delayMs);
      const d = find(id);
      if (!d) return fail("DRAFT_NOT_FOUND");
      if (d.duplicateOf) return fail("DUPLICATE_SERVER", "This address is already registered.");
      if (d.state !== "checked") return fail("STATE_CONFLICT", "Run the first check before adding the server.");
      drafts.delete(id);
      return { ok: true, data: { serverId: "00000000-0000-4000-8000-0000000000ff" } };
    },
  };
}
