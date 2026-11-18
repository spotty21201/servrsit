/**
 * Server registration client (T-069). Data-integration layer only: no UI.
 *
 * Same interface as the Designer's stub (apps/web/src/api/stubs/servers.ts on
 * feat/designer/t067), so the Connect screen switches by swapping
 * `createFixtureServersClient()` for `createServersClient()`. Two calls are
 * added for the server pages: `updateServer` (rename/describe) and
 * `disconnect`.
 *
 * Every response is validated against @servrsit/contracts. Nothing here
 * throws: callers get a result object. Error reasons come only from the
 * contract's fixed texts; response bodies that do not match are reported as
 * INVALID_RESPONSE, never shown.
 *
 * CSRF: state-changing calls carry the session's CSRF header (T-053,
 * `csrfHeaders()` from ./auth). A 403 CSRF_INVALID re-reads the session
 * (which refreshes the token) and retries once: the server refused before
 * doing anything, so the retry is safe. A 401 is UNAUTHENTICATED: sign in.
 */

import {
  ActivateResponseSchema,
  DisconnectResponseSchema,
  FirstCheckSchema,
  ServerDraftSchema,
  ServerRegistrationErrorSchema,
  type ActivateResponse,
  type DisconnectResponse,
  type FirstCheck,
  type HostKeyConfirmRequest,
  type ServerDraft,
  type ServerDraftRequest,
  type ServerRegistrationError,
  ServerUpdateResponseSchema,
  type ServerUpdateRequest,
  type ServerUpdateResponse,
} from "@servrsit/contracts";
import { csrfHeaders, getSession } from "./auth";

export type { ServerUpdateResponse };

export const SERVERS_TIMEOUT_MS = 15_000;
export const SERVERS_MAX_BYTES = 64 * 1024;

export type ServersClientErrorCode = "NETWORK" | "TIMEOUT" | "INVALID_RESPONSE" | "CSRF_INVALID" | "UNAUTHENTICATED";

export type ServersResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: ServerRegistrationError | { readonly error: ServersClientErrorCode; readonly reason?: undefined };
    };

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
  /** Rename or describe. Nothing else can be changed. */
  updateServer(id: string, body: ServerUpdateRequest): Promise<ServersResult<ServerUpdateResponse>>;
  /** Stops checks and deletes ServrSit's key. `remoteKeyRemoved` is always false. */
  disconnect(id: string): Promise<ServersResult<DisconnectResponse>>;
}

export interface CsrfSource {
  headers(): Promise<Record<string, string>>;
  /** Fetch a fresh token after the server refused one. */
  refresh?(): Promise<void>;
}

/** The signed-in session's token, kept in memory by ./auth. */
export const sessionCsrf: CsrfSource = {
  headers: async () => csrfHeaders(),
  refresh: async () => {
    await getSession();
  },
};

export interface ServersClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly csrf?: CsrfSource;
  readonly timeoutMs?: number;
}

interface Parser<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false };
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export function createServersClient(options: ServersClientOptions = {}): ServersClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const csrf = options.csrf ?? sessionCsrf;
  const timeoutMs = options.timeoutMs ?? SERVERS_TIMEOUT_MS;

  async function once<T>(method: Method, path: string, body: unknown, schema: Parser<T> | null): Promise<ServersResult<T>> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (method !== "GET") Object.assign(headers, await csrf.headers());
      const r = await fetchImpl(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const text = r.status === 204 ? "" : await r.text();
      if (text.length > SERVERS_MAX_BYTES) return { ok: false, error: { error: "INVALID_RESPONSE" } };
      let json: unknown = null;
      try {
        json = text === "" ? null : JSON.parse(text);
      } catch {
        return { ok: false, error: { error: "INVALID_RESPONSE" } };
      }
      if (!r.ok) {
        const code = (json as { error?: unknown } | null)?.error;
        if (r.status === 403 && code === "CSRF_INVALID") return { ok: false, error: { error: "CSRF_INVALID" } };
        if (r.status === 401) return { ok: false, error: { error: "UNAUTHENTICATED" } };
        const e = ServerRegistrationErrorSchema.safeParse(json);
        return e.success ? { ok: false, error: e.data } : { ok: false, error: { error: "INVALID_RESPONSE" } };
      }
      if (schema === null) return r.status === 204 ? { ok: true, data: null as T } : { ok: false, error: { error: "INVALID_RESPONSE" } };
      const p = schema.safeParse(json);
      return p.success ? { ok: true, data: p.data } : { ok: false, error: { error: "INVALID_RESPONSE" } };
    } catch {
      return { ok: false, error: { error: controller.signal.aborted ? "TIMEOUT" : "NETWORK" } };
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  async function call<T>(method: Method, path: string, body: unknown, schema: Parser<T> | null): Promise<ServersResult<T>> {
    const first = await once(method, path, body, schema);
    if (first.ok || first.error.error !== "CSRF_INVALID") return first;
    try {
      await csrf.refresh?.();
    } catch {
      return first;
    }
    return once(method, path, body, schema);
  }

  const e = encodeURIComponent;
  const draft = (id: string, rest = "") => `/api/servers/drafts/${e(id)}${rest}`;
  return {
    createDraft: (req) => call("POST", "/api/servers/drafts", req, ServerDraftSchema),
    getDraft: (id) => call("GET", draft(id), undefined, ServerDraftSchema),
    deleteDraft: (id) => call("DELETE", draft(id), undefined, null),
    scanHostKey: (id) => call("POST", draft(id, "/host-key"), undefined, ServerDraftSchema),
    confirmHostKey: (id, body) => call("POST", draft(id, "/host-key/confirm"), body, ServerDraftSchema),
    issueAccessKey: (id) => call("POST", draft(id, "/access-key"), undefined, ServerDraftSchema),
    startFirstCheck: (id) => call("POST", draft(id, "/first-check"), undefined, FirstCheckSchema),
    getFirstCheck: (id) => call("GET", draft(id, "/first-check"), undefined, FirstCheckSchema),
    activate: (id) => call("POST", draft(id, "/activate"), undefined, ActivateResponseSchema),
    updateServer: (id, body) => call("PATCH", `/api/servers/${e(id)}`, body, ServerUpdateResponseSchema),
    disconnect: (id) => call("POST", `/api/servers/${e(id)}/disconnect`, undefined, DisconnectResponseSchema),
  };
}
