/**
 * Client for POST /api/assistant/messages.
 *
 *   const result = await askAssistant("How is Nabire?", "all", controller.signal);
 *   if (result.ok) show(result.data.answer, result.data.notice, result.data.evidence);
 *   else showError(result.error.message);
 *
 * Data-integration layer only: no UI. Every response is validated against the
 * shared contract from @servrsit/contracts. The function never throws.
 *
 * The answer is explanation text only. Render it as plain text (never as
 * HTML), always show `notice` when it is not null, and label the answer as
 * AI-generated when `source` is "ai". It is not evidence of server state and
 * nothing in it can approve or run anything.
 *
 * Error messages are fixed text written here. Response bodies are untrusted
 * and are never copied into messages.
 */

import {
  ASSISTANT_MESSAGE_MAX_CHARS,
  AssistantErrorSchema,
  AssistantResponseSchema,
  type AssistantResponse,
} from "@servrsit/contracts";
import { csrfHeaders } from "./auth.js";

export const ASSISTANT_ENDPOINT = "/api/assistant/messages";
/** Slightly above the server's AI timeout, so the server's deterministic fallback normally wins. */
export const ASSISTANT_TIMEOUT_MS = 30_000;
export const ASSISTANT_MAX_BYTES = 64 * 1024;
export { ASSISTANT_MESSAGE_MAX_CHARS };

export type AssistantScope = "all" | (string & {});

export type AssistantErrorKind =
  | "invalid-input"
  | "rate-limited"
  | "timeout"
  | "network"
  | "http"
  | "invalid-response"
  | "aborted";

export interface AssistantClientError {
  readonly kind: AssistantErrorKind;
  /** Fixed, display-safe text. */
  readonly message: string;
  readonly status?: number;
  /** For "rate-limited": seconds to wait, from the Retry-After header. */
  readonly retryAfterSeconds?: number;
}

export type AssistantResult =
  | { readonly ok: true; readonly data: AssistantResponse }
  | { readonly ok: false; readonly error: AssistantClientError };

export interface AskAssistantOptions {
  readonly timeoutMs?: number;
  readonly endpoint?: string;
  /** For tests. Defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

const MESSAGES: Readonly<Record<AssistantErrorKind, string>> = {
  "invalid-input": "That message could not be sent. Messages must be 1 to 2000 characters.",
  "rate-limited": "Too many messages. Please wait a moment and try again.",
  timeout: "The assistant did not respond in time.",
  network: "Could not reach the ServrSit API.",
  http: "The ServrSit API returned an unexpected status.",
  "invalid-response": "The assistant returned data in an unexpected format.",
  aborted: "The request was cancelled.",
};

function failure(kind: AssistantErrorKind, extra: { status?: number; retryAfterSeconds?: number } = {}): AssistantResult {
  return {
    ok: false,
    error: {
      kind,
      message: MESSAGES[kind],
      ...(extra.status === undefined ? {} : { status: extra.status }),
      ...(extra.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: extra.retryAfterSeconds }),
    },
  };
}

function retryAfter(header: string | null): number | undefined {
  if (header === null || !/^\d{1,5}$/.test(header.trim())) return undefined;
  return Number(header.trim());
}

const TOO_LARGE = Symbol("too-large");
const NOT_JSON = Symbol("not-json");

async function readJson(response: Response): Promise<unknown | typeof TOO_LARGE | typeof NOT_JSON> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ASSISTANT_MAX_BYTES) return TOO_LARGE;
  const text = await response.text();
  if (new TextEncoder().encode(text).length > ASSISTANT_MAX_BYTES) return TOO_LARGE;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}

/**
 * Ask the assistant. Input is checked locally first (same rules as the server),
 * so an obviously invalid message never leaves the browser.
 */
export async function askAssistant(
  message: string,
  scope: AssistantScope,
  signal?: AbortSignal,
  options: AskAssistantOptions = {},
): Promise<AssistantResult> {
  const { timeoutMs = ASSISTANT_TIMEOUT_MS, endpoint = ASSISTANT_ENDPOINT } = options;
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  if (
    typeof message !== "string" ||
    message.trim().length === 0 ||
    message.length > ASSISTANT_MESSAGE_MAX_CHARS ||
    typeof scope !== "string" ||
    scope.length === 0
  ) {
    return failure("invalid-input");
  }
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
      method: "POST",
      // T-053: a POST needs the session's CSRF token.
      headers: { "Content-Type": "application/json", Accept: "application/json", ...csrfHeaders() },
      body: JSON.stringify({ message, scope }),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });

    if (response.status === 400 || response.status === 429) {
      const body = await readJson(response);
      const parsed = typeof body === "symbol" ? null : AssistantErrorSchema.safeParse(body);
      if (parsed?.success && parsed.data.error === "RATE_LIMITED") {
        const wait = retryAfter(response.headers.get("retry-after"));
        return failure("rate-limited", { status: 429, ...(wait === undefined ? {} : { retryAfterSeconds: wait }) });
      }
      if (parsed?.success && parsed.data.error === "INVALID_INPUT") return failure("invalid-input", { status: 400 });
      return failure("http", { status: response.status });
    }
    if (!response.ok) return failure("http", { status: response.status });

    const body = await readJson(response);
    if (typeof body === "symbol") return failure("invalid-response");
    const parsed = AssistantResponseSchema.safeParse(body);
    if (!parsed.success) return failure("invalid-response");
    return { ok: true, data: parsed.data };
  } catch {
    if (timedOut) return failure("timeout");
    if (signal?.aborted) return failure("aborted");
    return failure("network");
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}
