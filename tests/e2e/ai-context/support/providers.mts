/**
 * Model providers for the tests.
 *
 *  - ScriptedProvider: returns a fixed reply and records exactly what it was sent.
 *    Costs nothing. Used for almost everything: it lets a test replay a specific
 *    wrong answer through the REAL assistant pipeline.
 *  - MeteredRealProvider: the product's own OpenAI-compatible provider, behind a
 *    HARD budget. The count lives in a file so it spans test runs, is incremented
 *    BEFORE each call (a failed call still counts), and call number 11 throws.
 *    The API key is loaded by the product's own loader, held in memory only, and
 *    never printed, logged or written.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  createOpenAiProvider, loadAiEnv, resolveAiConfig,
  type CompletionRequest, type ModelProvider, type ProviderOutcome,
} from "../../../../packages/ai/src/index.ts";

export class ScriptedProvider implements ModelProvider {
  readonly id = "openai_compatible" as const;
  readonly requestedModel = "scripted-fake";
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly reply: string | ((req: CompletionRequest) => string)) {}
  async call(): Promise<ProviderOutcome> { throw new Error("ScriptedProvider.call is not used by the assistant"); }
  async complete(req: CompletionRequest): Promise<ProviderOutcome> {
    this.requests.push(req);
    const text = typeof this.reply === "function" ? this.reply(req) : this.reply;
    return { ok: true, text, returnedModel: "scripted-fake", httpStatus: 200 };
  }
}

export const BUDGET_FILE = "/tmp/tester-ai-budget.json";
export const BUDGET_LIMIT = 10;
export interface CallRecord { n: number; label: string; at: string; ms: number | null; ok: boolean | null; httpStatus: number | null; model: string | null; answer: string | null }

function readBudget(): { limit: number; calls: CallRecord[] } {
  return existsSync(BUDGET_FILE) ? JSON.parse(readFileSync(BUDGET_FILE, "utf8")) : { limit: BUDGET_LIMIT, calls: [] };
}
export const callsUsed = (): number => readBudget().calls.length;
export const callLog = (): CallRecord[] => readBudget().calls;

export class MeteredRealProvider implements ModelProvider {
  readonly id = "openai_compatible" as const;
  readonly requestedModel: string;
  private readonly inner: ModelProvider;
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly label: string, envFile = "/projects/servrsit-coder/apps/api/.env") {
    const cfg = resolveAiConfig(loadAiEnv(envFile).env);
    if (cfg.provider !== "openai_compatible" || cfg.openai === null) {
      throw new Error(`real AI provider is not configured: ${cfg.problems.join("; ") || "unknown"}`);
    }
    this.inner = createOpenAiProvider(cfg.openai);
    this.requestedModel = cfg.openai.model;
  }
  async call(): Promise<ProviderOutcome> { throw new Error("not used"); }
  async complete(req: CompletionRequest): Promise<ProviderOutcome> {
    const b = readBudget();
    if (b.calls.length >= BUDGET_LIMIT) throw new Error(`AI call budget exhausted: ${b.calls.length} of ${BUDGET_LIMIT} used`);
    const rec: CallRecord = { n: b.calls.length + 1, label: this.label, at: new Date().toISOString(), ms: null, ok: null, httpStatus: null, model: null, answer: null };
    b.calls.push(rec);
    writeFileSync(BUDGET_FILE, JSON.stringify(b, null, 1)); // counted BEFORE the call
    this.requests.push(req);
    const t0 = Date.now();
    const out = await this.inner.complete!(req);
    rec.ms = Date.now() - t0;
    rec.ok = out.ok;
    rec.httpStatus = out.httpStatus;
    if (out.ok) { rec.model = out.returnedModel; rec.answer = out.text; }
    writeFileSync(BUDGET_FILE, JSON.stringify(b, null, 1));
    return out;
  }
}
