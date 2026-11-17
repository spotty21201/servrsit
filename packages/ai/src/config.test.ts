import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeAiConfig, loadAiEnv, resolveAiConfig, type Env } from "./config.js";
import { createExplainer } from "./factory.js";
import { FAKE_API_KEY, server } from "./ai.fixtures.js";

const GOOD: Env = {
  AI_PROVIDER: "openai_compatible",
  AI_BASE_URL: "https://ai.example.test/v1/",
  AI_API_KEY: FAKE_API_KEY,
  AI_MODEL: "deepseek-v4.1-flash",
  AI_TIMEOUT_MS: "15000",
};
const without = (...keys: string[]): Env => Object.fromEntries(Object.entries(GOOD).filter(([k]) => !keys.includes(k)));

test("a complete configuration selects openai_compatible and normalises the URL", () => {
  const c = resolveAiConfig(GOOD);
  assert.equal(c.provider, "openai_compatible");
  assert.deepEqual(c.problems, []);
  assert.deepEqual(c.openai, { baseUrl: "https://ai.example.test/v1", apiKey: FAKE_API_KEY, model: "deepseek-v4.1-flash", timeoutMs: 15000 });
});

test("openai_compatible is the default when AI_PROVIDER is unset", () => {
  assert.equal(resolveAiConfig(without("AI_PROVIDER")).provider, "openai_compatible");
  assert.equal(resolveAiConfig({ ...GOOD, AI_PROVIDER: "" }).provider, "openai_compatible");
});

test("timeout defaults to 20000 when unset", () => {
  assert.equal(resolveAiConfig(without("AI_TIMEOUT_MS")).openai?.timeoutMs, 20000);
});

test("kiro and none are selectable explicitly", () => {
  assert.equal(resolveAiConfig({ AI_PROVIDER: "kiro" }).provider, "kiro");
  assert.deepEqual(resolveAiConfig({ AI_PROVIDER: "none" }), { provider: "none", openai: null, problems: [] });
  assert.equal(resolveAiConfig({ AI_PROVIDER: " KIRO " }).provider, "kiro");
});

test("missing variables fail closed to 'none' and name each missing variable", () => {
  const c = resolveAiConfig({});
  assert.equal(c.provider, "none");
  assert.equal(c.openai, null);
  assert.deepEqual(c.problems, ["AI_BASE_URL is not set", "AI_API_KEY is not set", "AI_MODEL is not set"]);
  for (const k of ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL"]) {
    assert.equal(resolveAiConfig(without(k)).provider, "none", k);
  }
});

test("a run of x characters is treated as a placeholder key", () => {
  assert.deepEqual(resolveAiConfig({ ...GOOD, AI_API_KEY: "x".repeat(40) }).problems, ["AI_API_KEY is still the placeholder"]);
});

test("the placeholder values from .env.example fail closed", () => {
  const c = resolveAiConfig({ AI_PROVIDER: "openai_compatible", AI_BASE_URL: "https://example.invalid/v1", AI_API_KEY: "replace-me", AI_MODEL: "replace-me", AI_TIMEOUT_MS: "20000" });
  assert.equal(c.provider, "none");
  assert.equal(c.problems.length, 3);
  assert.ok(c.problems.some((p) => p.includes("AI_API_KEY is still the placeholder")));
});

test("unsafe base URLs are rejected: plain http to a remote host, userinfo, query, link-local, non-URLs", () => {
  for (const url of [
    "http://ai.example.test/v1", "https://user:pw@ai.example.test/v1", "https://ai.example.test/v1?key=abc",
    "https://ai.example.test/v1#x", "https://169.254.169.254/v1", "https://0.0.0.0/v1", "ftp://ai.example.test", "not a url", "https://x.invalid/v1",
  ]) {
    const c = resolveAiConfig({ ...GOOD, AI_BASE_URL: url });
    assert.equal(c.provider, "none", url);
    assert.ok(c.problems.some((p) => p.startsWith("AI_BASE_URL")), url);
    assert.equal(JSON.stringify(c).includes("pw@"), false, "credentials in a rejected URL are not echoed");
  }
});

test("loopback http is allowed (for local mock servers) and so is a normal https URL", () => {
  assert.equal(resolveAiConfig({ ...GOOD, AI_BASE_URL: "http://127.0.0.1:8080/v1" }).provider, "openai_compatible");
  assert.equal(resolveAiConfig({ ...GOOD, AI_BASE_URL: "http://localhost:8080/v1" }).provider, "openai_compatible");
});

test("a key that could break a header is rejected, and the message never contains it", () => {
  for (const key of ["has space in it 12345", "line\nbreak-key-12345", "short", "tab\there12345", "k".repeat(600)]) {
    const c = resolveAiConfig({ ...GOOD, AI_API_KEY: key });
    assert.equal(c.provider, "none");
    assert.deepEqual(c.problems, ["AI_API_KEY has an unexpected format"]);
    assert.equal(JSON.stringify(c).includes(key), false);
  }
});

