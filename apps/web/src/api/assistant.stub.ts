/**
 * [FIXTURE DATA] TEMPORARY STUB for the assistant client (T-045).
 *
 * Coder owns the real client at apps/web/src/api/assistant.ts. This stub
 * exists only until that file lands. Do not extend it into a real client.
 * Swap: change ONE line in ./assistantClient.ts.
 *
 * Interface the real module must also export (same names), matching the
 * fixed contract POST /api/assistant/messages:
 *   - askAssistant(message, scope, signal): Promise<AssistantResponse>
 *   - class AssistantError extends Error { code: AssistantErrorCode }
 *       thrown for 400 → "INVALID_INPUT", 429 → "RATE_LIMITED",
 *       network/other failures → "NETWORK" / "UNKNOWN".
 *       Aborts reject with the platform AbortError (DOMException), not
 *       AssistantError.
 *   - types AssistantScope, AssistantResponse, AssistantEvidence,
 *     AssistantErrorCode
 * AI failure is NOT an error: the server returns 200 with
 * source "deterministic" and a notice.
 *
 * Stub test hooks (stub only): a message containing "/ratelimit" throws
 * RATE_LIMITED; "/fail" throws NETWORK. Lets the founder see the inline
 * error states without a backend.
 */
import { overviewFixture } from "../fixtures/overview.js";

/** "all" or a server id. */
export type AssistantScope = "all" | (string & {});

export interface AssistantEvidence {
  serverId: string;
  /** ISO-8601 timestamp of the observation the answer relied on. */
  observedAt: string;
}

export interface AssistantResponse {
  answer: string;
  source: "ai" | "deterministic";
  model: string | null;
  evidence: AssistantEvidence[];
  notice: string | null;
}

export type AssistantErrorCode = "INVALID_INPUT" | "RATE_LIMITED" | "NETWORK" | "UNKNOWN";

export class AssistantError extends Error {
  readonly code: AssistantErrorCode;
  constructor(code: AssistantErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AssistantError";
    this.code = code;
  }
}

const MAX_MESSAGE_LENGTH = 2000;
const STUB_DELAY_MS = 600;

function abortError(): DOMException {
  return new DOMException("The request was aborted.", "AbortError");
}

export function askAssistant(
  message: string,
  scope: AssistantScope,
  signal?: AbortSignal,
): Promise<AssistantResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const trimmed = message.trim();
    // Mirrors the server's 400 INVALID_INPUT (1..2000 chars).
    if (trimmed.length < 1 || message.length > MAX_MESSAGE_LENGTH) {
      reject(new AssistantError("INVALID_INPUT"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);

      if (trimmed.includes("/ratelimit")) {
        reject(new AssistantError("RATE_LIMITED"));
        return;
      }
      if (trimmed.includes("/fail")) {
        reject(new AssistantError("NETWORK"));
        return;
      }

      const servers = overviewFixture.data.servers.filter(
        (s) => scope === "all" || s.id === scope,
      );

      const evidence: AssistantEvidence[] = servers
        .filter((s) => s.lastHealthCheckAt !== null)
        .map((s) => ({ serverId: s.id, observedAt: s.lastHealthCheckAt as string }));

      const scopeText = scope === "all" ? "your servers" : (servers[0]?.name ?? "that server");

      resolve({
        answer:
          `This is a stub reply about ${scopeText}. No assistant is connected yet, ` +
          `so nothing was analysed. You asked: "${trimmed.slice(0, 200)}"`,
        source: "deterministic",
        model: null,
        evidence,
        notice: "[FIXTURE] stub reply",
      });
    }, STUB_DELAY_MS);

    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
