/**
 * Build the configured explainer. Default provider is openai_compatible
 * (ADR-013). Anything not usable yields a DisabledExplainer, which never
 * contacts anything and always answers with deterministic text.
 */

import type { AiConfig } from "./config.js";
import { DisabledExplainer, GuardedExplainer, type Explainer, type GuardOptions } from "./explainer.js";
import { createKiroProvider, type KiroProviderOptions } from "./kiro.js";
import { createOpenAiProvider, type OpenAiProviderDeps } from "./openai.js";

export interface CreateExplainerOptions extends GuardOptions {
  readonly openai?: OpenAiProviderDeps | undefined;
  readonly kiro?: KiroProviderOptions | undefined;
}

export function createExplainer(config: AiConfig, options: CreateExplainerOptions = {}): Explainer {
  if (config.provider === "openai_compatible" && config.openai !== null) {
    return new GuardedExplainer(createOpenAiProvider(config.openai, options.openai), options);
  }
  if (config.provider === "kiro") {
    return new GuardedExplainer(createKiroProvider(options.kiro), options);
  }
  return new DisabledExplainer(config.problems.length > 0 ? "not_configured" : "provider_disabled", options.now);
}
