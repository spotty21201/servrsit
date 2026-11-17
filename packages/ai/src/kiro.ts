/**
 * Kiro CLI provider (AI_PROVIDER=kiro). Kept as an alternative to the default
 * OpenAI-compatible provider (ADR-013).
 *
 * The agent has no tools and is run with `--trust-tools=`. Kiro usage is
 * metered; the shared guard in explainer.ts caches and rate-limits calls.
 *
 * Deviation from Technical Spec §15 (Bedrock): Kiro's data-retention terms
 * have not been verified against the product data policy, so this is for the
 * founder's own servers only, never customer data.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  CALL_TIMEOUT_MS,
  GuardedExplainer,
  type AiUnavailableReason,
  type GuardOptions,
  type ModelProvider,
  type ProviderOutcome,
} from "./explainer.js";
import type { AiServerInput } from "./input.js";
import { buildPrompt } from "./prompt.js";
import type { TimeContext } from "./time.js";
import { spawnKiro, type KiroRunner } from "./runner.js";

export { buildPrompt } from "./prompt.js";
export { CALL_TIMEOUT_MS, DISCLAIMER, MIN_CALL_INTERVAL_MS } from "./explainer.js";
export type { AiUnavailableReason, ExplainResult } from "./explainer.js";

export const AGENT_NAME = "servrsit-explainer";
/** Override with KIRO_CLI_PATH. The default is the standard per-user install location. */
export const KIRO_BINARY = process.env["KIRO_CLI_PATH"] ?? join(homedir(), ".local", "bin", "kiro-cli");
export const DEFAULT_WORKSPACE = new URL("../kiro-workspace", import.meta.url).pathname;
const MAX_OUTPUT_BYTES = 32 * 1024;
const QUOTA_OR_AUTH = /limit|quota|usage|unauthori[sz]ed|not logged in|log ?in|credential|expired|forbidden/i;

/** The complete kiro-cli argument vector. `--trust-tools=` trusts no tool at all. */
export function buildKiroArgs(prompt: string): string[] {
  return ["chat", "--no-interactive", "--agent", AGENT_NAME, "--trust-tools=", "--wrap", "never", prompt];
}

export interface KiroProviderOptions {
  readonly runner?: KiroRunner | undefined;
  readonly kiroBinary?: string | undefined;
  readonly workspace?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export function createKiroProvider(options: KiroProviderOptions = {}): ModelProvider {
  const runner = options.runner ?? spawnKiro;
  const binary = options.kiroBinary ?? KIRO_BINARY;
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;

  return {
    id: "kiro",
    requestedModel: null,
    async call(input: AiServerInput, ctx: TimeContext): Promise<ProviderOutcome> {
      const run = await runner({
        file: binary,
        args: buildKiroArgs(buildPrompt(input, ctx)),
        cwd: workspace,
        timeoutMs,
        maxStdoutBytes: MAX_OUTPUT_BYTES,
      });
      const fail = (reason: AiUnavailableReason): ProviderOutcome => ({ ok: false, reason, httpStatus: null });
      if (run.timedOut) return fail("timeout");
      if (run.spawnFailed) return fail("process_error");
      if (run.exitCode !== 0) return fail(QUOTA_OR_AUTH.test(run.stderr) ? "quota_or_auth" : "process_error");
      return { ok: true, text: run.stdout, returnedModel: null, httpStatus: null };
    },
  };
}

export interface KiroExplainerOptions extends KiroProviderOptions, GuardOptions {}

export class KiroExplainer extends GuardedExplainer {
  constructor(options: KiroExplainerOptions = {}) {
    super(createKiroProvider(options), options);
  }
}
