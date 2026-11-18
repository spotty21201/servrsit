/**
 * Guarded explainer core, shared by every model provider.
 *
 * The model produces explanation TEXT only. That text is untrusted: it is
 * length-capped, stripped of control sequences, refused if it looks like a
 * command, and never executed, never parsed into actions, never treated as
 * authorization or as evidence of server state. If anything goes wrong the
 * caller gets deterministic text marked "ai_unavailable", and inspection keeps
 * working (FR-08).
 *
 * Metered/third-party providers are protected by a cache (identical input is
 * not asked twice) and by a limit of one call per server per ten minutes.
 * Failed calls count against that window.
 */

import { createHash } from "node:crypto";
import { sanitizeText, stripEscapeSequences } from "@servrsit/ssh";
import { deterministicExplanation } from "./deterministic.js";
import { checkFacts, jokesAboutBadNews } from "./fact-check.js";
import { buildAiInput, type AiServerInput, type ExplainableServer } from "./input.js";
import { buildPrompt } from "./prompt.js";
import { DEFAULT_TIME_ZONE, timesAreQuoted, type TimeContext } from "./time.js";

export const CALL_TIMEOUT_MS = 20_000;
export const MIN_CALL_INTERVAL_MS = 10 * 60_000;
export const CACHE_TTL_MS = 60 * 60_000;
export const MAX_TEXT_CHARS = 1200;

export const DISCLAIMER =
  "Explanation only. Not evidence of server state, and never used to approve or run anything.";

export type ProviderId = "openai_compatible" | "kiro";

export type AiUnavailableReason =
  | "timeout"
  | "process_error"
  | "empty_output"
  | "unsafe_output"
  | "rate_limited"
  | "quota_or_auth"
  | "provider_error"
  | "malformed_response"
  | "not_configured"
  | "provider_disabled"
  | "not_supported"
  | "unverified_time"
  | "fact_mismatch"
  | "truncated_output"
  | "unsuitable_tone";

export interface ExplainMeta {
  readonly provider: ProviderId | "none";
  /** The model we asked for, when the provider has such a notion. */
  readonly requestedModel: string | null;
  /** The model id the provider reported in its reply. May differ from the requested one. */
  readonly returnedModel: string | null;
  readonly latencyMs: number | null;
  readonly httpStatus: number | null;
}

export interface ExplainResult {
  readonly status: "ok" | "ai_unavailable";
  /** Model text when status is "ok"; otherwise deterministic text. Never empty. */
  readonly text: string;
  readonly source: ProviderId | "deterministic";
  readonly reason: AiUnavailableReason | null;
  readonly cached: boolean;
  readonly generatedAt: string;
  readonly disclaimer: typeof DISCLAIMER;
  readonly meta: ExplainMeta;
}

export type ProviderOutcome =
  | { readonly ok: true; readonly text: string; readonly returnedModel: string | null; readonly httpStatus: number | null }
  | { readonly ok: false; readonly reason: AiUnavailableReason; readonly httpStatus: number | null };

/** A free-form request: a fixed system prompt plus user text. No tools, no functions. */
export interface CompletionRequest {
  readonly system: string;
  readonly user: string;
}

export interface ModelProvider {
  readonly id: ProviderId;
  readonly requestedModel: string | null;
  call(input: AiServerInput, ctx: TimeContext): Promise<ProviderOutcome>;
  /** Optional. Providers that cannot take a custom system prompt (Kiro) omit it. */
  complete?(request: CompletionRequest): Promise<ProviderOutcome>;
}

export interface Explainer {
  readonly providerId: ProviderId | "none";
  /** Number of provider calls made so far (metering visibility and tests). */
  readonly calls: number;
  explain(serverId: string, server: ExplainableServer): Promise<ExplainResult>;
}

export interface GuardOptions {
  readonly now?: (() => Date) | undefined;
  /** Owner time zone for every time the model sees or the owner reads. Default Asia/Jakarta. */
  readonly timeZone?: string | undefined;
  readonly minCallIntervalMs?: number | undefined;
  readonly cacheTtlMs?: number | undefined;
}

