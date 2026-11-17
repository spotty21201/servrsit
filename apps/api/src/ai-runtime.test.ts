import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAiRuntime } from "./ai-runtime.js";

/** An obviously fake credential. It is not, and never was, a real key. */
const FAKE_KEY = "sk-test-FAKE-0000-not-a-real-key-123456";

function envFile(content: string, mode = 0o600): string {
  const file = join(mkdtempSync(join(tmpdir(), "servrsit-rt-")), ".env");
  writeFileSync(file, content, { mode });
  chmodSync(file, mode);
  return file;
}
const FULL = `AI_PROVIDER=openai_compatible\nAI_BASE_URL=https://ai.example.test/v1\nAI_API_KEY=${FAKE_KEY}\nAI_MODEL=m1\nAI_TIMEOUT_MS=15000\n`;

test("a complete .env selects openai_compatible and redacts the key; the log line is secret-free", () => {
  const rt = loadAiRuntime(envFile(FULL), {});
  assert.equal(rt.config.provider, "openai_compatible");
  assert.deepEqual(rt.redactSecrets, [FAKE_KEY]);
  assert.deepEqual(rt.notes.map((n) => n.level), ["info"]);
  assert.match(rt.notes[0]!.message, /openai_compatible \(model m1, host ai.example.test, timeout 15000 ms\)/);
  assert.equal(JSON.stringify(rt.notes).includes(FAKE_KEY), false);
});

test("a missing .env with no variables fails closed to 'none' with a clear warning", () => {
  const rt = loadAiRuntime("/nonexistent/dir/.env", {});
  assert.equal(rt.config.provider, "none");
  assert.deepEqual(rt.redactSecrets, []);
  assert.deepEqual(rt.notes.map((n) => n.level), ["info", "warn"]);
  assert.match(rt.notes[1]!.message, /none \(failing closed\): AI_BASE_URL is not set; AI_API_KEY is not set; AI_MODEL is not set/);
});

test("when the config is rejected but a key is present, the key is STILL redacted", () => {
  const rt = loadAiRuntime(envFile(`AI_BASE_URL=http://remote.example.test/v1\nAI_API_KEY=${FAKE_KEY}\nAI_MODEL=m1\n`), {});
  assert.equal(rt.config.provider, "none");
  assert.deepEqual(rt.redactSecrets, [FAKE_KEY]);
  assert.equal(JSON.stringify(rt.notes).includes(FAKE_KEY), false);
  assert.ok(rt.notes.some((n) => n.level === "warn" && n.message.includes("AI_BASE_URL")));
});

test("a loose-mode .env produces a warning, and the real environment overrides the file", () => {
  const rt = loadAiRuntime(envFile(FULL, 0o644), { AI_MODEL: "from-env" });
  assert.ok(rt.notes.some((n) => n.level === "warn" && n.message.includes("chmod 600")));
  assert.match(rt.notes.at(-1)!.message, /model from-env/);
});

test("explicit none and kiro are honoured without needing the other variables", () => {
  assert.equal(loadAiRuntime(null, { AI_PROVIDER: "none" }).config.provider, "none");
  assert.deepEqual(loadAiRuntime(null, { AI_PROVIDER: "none" }).notes.at(-1)?.level, "info");
  assert.equal(loadAiRuntime(null, { AI_PROVIDER: "kiro" }).config.provider, "kiro");
});
