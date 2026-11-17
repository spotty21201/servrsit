/**
 * Contract for POST /api/assistant/messages (T-044).
 *
 * Shared by the API (producer) and the web client (consumer). Fixed contract:
 *
 *   request   {"message": string (1..2000), "scope": "all" | "<serverId>"}
 *   200       {"answer", "source": "ai" | "deterministic", "model": string | null,
 *              "evidence": [{"serverId", "observedAt"}], "notice": string | null}
 *   400       {"error": "INVALID_INPUT"}
 *   429       {"error": "RATE_LIMITED"}
 *
 * An AI failure is never an error status: it returns 200 with
 * source "deterministic" and a notice. The answer is explanation only. It
 * never creates, approves or runs anything.
 */

import { z } from "zod";

export const ASSISTANT_MESSAGE_MAX_CHARS = 2000;

export const AssistantRequestSchema = z
  .object({
    message: z.string().min(1).max(ASSISTANT_MESSAGE_MAX_CHARS),
    scope: z.union([z.literal("all"), z.string().uuid()]),
  })
  .strict();

export const AssistantEvidenceSchema = z.object({
  serverId: z.string().uuid(),
  /** Time of the successful observation the answer was based on (ISO-8601). */
  observedAt: z.string().datetime(),
});

export const AssistantResponseSchema = z.object({
  answer: z.string().min(1).max(10_000),
  source: z.enum(["ai", "deterministic"]),
  /** The model id the provider reported. Null for deterministic answers. */
  model: z.string().max(100).nullable(),
  evidence: z.array(AssistantEvidenceSchema).max(20),
  notice: z.string().max(600).nullable(),
});

export const AssistantErrorSchema = z.object({
  error: z.enum(["INVALID_INPUT", "RATE_LIMITED"]),
});

export type AssistantRequest = z.infer<typeof AssistantRequestSchema>;
export type AssistantEvidence = z.infer<typeof AssistantEvidenceSchema>;
export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;
export type AssistantError = z.infer<typeof AssistantErrorSchema>;
