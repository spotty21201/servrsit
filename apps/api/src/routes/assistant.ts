/**
 * POST /api/assistant/messages (T-044, Technical Spec §13).
 *
 *   body   {"message": string (1..2000), "scope": "all" | "<serverId>"}
 *   200    {"answer", "source": "ai"|"deterministic", "model", "evidence", "notice"}
 *   400    {"error": "INVALID_INPUT"}   bad JSON, wrong shape, or an unknown serverId
 *   429    {"error": "RATE_LIMITED"}    more than 10 messages per minute
 *
 * An AI failure is never an error status: the answer falls back to a
 * deterministic summary, source "deterministic", with a notice.
 *
 * The answer is explanation only. This route creates, approves and runs
 * nothing. Message text is never logged: log lines carry the kind of message,
 * its length, the source and the reason only.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AssistantRequestSchema,
  AssistantResponseSchema,
  type AssistantEvidence,
  type AssistantResponse,
  type FleetServer,
} from "@servrsit/contracts";
import type { AiUnavailableReason, AssistantReply, AssistantResponder } from "@servrsit/ai";
import { SlidingWindowLimiter } from "../assistant/rate-limit.js";

export const ASSISTANT_RATE_LIMIT = 10;
export const ASSISTANT_RATE_WINDOW_MS = 60_000;
/** Generous for 2000 characters plus JSON escaping; anything larger is not a valid message. */
export const ASSISTANT_BODY_LIMIT_BYTES = 16 * 1024;

export interface AssistantRouteOptions {
  readonly assistant: AssistantResponder;
  /** Current fleet view. Never contacts a server. */
  readonly fleet: () => { readonly servers: readonly FleetServer[] };
  readonly limiter?: SlidingWindowLimiter | undefined;
  /** Owner's IANA time zone for every time in the answer (DEF-L1). */
  readonly timeZone: string;
  /** For tests. */
  readonly now?: (() => Date) | undefined;
  /** The prepared owner-context layer (T-050), or null for none. Read per request. */
  readonly ownerContext?: (() => string | null) | undefined;
}

export const SECRET_NOTICE =
  "Your message was not sent to the AI and was not stored. Do not paste keys, tokens or passwords into chat. Credentials belong in the protected server setup, which is not available yet.";
export const CHANGE_NOTICE =
  "Changes go through a reviewed plan. Chat cannot update, restart, reboot or approve anything.";
export const AI_SOURCE_NOTICE =
  "AI-generated explanation of the latest checks. It is not evidence and cannot change or approve anything. Check the server cards for the authoritative status.";
export const NO_EVIDENCE_NOTICE =
  "No server in this scope has a successful check yet, so this answer has no observations to rely on.";

/** T-051: exact wording from the brief. */
export const FACT_MISMATCH_NOTICE = "The AI answer did not match the latest checks, so here are the checks directly.";

const UNAVAILABLE_NOTICES: Readonly<Partial<Record<AiUnavailableReason, string>>> = {
  not_configured: "The AI is not configured, so this is a summary of the latest checks instead.",
  provider_disabled: "The AI is switched off, so this is a summary of the latest checks instead.",
  not_supported: "The configured AI provider cannot answer questions, so this is a summary of the latest checks instead.",
  timeout: "The AI did not answer in time, so this is a summary of the latest checks instead.",
  quota_or_auth: "The AI refused the request (access or quota), so this is a summary of the latest checks instead.",
  unsafe_output: "The AI's reply was withheld because it looked like a command, so this is a summary of the latest checks instead.",
  unverified_time: "The AI's reply was withheld because it stated a time that was not in the data, so this is a summary of the latest checks instead.",
  fact_mismatch: FACT_MISMATCH_NOTICE,
};
const DEFAULT_UNAVAILABLE_NOTICE = "The AI is unavailable right now, so this is a summary of the latest checks instead.";

