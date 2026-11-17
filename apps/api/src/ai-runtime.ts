/**
 * Load the AI configuration for the API process.
 *
 * Variables come only from the environment, with apps/api/.env (gitignored,
 * mode 600) filling in what the real environment does not set. Everything
 * here is safe to log: messages name variables, never values.
 *
 * The API key is collected for redaction whenever it is present, even if the
 * configuration is rejected and the provider fails closed to "none".
 */

import { describeAiConfig, loadAiEnv, resolveAiConfig, type AiConfig, type Env } from "@servrsit/ai";

export const DEFAULT_ENV_FILE = new URL("../.env", import.meta.url).pathname;

export interface AiRuntime {
  readonly config: AiConfig;
  /** Values that must never appear in logs, errors or responses. */
  readonly redactSecrets: readonly string[];
  readonly notes: ReadonlyArray<{ readonly level: "info" | "warn"; readonly message: string }>;
}

export function loadAiRuntime(envFile: string | null = DEFAULT_ENV_FILE, base: Env = process.env): AiRuntime {
  const loaded = loadAiEnv(envFile, base);
  const config = resolveAiConfig(loaded.env);
  const notes: Array<{ level: "info" | "warn"; message: string }> = [];

  if (loaded.file === "missing") {
    notes.push({ level: "info", message: "apps/api/.env was not found; using the process environment only" });
  } else if (loaded.file === "unreadable") {
    notes.push({ level: "warn", message: "apps/api/.env exists but could not be read" });
  } else if (loaded.looseMode) {
    notes.push({ level: "warn", message: "apps/api/.env is readable by other users; run chmod 600 on it" });
  }
  notes.push({
    level: config.provider === "none" && config.problems.length > 0 ? "warn" : "info",
    message: describeAiConfig(config),
  });

  const key = loaded.env["AI_API_KEY"];
  const redactSecrets = key !== undefined && key.trim() !== "" ? [key.trim()] : [];
  return { config, redactSecrets, notes };
}
