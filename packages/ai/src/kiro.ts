/**
 * Interim Kiro adapter (ADR-012).
 *
 * The model produces explanation TEXT only. That text is never executed, never
 * parsed for commands or approvals, and never treated as evidence of server
 * state. The agent has no tools. If anything goes wrong the caller gets
 * deterministic text marked "ai_unavailable", and inspection keeps working.
 *
 * Kiro usage is metered, so calls are cached and limited to one per server per
 * ten minutes. Failed calls count against that window.
 *
 * Deviation from Technical Spec §15 (Bedrock): Kiro's data-retention terms have
 * not been verified against the product data policy, so this adapter is for the
 * founder's own servers only, never customer data.
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripEscapeSequences, sanitizeText } from "@servrsit/ssh";
import { deterministicExplanation } from "./deterministic.js";
import { buildAiInput, type AiServerInput, type ExplainableServer } from "./input.js";
import { spawnKiro, type KiroRunner } from "./runner.js";

export const AGENT_NAME = "servrsit-explainer";
/** Override with KIRO_CLI_PATH. The default is the standard per-user install location. */
export const KIRO_BINARY = process.env["KIRO_CLI_PATH"] ?? join(homedir(), ".local", "bin", "kiro-cli");
export const DEFAULT_WORKSPACE = new URL("../kiro-workspace", import.meta.url).pathname;
export const CALL_TIMEOUT_MS = 20_000;
export const MIN_CALL_INTERVAL_MS = 10 * 60_000;
export const CACHE_TTL_MS = 60 * 60_000;
const MAX_OUTPUT_BYTES = 32 * 1024;
const MAX_TEXT_CHARS = 1200;

export const DISCLAIMER =
  "Explanation only. Not evidence of server state, and never used to approve or run anything.";

export type AiUnavailableReason =
  | "timeout"
  | "process_error"
  | "empty_output"
  | "unsafe_output"
  | "rate_limited"
  | "quota_or_auth";

export interface ExplainResult {
  readonly status: "ok" | "ai_unavailable";
  /** AI text when status is "ok"; otherwise deterministic text. Never empty. */
  readonly text: string;
  readonly source: "kiro" | "deterministic";
  readonly reason: AiUnavailableReason | null;
  readonly cached: boolean;
  readonly generatedAt: string;
  readonly disclaimer: typeof DISCLAIMER;
}

export interface KiroExplainerOptions {
  readonly runner?: KiroRunner | undefined;
  readonly now?: (() => Date) | undefined;
  readonly kiroBinary?: string | undefined;
  readonly workspace?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly minCallIntervalMs?: number | undefined;
  readonly cacheTtlMs?: number | undefined;
}

interface CacheEntry {
  readonly hash: string;
  readonly at: number;
  readonly result: ExplainResult;
}

/** Output we refuse to show as explanation: code blocks or command-looking lines. */
const UNSAFE_OUTPUT = /```|^\s*[$#]\s+\S|\bsudo\b|\brm\s+-rf\b|\bcurl\b[^\n]*\|\s*(ba)?sh/im;
const QUOTA_OR_AUTH = /limit|quota|usage|unauthori[sz]ed|not logged in|log ?in|credential|expired|forbidden/i;

/** The prompt. The data is fenced, and `<` is escaped so it cannot close the fence. */
export function buildPrompt(input: AiServerInput): string {
  const json = JSON.stringify(input).replace(/</g, "\\u003c");
  return `Explain this server's current state for its owner.\n<observations>\n${json}\n</observations>`;
}

/** The complete kiro-cli argument vector. `--trust-tools=` trusts no tool at all. */
export function buildKiroArgs(prompt: string): string[] {
  return ["chat", "--no-interactive", "--agent", AGENT_NAME, "--trust-tools=", "--wrap", "never", prompt];
}

function hashInput(input: AiServerInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export class KiroExplainer {
  private readonly runner: KiroRunner;
  private readonly now: () => Date;
  private readonly binary: string;
  private readonly workspace: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly lastCallAt = new Map<string, number>();
  private readonly cache = new Map<string, CacheEntry>();
  private callCount = 0;

  constructor(options: KiroExplainerOptions = {}) {
    this.runner = options.runner ?? spawnKiro;
    this.now = options.now ?? (() => new Date());
    this.binary = options.kiroBinary ?? KIRO_BINARY;
    this.workspace = options.workspace ?? DEFAULT_WORKSPACE;
    this.timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;
    this.minIntervalMs = options.minCallIntervalMs ?? MIN_CALL_INTERVAL_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
  }

  /** Number of model calls made so far (for metering visibility and tests). */
  get calls(): number {
    return this.callCount;
  }

  async explain(serverId: string, server: ExplainableServer): Promise<ExplainResult> {
    const input = buildAiInput(server);
    const nowMs = this.now().getTime();
    const hash = hashInput(input);

    const cached = this.cache.get(serverId);
    if (cached !== undefined && cached.hash === hash && nowMs - cached.at < this.cacheTtlMs) {
      return { ...cached.result, cached: true };
    }

    const last = this.lastCallAt.get(serverId);
    if (last !== undefined && nowMs - last < this.minIntervalMs) {
      return this.fallback(server, "rate_limited");
    }

    this.lastCallAt.set(serverId, nowMs);
    this.callCount += 1;
    const run = await this.runner({
      file: this.binary,
      args: buildKiroArgs(buildPrompt(input)),
      cwd: this.workspace,
      timeoutMs: this.timeoutMs,
      maxStdoutBytes: MAX_OUTPUT_BYTES,
    });

    if (run.timedOut) return this.fallback(server, "timeout");
    if (run.spawnFailed) return this.fallback(server, "process_error");
    if (run.exitCode !== 0) {
      return this.fallback(server, QUOTA_OR_AUTH.test(run.stderr) ? "quota_or_auth" : "process_error");
    }

    const text = sanitizeText(stripEscapeSequences(run.stdout), MAX_TEXT_CHARS).trim();
    if (text.length === 0) return this.fallback(server, "empty_output");
    if (UNSAFE_OUTPUT.test(run.stdout)) return this.fallback(server, "unsafe_output");

    const result: ExplainResult = {
      status: "ok",
      text,
      source: "kiro",
      reason: null,
      cached: false,
      generatedAt: this.now().toISOString(),
      disclaimer: DISCLAIMER,
    };
    this.cache.set(serverId, { hash, at: nowMs, result });
    return result;
  }

  private fallback(server: ExplainableServer, reason: AiUnavailableReason): ExplainResult {
    return {
      status: "ai_unavailable",
      text: deterministicExplanation(server),
      source: "deterministic",
      reason,
      cached: false,
      generatedAt: this.now().toISOString(),
      disclaimer: DISCLAIMER,
    };
  }
}
