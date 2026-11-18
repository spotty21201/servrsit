/**
 * Shared JSON transport for the T-076..T-079 clients. Data layer only.
 *
 *  - Same-origin, no-store, bounded body size, timeout.
 *  - State-changing calls carry the session's CSRF header (./auth). A 403
 *    CSRF_INVALID re-reads the session once and retries: the server refused
 *    before doing anything.
 *  - Success bodies must match the given schema; error bodies must match the
 *    given error schema. Anything else is INVALID_RESPONSE and is never shown.
 *  - Never throws.
 */

import { csrfHeaders, getSession } from "./auth";

export const API_TIMEOUT_MS = 15_000;
export const API_MAX_BYTES = 2 * 1024 * 1024;

export type TransportErrorCode = "NETWORK" | "TIMEOUT" | "INVALID_RESPONSE" | "CSRF_INVALID" | "UNAUTHENTICATED";

export interface Parser<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false };
}

export interface CsrfSource {
  headers(): Promise<Record<string, string>>;
  refresh?(): Promise<void>;
}

/** The signed-in session's token, kept in memory by ./auth. */
export const sessionCsrf: CsrfSource = {
  headers: async () => csrfHeaders(),
  refresh: async () => {
    await getSession();
  },
};

export interface HttpOptions {
  readonly fetchImpl?: typeof fetch;
  readonly csrf?: CsrfSource;
  readonly timeoutMs?: number;
}

export type HttpResult<T, E> = { readonly ok: true; readonly data: T; readonly status: number } | { readonly ok: false; readonly error: E | { readonly error: TransportErrorCode } };

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function createHttp(options: HttpOptions = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const csrf = options.csrf ?? sessionCsrf;
  const timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;

  async function once<T, E>(method: Method, path: string, body: unknown, ok: Parser<T> | null, err: Parser<E>, accept: "json" | "text"): Promise<HttpResult<T, E>> {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: accept === "json" ? "application/json" : "text/plain" };
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
      if (text.length > API_MAX_BYTES) return { ok: false, error: { error: "INVALID_RESPONSE" } };
      if (r.ok && accept === "text") {
        const p = ok?.safeParse(text);
        return p === undefined || p.success ? { ok: true, data: (p?.success ? p.data : text) as T, status: r.status } : { ok: false, error: { error: "INVALID_RESPONSE" } };
      }
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
        const e = err.safeParse(json);
        return e.success ? { ok: false, error: e.data } : { ok: false, error: { error: "INVALID_RESPONSE" } };
      }
      if (ok === null) return r.status === 204 ? { ok: true, data: null as T, status: 204 } : { ok: false, error: { error: "INVALID_RESPONSE" } };
      const p = ok.safeParse(json);
      return p.success ? { ok: true, data: p.data, status: r.status } : { ok: false, error: { error: "INVALID_RESPONSE" } };
    } catch {
      return { ok: false, error: { error: controller.signal.aborted ? "TIMEOUT" : "NETWORK" } };
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  return async function call<T, E>(method: Method, path: string, body: unknown, ok: Parser<T> | null, err: Parser<E>, accept: "json" | "text" = "json"): Promise<HttpResult<T, E>> {
    const first = await once(method, path, body, ok, err, accept);
    if (first.ok || (first.error as { error: string }).error !== "CSRF_INVALID") return first;
    try {
      await csrf.refresh?.();
    } catch {
      return first;
    }
    return once(method, path, body, ok, err, accept);
  };
}