/** Output we refuse to show as explanation: code blocks or command-looking lines. */
export const UNSAFE_OUTPUT = /```|^\s*[$#]\s+\S|\bsudo\b|\brm\s+-rf\b|\bcurl\b[^\n]*\|\s*(ba)?sh/im;

function hashInput(input: AiServerInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

interface CacheEntry {
  readonly hash: string;
  readonly at: number;
  readonly result: ExplainResult;
}

export class GuardedExplainer implements Explainer {
  private readonly now: () => Date;
  private readonly timeZone: string;
  private readonly minIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly lastCallAt = new Map<string, number>();
  private readonly cache = new Map<string, CacheEntry>();
  private callCount = 0;

  constructor(
    private readonly provider: ModelProvider,
    options: GuardOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
    this.minIntervalMs = options.minCallIntervalMs ?? MIN_CALL_INTERVAL_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
  }

  get providerId(): ProviderId {
    return this.provider.id;
  }

  get calls(): number {
    return this.callCount;
  }

  async explain(serverId: string, server: ExplainableServer): Promise<ExplainResult> {
    const ctx: TimeContext = { timeZone: this.timeZone, now: this.now() };
    const input = buildAiInput(server, ctx);
    const nowMs = ctx.now.getTime();
    const hash = hashInput(input);

    const cached = this.cache.get(serverId);
    if (cached !== undefined && cached.hash === hash && nowMs - cached.at < this.cacheTtlMs) {
      return { ...cached.result, cached: true };
    }

    const last = this.lastCallAt.get(serverId);
    if (last !== undefined && nowMs - last < this.minIntervalMs) {
      return this.fallback(server, ctx, "rate_limited", null, null);
    }

    this.lastCallAt.set(serverId, nowMs);
    this.callCount += 1;
    const started = performance.now();
    const outcome = await this.provider.call(input, ctx);
    const latencyMs = Math.round(performance.now() - started);

    if (!outcome.ok) return this.fallback(server, ctx, outcome.reason, outcome.httpStatus, latencyMs);

    const text = sanitizeText(stripEscapeSequences(outcome.text), MAX_TEXT_CHARS).trim();
    if (text.length === 0) return this.fallback(server, ctx, "empty_output", outcome.httpStatus, latencyMs, outcome.returnedModel);
    if (UNSAFE_OUTPUT.test(outcome.text)) {
      return this.fallback(server, ctx, "unsafe_output", outcome.httpStatus, latencyMs, outcome.returnedModel);
    }
    const prompt = buildPrompt(input, ctx);
    if (!timesAreQuoted(outcome.text, prompt).ok) {
      return this.fallback(server, ctx, "unverified_time", outcome.httpStatus, latencyMs, outcome.returnedModel);
    }
    // T-064 O1: the per-server explanation gets the same fact and tone checks as the assistant.
    if (!checkFacts(text, [input], prompt).ok) {
      return this.fallback(server, ctx, "fact_mismatch", outcome.httpStatus, latencyMs, outcome.returnedModel);
    }
    if (jokesAboutBadNews(text)) {
      return this.fallback(server, ctx, "unsuitable_tone", outcome.httpStatus, latencyMs, outcome.returnedModel);
    }

    const result: ExplainResult = {
      status: "ok",
      text,
      source: this.provider.id,
      reason: null,
      cached: false,
      generatedAt: this.now().toISOString(),
      disclaimer: DISCLAIMER,
      meta: this.meta(outcome.returnedModel, latencyMs, outcome.httpStatus),
    };
    this.cache.set(serverId, { hash, at: nowMs, result });
    return result;
  }

  private meta(returnedModel: string | null, latencyMs: number | null, httpStatus: number | null): ExplainMeta {
    return {
      provider: this.provider.id,
      requestedModel: this.provider.requestedModel,
      returnedModel,
      latencyMs,
      httpStatus,
    };
  }

  private fallback(
    server: ExplainableServer,
    ctx: TimeContext,
    reason: AiUnavailableReason,
    httpStatus: number | null,
    latencyMs: number | null,
    returnedModel: string | null = null,
  ): ExplainResult {
    return {
      status: "ai_unavailable",
      text: deterministicExplanation(server, ctx),
      source: "deterministic",
      reason,
      cached: false,
      generatedAt: this.now().toISOString(),
      disclaimer: DISCLAIMER,
      meta: this.meta(returnedModel, latencyMs, httpStatus),
    };
  }
}

/** Used when no provider is configured or AI is switched off. Never calls anything. */
export class DisabledExplainer implements Explainer {
  readonly providerId = "none" as const;
  readonly calls = 0;

  constructor(
    private readonly reason: "not_configured" | "provider_disabled",
    private readonly now: () => Date = () => new Date(),
    private readonly timeZone: string = DEFAULT_TIME_ZONE,
  ) {}

  async explain(_serverId: string, server: ExplainableServer): Promise<ExplainResult> {
    return {
      status: "ai_unavailable",
      text: deterministicExplanation(server, { timeZone: this.timeZone, now: this.now() }),
      source: "deterministic",
      reason: this.reason,
      cached: false,
      generatedAt: this.now().toISOString(),
      disclaimer: DISCLAIMER,
      meta: { provider: "none", requestedModel: null, returnedModel: null, latencyMs: null, httpStatus: null },
    };
  }
}