test("bad timeout and unknown provider values fail closed without echoing the value", () => {
  for (const t of ["abc", "999", "120001", "-5", "1.5", "20s"]) {
    const c = resolveAiConfig({ ...GOOD, AI_TIMEOUT_MS: t });
    assert.equal(c.provider, "none", t);
    assert.deepEqual(c.problems, ["AI_TIMEOUT_MS must be an integer from 1000 to 120000"]);
  }
  const u = resolveAiConfig({ ...GOOD, AI_PROVIDER: "SUPER-SECRET-VALUE" });
  assert.equal(u.provider, "none");
  assert.equal(JSON.stringify(u).includes("SUPER-SECRET-VALUE"), false);
});

test("describeAiConfig never contains the key or the full URL, and says why it failed closed", () => {
  const line = describeAiConfig(resolveAiConfig(GOOD));
  assert.match(line, /openai_compatible \(model deepseek-v4.1-flash, host ai.example.test, timeout 15000 ms\)/);
  assert.equal(line.includes(FAKE_API_KEY), false);
  assert.equal(line.includes("/v1"), false);
  assert.match(describeAiConfig(resolveAiConfig({})), /none \(failing closed\): AI_BASE_URL is not set; AI_API_KEY is not set; AI_MODEL is not set/);
  assert.match(describeAiConfig(resolveAiConfig({ AI_PROVIDER: "none" })), /none \(disabled by configuration\)/);
  assert.match(describeAiConfig(resolveAiConfig({ AI_PROVIDER: "kiro" })), /kiro/);
});

// ---- the env file ---------------------------------------------------------

function envFile(content: string, mode = 0o600): string {
  const dir = mkdtempSync(join(tmpdir(), "servrsit-env-"));
  const file = join(dir, ".env");
  writeFileSync(file, content, { mode });
  chmodSync(file, mode);
  return file;
}

test("loadAiEnv takes only AI_* variables from the file", () => {
  const file = envFile(`AI_PROVIDER=openai_compatible\nAI_API_KEY=${FAKE_API_KEY}\nDATABASE_URL=postgres://nope\nOTHER_SECRET=zzz\n`);
  const loaded = loadAiEnv(file, {});
  assert.equal(loaded.file, "loaded");
  assert.deepEqual(Object.keys(loaded.env).sort(), ["AI_API_KEY", "AI_PROVIDER"]);
  assert.equal(loaded.looseMode, false);
});

test("real environment variables take precedence over the file", () => {
  const file = envFile("AI_MODEL=from-file\nAI_TIMEOUT_MS=5000\n");
  const loaded = loadAiEnv(file, { AI_MODEL: "from-env", PATH: "/usr/bin" });
  assert.equal(loaded.env["AI_MODEL"], "from-env");
  assert.equal(loaded.env["AI_TIMEOUT_MS"], "5000");
  assert.equal("PATH" in loaded.env, false);
});

test("a missing file is reported, not thrown, and the real environment still applies", () => {
  const loaded = loadAiEnv("/nonexistent/dir/.env", { AI_PROVIDER: "none" });
  assert.equal(loaded.file, "missing");
  assert.equal(loaded.env["AI_PROVIDER"], "none");
  assert.equal(loadAiEnv(null, {}).file, "missing");
});

test("a group- or world-readable file is flagged", () => {
  assert.equal(loadAiEnv(envFile("AI_MODEL=x\n", 0o644), {}).looseMode, true);
  assert.equal(loadAiEnv(envFile("AI_MODEL=x\n", 0o600), {}).looseMode, false);
});

test("file -> config end to end, and a half-filled file fails closed", () => {
  const full = loadAiEnv(envFile(`AI_BASE_URL=https://ai.example.test/v1\nAI_API_KEY=${FAKE_API_KEY}\nAI_MODEL=m1\n`), {});
  assert.equal(resolveAiConfig(full.env).provider, "openai_compatible");
  const half = loadAiEnv(envFile("AI_MODEL=m1\n"), {});
  assert.equal(resolveAiConfig(half.env).provider, "none");
});

// ---- factory --------------------------------------------------------------

test("the factory makes a disabled explainer that never calls anything when failing closed", async () => {
  const failed = createExplainer(resolveAiConfig({}));
  assert.equal(failed.providerId, "none");
  const r = await failed.explain("s1", server());
  assert.equal(r.status, "ai_unavailable");
  assert.equal(r.reason, "not_configured");
  assert.equal(r.meta.provider, "none");
  assert.match(r.text, /Nabire: fresh/);
  assert.equal(failed.calls, 0);

  const off = await createExplainer(resolveAiConfig({ AI_PROVIDER: "none" })).explain("s1", server());
  assert.equal(off.reason, "provider_disabled");
});

test("the factory picks the provider named by the configuration", () => {
  assert.equal(createExplainer(resolveAiConfig(GOOD)).providerId, "openai_compatible");
  assert.equal(createExplainer(resolveAiConfig({ AI_PROVIDER: "kiro" })).providerId, "kiro");
});
