/**
 * AI provider configuration. Comes ONLY from environment variables, which the
 * API loads from apps/api/.env (gitignored, mode 600).
 *
 *   AI_PROVIDER    openai_compatible (default) | kiro | none
 *   AI_BASE_URL    https URL of the OpenAI-compatible API (up to and including /v1)
 *   AI_API_KEY     bearer credential
 *   AI_MODEL       model id to request
 *   AI_TIMEOUT_MS  per-request timeout, 1000..120000 (default 20000)
 *
 * Fails closed: anything missing, malformed or still a placeholder turns the
 * provider into "none" and says which variable is wrong. Messages name
 * variables only; they never contain a value.
 */

import { readFileSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import { isBlockedAddress } from "@servrsit/ssh";

export type ProviderChoice = "openai_compatible" | "kiro" | "none";

export interface OpenAiConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
}

export interface AiConfig {
  readonly provider: ProviderChoice;
  readonly openai: OpenAiConfig | null;
  /** Why the provider is "none" when it was not asked for. Variable names only. */
  readonly problems: readonly string[];
}

export const DEFAULT_AI_TIMEOUT_MS = 20_000;
const CHOICES: readonly ProviderChoice[] = ["openai_compatible", "kiro", "none"];
const MODEL_ID = /^[A-Za-z0-9._:/@-]{1,100}$/;
const PLACEHOLDER = /^(replace-me|changeme|change-me|your[-_ ]?key|xxx+)$/i;

export type Env = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function validBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  if (host.endsWith(".invalid") || host === "invalid") return null;
  const loopback = isLoopback(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  if (!loopback && isBlockedAddress(host.replace(/^\[|\]$/g, ""))) return null;
  return url.toString().replace(/\/+$/, "");
}

export function resolveAiConfig(env: Env): AiConfig {
  const rawProvider = env["AI_PROVIDER"]?.trim().toLowerCase();
  const provider: string = rawProvider === undefined || rawProvider === "" ? "openai_compatible" : rawProvider;

  if (!(CHOICES as readonly string[]).includes(provider)) {
    return { provider: "none", openai: null, problems: ["AI_PROVIDER has an unsupported value"] };
  }
  if (provider === "none") return { provider: "none", openai: null, problems: [] };
  if (provider === "kiro") return { provider: "kiro", openai: null, problems: [] };

  const problems: string[] = [];
  const baseUrlRaw = env["AI_BASE_URL"];
  const apiKey = env["AI_API_KEY"];
  const model = env["AI_MODEL"];
  const timeoutRaw = env["AI_TIMEOUT_MS"];

  let baseUrl: string | null = null;
  if (!present(baseUrlRaw)) problems.push("AI_BASE_URL is not set");
  else {
    baseUrl = validBaseUrl(baseUrlRaw.trim());
    if (baseUrl === null) problems.push("AI_BASE_URL is not a usable https URL (or is still the placeholder)");
  }

  if (!present(apiKey)) problems.push("AI_API_KEY is not set");
  else if (PLACEHOLDER.test(apiKey.trim())) problems.push("AI_API_KEY is still the placeholder");
  else if (!/^[\x21-\x7e]{8,512}$/.test(apiKey)) problems.push("AI_API_KEY has an unexpected format");

  if (!present(model)) problems.push("AI_MODEL is not set");
  else if (PLACEHOLDER.test(model.trim()) || !MODEL_ID.test(model.trim())) problems.push("AI_MODEL is not a usable model id");

  let timeoutMs = DEFAULT_AI_TIMEOUT_MS;
  if (present(timeoutRaw)) {
    const n = /^\d{1,6}$/.test(timeoutRaw.trim()) ? Number(timeoutRaw.trim()) : Number.NaN;
    if (!Number.isInteger(n) || n < 1000 || n > 120_000) problems.push("AI_TIMEOUT_MS must be an integer from 1000 to 120000");
    else timeoutMs = n;
  }

  if (problems.length > 0 || baseUrl === null || !present(apiKey) || !present(model)) {
    return { provider: "none", openai: null, problems };
  }
  return { provider: "openai_compatible", openai: { baseUrl, apiKey, model: model.trim(), timeoutMs }, problems: [] };
}

/** A one-line, secret-free description for logs. */
export function describeAiConfig(config: AiConfig): string {
  if (config.provider === "openai_compatible" && config.openai !== null) {
    const host = new URL(config.openai.baseUrl).host;
    return `AI provider: openai_compatible (model ${config.openai.model}, host ${host}, timeout ${config.openai.timeoutMs} ms)`;
  }
  if (config.provider === "kiro") return "AI provider: kiro (no-tools agent)";
  if (config.problems.length > 0) return `AI provider: none (failing closed): ${config.problems.join("; ")}`;
  return "AI provider: none (disabled by configuration)";
}

export interface LoadedAiEnv {
  readonly env: Record<string, string | undefined>;
  readonly file: "loaded" | "missing" | "unreadable";
  /** True when the file is readable by group or others. */
  readonly looseMode: boolean;
}

/**
 * Read AI_* variables from a dotenv-style file, with real environment
 * variables taking precedence. Only AI_* keys are taken; nothing else in the
 * file is kept, and nothing from it is ever logged.
 */
export function loadAiEnv(file: string | null, base: Env = process.env): LoadedAiEnv {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) if (k.startsWith("AI_")) env[k] = v;
  if (file === null) return { env, file: "missing", looseMode: false };

  let content: string;
  let looseMode = false;
  try {
    looseMode = (statSync(file).mode & 0o077) !== 0;
    content = readFileSync(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { env, file: code === "ENOENT" ? "missing" : "unreadable", looseMode: false };
  }
  for (const [k, v] of Object.entries(parseEnv(content))) {
    if (k.startsWith("AI_") && env[k] === undefined) env[k] = v;
  }
  return { env, file: "loaded", looseMode };
}