function noticeFor(reply: AssistantReply, hasEvidence: boolean): string {
  if (reply.kind === "secret") return SECRET_NOTICE;
  if (reply.kind === "change_request") return CHANGE_NOTICE;
  const base =
    reply.source === "ai"
      ? AI_SOURCE_NOTICE
      : reply.reason === null
        ? DEFAULT_UNAVAILABLE_NOTICE
        : UNAVAILABLE_NOTICES[reply.reason] ?? DEFAULT_UNAVAILABLE_NOTICE;
  return hasEvidence ? base : `${base} ${NO_EVIDENCE_NOTICE}`;
}

/** Servers whose last successful observation was in front of the model or the summary. */
function evidenceFor(servers: readonly FleetServer[]): AssistantEvidence[] {
  const out: AssistantEvidence[] = [];
  for (const s of servers.slice(0, 20)) {
    if (s.observedAt !== null && s.observation !== null) out.push({ serverId: s.id, observedAt: s.observedAt });
  }
  return out;
}

const invalid = (reply: FastifyReply) => reply.code(400).send({ error: "INVALID_INPUT" });

export async function assistantRoutes(fastify: FastifyInstance, options: AssistantRouteOptions): Promise<void> {
  const limiter = options.limiter ?? new SlidingWindowLimiter(ASSISTANT_RATE_LIMIT, ASSISTANT_RATE_WINDOW_MS);

  // Malformed JSON, a wrong content type and oversize bodies are client errors.
  // They use this route's fixed error contract, not Fastify's default body.
  fastify.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 400 && status < 500) {
      request.log.info({ code: (error as { code?: string }).code ?? null }, "assistant: rejected request");
      return invalid(reply);
    }
    request.log.error({ err: error }, "assistant: request failed");
    return reply.code(500).send({ statusCode: 500, error: "Internal Server Error", message: "Internal Server Error" });
  });

  fastify.post(
    "/api/assistant/messages",
    { bodyLimit: ASSISTANT_BODY_LIMIT_BYTES },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = AssistantRequestSchema.safeParse(request.body);
      if (!parsed.success) return invalid(reply);
      const { message, scope } = parsed.data;
      if (message.trim().length === 0) return invalid(reply);

      const all = options.fleet().servers;
      const scoped = scope === "all" ? all : all.filter((s) => s.id === scope);
      // An unknown id is invalid input. Same answer for any id we do not have.
      if (scope !== "all" && scoped.length === 0) return invalid(reply);

      if (!limiter.tryAcquire()) {
        const retry = Math.max(1, Math.ceil(limiter.retryAfterMs() / 1000));
        request.log.info({ retryAfterSeconds: retry }, "assistant: rate limited");
        return reply.code(429).header("retry-after", String(retry)).send({ error: "RATE_LIMITED" });
      }

      const result = await options.assistant.respond(
        message,
        scoped,
        { timeZone: options.timeZone, now: (options.now ?? (() => new Date()))() },
        options.ownerContext?.() ?? null,
      );
      const usedObservations = result.kind === "question";
      const evidence = usedObservations ? evidenceFor(scoped) : [];

      const body: AssistantResponse = AssistantResponseSchema.parse({
        answer: result.text,
        source: result.source,
        model: result.source === "ai" ? result.model : null,
        evidence,
        notice: noticeFor(result, !usedObservations || evidence.length > 0),
      });

      // Never the message text. Only its kind and size.
      request.log.info(
        {
          kind: result.kind,
          messageChars: message.length,
          scope: scope === "all" ? "all" : "server",
          servers: scoped.length,
          source: result.source,
          reason: result.reason,
          // T-051: the mismatch type only, never the reply text.
          factMismatch: result.factMismatch,
          httpStatus: result.httpStatus,
          latencyMs: result.latencyMs,
        },
        "assistant: answered",
      );
      return reply.code(200).header("cache-control", "no-store").send(body);
    },
  );
}

export default assistantRoutes;
