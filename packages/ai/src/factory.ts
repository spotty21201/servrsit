/**
 * Build the configured explainer. Default provider is openai_compatible
 * (ADR-013). Anything not usable yields a DisabledExplainer, which never
 * contacts anything and always answers with deterministic text.
 */

import { AssistantResponder } from "./assistant.js";
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
  return new DisabledExplainer(
    config.problems.length > 0 ? "not_configured" : "provider_disabled",
    options.now,
    options.timeZone,
  );
}

/**
 * Build the assistant for the configured provider. Only providers that accept
 * a custom system prompt can answer questions; others (Kiro, none) get the
 * deterministic summary with an honest reason.
 */
export function createAssistant(config: AiConfig, options: CreateExplainerOptions = {}): AssistantResponder {
  if (config.provider === "openai_compatible" && config.openai !== null) {
    return new AssistantResponder(createOpenAiProvider(config.openai, options.openai), "not_configured", {
      knownSecrets: [config.openai.apiKey],
    });
  }
  if (config.provider === "kiro") return new AssistantResponder(null, "not_supported");
  return new AssistantResponder(null, config.problems.length > 0 ? "not_configured" : "provider_disabled");
}
