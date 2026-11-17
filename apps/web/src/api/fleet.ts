/**
 * Client for GET /api/fleet.
 *
 * Data-integration layer only: no UI. Every response is validated against the
 * shared schema from @servrsit/contracts, so the UI never renders data the API
 * contract does not describe. The function never throws: callers get a result
 * object, and failures are explicit so they can be shown next to the last good
 * data (a failed check is never hidden behind a healthy state).
 *
 * Error messages are fixed text written here. Response bodies are untrusted
 * and are never copied into messages.
 */

import { FleetResponseSchema, type FleetResponse } from "@servrsit/contracts";

export const FLEET_ENDPOINT = "/api/fleet";
export const FLEET_TIMEOUT_MS = 10_000;
/** Upper bound for a fleet response body, in bytes. The real payload is a few KB. */
export const FLEET_MAX_BYTES = 512 * 1024;

export type FleetErrorKind = "timeout" | "network" | "http" | "invalid-response" | "aborted";

export interface FleetError {
  readonly kind: FleetErrorKind;
  /** Fixed, display-safe text. */
  readonly message: string;
  /** HTTP status, for kind "http". */
  readonly status?: number;
  /** Short diagnostic written by this module (for example schema paths). Never body text. */
  readonly detail?: string;
}

export type FleetResult =
  | { readonly ok: true; readonly data: FleetResponse; /** Browser clock, ISO-8601. */ readonly receivedAt: string }
  | { readonly ok: false; readonly error: FleetError };

export interface FetchFleetOptions {
  /** Cancels the request. Reported as kind "aborted". */
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly endpoint?: string;
  /** For tests. Defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

const MESSAGES: Readonly<Record<FleetErrorKind, string>> = {
  timeout: "The ServrSit API did not respond in time.",
  network: "Could not reach the ServrSit API.",
  http: "The ServrSit API returned an unexpected status.",
  "invalid-response": "The ServrSit API returned data in an unexpected format.",
  aborted: "The request was cancelled.",
};

function httpMessage(status: number): string {
  if (status === 401 || status === 403) return "Not signed in, or not allowed to view the fleet.";
  if (status === 404) return "The fleet endpoint was not found. Is the API running and proxied?";
  if (status >= 500) return "The ServrSit API reported an error.";
  return MESSAGES.http;
}

function failure(kind: FleetErrorKind, extra: { status?: number; detail?: string } = {}): FleetResult {
  const error: FleetError = {
    kind,
    message: kind === "http" && extra.status !== undefined ? httpMessage(extra.status) : MESSAGES[kind],
    ...(extra.status === undefined ? {} : { status: extra.status }),
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
  };
  return { ok: false, error };
}

/** Schema paths only (for example "servers.0.status"). No values are included. */
function issuePaths(issues: ReadonlyArray<{ path: ReadonlyArray<string | number> }>): string {
  return issues
    .slice(0, 3)
    .map((i) => (i.path.length === 0 ? "(root)" : i.path.join(".")))
    .join(", ");
}

export async function fetchFleet(options: FetchFleetOptions = {}): Promise<FleetResult> {
  const { signal, timeoutMs = FLEET_TIMEOUT_MS, endpoint = FLEET_ENDPOINT } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => new Date());

  if (signal?.aborted) return failure("aborted");

  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    const response = await doFetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });

    if (!response.ok) return failure("http", { status: response.status });

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > FLEET_MAX_BYTES) {
      return failure("invalid-response", { detail: "response too large" });
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).length > FLEET_MAX_BYTES) {
      return failure("invalid-response", { detail: "response too large" });
    }

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return failure("invalid-response", { detail: "response was not JSON" });
    }

    const parsed = FleetResponseSchema.safeParse(json);
    if (!parsed.success) {
      return failure("invalid-response", { detail: issuePaths(parsed.error.issues) });
    }
    return { ok: true, data: parsed.data, receivedAt: now().toISOString() };
  } catch {
    if (timedOut) return failure("timeout");
    if (signal?.aborted) return failure("aborted");
    return failure("network");
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}
