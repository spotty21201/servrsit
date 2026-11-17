/**
 * Single import point for the assistant client (T-045).
 *
 * UI code imports ONLY from this module. It exposes the throwing API the UI was
 * built against (see assistant.stub.ts), implemented on Coder's real client
 * (assistant.ts), which returns a result object instead of throwing.
 * To go back to the stub, replace this file with: export * from "./assistant.stub.js";
 */
import { askAssistant as askReal, type AssistantErrorKind } from "./assistant.js";
import type { AssistantResponse } from "@servrsit/contracts";

export type { AssistantResponse };
export type AssistantScope = "all" | (string & {});
export type AssistantEvidence = AssistantResponse["evidence"][number];
export type AssistantErrorCode = "INVALID_INPUT" | "RATE_LIMITED" | "NETWORK" | "UNKNOWN";

export class AssistantError extends Error {
  readonly code: AssistantErrorCode;
  constructor(code: AssistantErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AssistantError";
    this.code = code;
  }
}

const CODE_BY_KIND: Readonly<Record<Exclude<AssistantErrorKind, "aborted">, AssistantErrorCode>> = {
  "invalid-input": "INVALID_INPUT",
  "rate-limited": "RATE_LIMITED",
  timeout: "NETWORK",
  network: "NETWORK",
  http: "UNKNOWN",
  "invalid-response": "UNKNOWN",
};

export async function askAssistant(
  message: string,
  scope: AssistantScope,
  signal?: AbortSignal,
): Promise<AssistantResponse> {
  const result = await askReal(message, scope, signal);
  if (result.ok) return result.data;
  if (result.error.kind === "aborted") {
    throw new DOMException("The request was aborted.", "AbortError");
  }
  throw new AssistantError(CODE_BY_KIND[result.error.kind], result.error.message);
}
