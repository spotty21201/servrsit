/**
 * OpenAI-compatible provider (AI_PROVIDER=openai_compatible, the default).
 *
 * POST {AI_BASE_URL}/chat/completions with a bearer token, a fixed system
 * prompt, and the same sanitized structured input the Kiro adapter uses.
 *
 * The request carries no tool, function or response-format fields. The reply
 * is untrusted text: only `choices[0].message.content` is read, any tool or
 * function call in the reply is ignored, and nothing is executed or parsed
 * into actions. Redirects are refused so the credential cannot be forwarded.
 *
 * Errors, results and logs never contain the API key, the URL, or any
 * response body: failures are reduced to a fixed reason plus an HTTP status.
 *
 * Third-party routing proxy (ADR-013): its retention and onward routing are
 * unknown. For the founder's own sanitized server facts only, never customer
 * data.
 */

import { z } from "zod";
import type { OpenAiConfig } from "./config.js";
import type { AiUnavailableReason, CompletionRequest, ModelProvider, ProviderOutcome } from "./explainer.js";
import type { AiServerInput } from "./input.js";
import { buildPrompt, SYSTEM_PROMPT } from "./prompt.js";

/** Upper bound for a reply body. A 120-word explanation is far below this. */
export const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REPLY_TOKENS = 400;
const MODEL_ID = /^[A-Za-z0-9._:/@-]{1,100}$/;

const CompletionSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(z.object({ message: z.object({ content: z.string().nullable().optional() }).passthrough() }).passthrough())
      .min(1),
  })
  .passthrough();

export interface OpenAiProviderDeps {
  readonly fetchImpl?: typeof fetch | undefined;
}

/** The exact request body. Tests assert this shape, so no field is added casually. */
export function buildRequestBody(model: string, request: CompletionRequest): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    temperature: 0.2,
    max_tokens: MAX_REPLY_TOKENS,
    stream: false,
  };
}

/** Read at most `max` bytes. Returns null when the body is larger. */
async function readBounded(response: Response, max: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function statusReason(status: number): AiUnavailableReason {
  if (status === 401 || status === 403 || status === 429) return "quota_or_auth";
  return "provider_error";
}

/** This provider always implements `complete`, so its type says so. */
export type OpenAiProvider = ModelProvider & Required<Pick<ModelProvider, "complete">>;

export function createOpenAiProvider(config: OpenAiConfig, deps: OpenAiProviderDeps = {}): OpenAiProvider {
  const doFetch = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const endpoint = `${config.baseUrl}/chat/completions`;

  return {
    id: "openai_compatible",
    requestedModel: config.model,
    call(input: AiServerInput): Promise<ProviderOutcome> {
      return this.complete({ system: SYSTEM_PROMPT, user: buildPrompt(input) });
    },
    async complete(request: CompletionRequest): Promise<ProviderOutcome> {
      const fail = (reason: AiUnavailableReason, httpStatus: number | null = null): ProviderOutcome => ({
        ok: false,
        reason,
        httpStatus,
      });

      const controller = new AbortController();
      let timedOut = false;
      const timer = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);

      let status: number | null = null;
      try {
        const response = await doFetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(buildRequestBody(config.model, request)),
          redirect: "error",
          signal: controller.signal,
        });
        status = response.status;
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          return fail(statusReason(response.status), response.status);
        }

        const body = await readBounded(response, MAX_RESPONSE_BYTES);
        if (body === null) return fail("malformed_response", status);

        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return fail("malformed_response", status);
        }
        const parsed = CompletionSchema.safeParse(json);
        if (!parsed.success) return fail("malformed_response", status);

        const first = parsed.data.choices[0];
        // Only the text is read. tool_calls / function_call, if present, are ignored.
        const text = first?.message.content ?? "";
        const reported = parsed.data.model;
        const returnedModel = reported !== undefined && MODEL_ID.test(reported) ? reported : null;
        return { ok: true, text, returnedModel, httpStatus: status };
      } catch {
        // Deliberately drops the error: it can carry the URL or request details.
        return fail(timedOut ? "timeout" : "provider_error", status);
      } finally {
        globalThis.clearTimeout(timer);
      }
    },
  };
}
