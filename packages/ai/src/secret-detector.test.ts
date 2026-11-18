/**
 * T-064 F1: the secret detector's blind spots (Tester, test-report-ai-auth-001).
 * Every value here is fake.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { classifyMessage, looksLikeSecret } from "./assistant.js";
import { pairsSecretWordWithValue, prepareOwnerContext } from "./owner-context.js";

/** The forms the Tester found passing, plus close relatives. */
const MISSED_BEFORE = [
  "DB_PASSWORD=hunter2hunter2",
  "MYSQL_ROOT_PASSWORD: s3cretvalue99",
  "GITHUB_TOKEN=abcdef0123456789abcdef",
  "STRIPE_SECRET_KEY=rk_live_abcdef0123456789",
  "OPENAI_API_KEY=abcdef0123456789abcdef0123",
  "export AWS_SECRET_ACCESS_KEY='abcdefghijklmnop'",
  "The sudo password for Sentani is Tr0ub4dor99",
  "my password was Tr0ub4dor99 last week",
  "tskey-auth-kAbCdE1CNTRL-abcdefghijklmnopqrstuvwxyz012345",
  "sk_live_abcdefghijklmnopqrstuvwx",
  "AIzaSyA-abcdefghijklmnopqrstuvwxyz01234",
  "npm_abcdefghijklmnopqrstuvwxyz0123456789",
  "glpat-abcdefghijklmnopqrstu",
  "hf_abcdefghijklmnopqrstuvwxyz0123456",
];

test("T-064 F1: every form the Tester found is now caught, in chat and in the owner-context file", () => {
  for (const text of MISSED_BEFORE) {
    assert.equal(looksLikeSecret(text), true, text);
    assert.equal(classifyMessage(`hi, ${text} thanks`), "secret", `chat: ${text}`);
    const r = prepareOwnerContext(`## Owner\nSpotty.\n${text}\n`, []);
    assert.deepEqual(r, { ok: false, reason: "secret" }, `file: ${text}`);
  }
});

test("T-064 F1: ordinary questions and the owner's normal notes are not mistaken for secrets", () => {
  for (const text of [
    "Is the password policy on Sentani strong?",
    "The password is required for sudo, right?",
    "Does Timika use a token for its API?",
    "Do not put keys, tokens or passwords here.",
    "How many pending updates does Nabire have?",
    "Rotate secrets yearly is my preference.",
  ]) {
    assert.equal(looksLikeSecret(text), false, text);
  }
});

test("T-064 F1: the owner-context file is stricter than chat: a secret word given any value rejects the file", () => {
  for (const line of ["deploy token: abc123", "api key = xyz789", "Backup passphrase is correcthorse", "credentials: in the vault"]) {
    assert.equal(pairsSecretWordWithValue(line), true, line);
  }
  for (const line of ["Voice: plain English", "Never ask me for passwords.", "Do not put keys, tokens or passwords here."]) {
    assert.equal(pairsSecretWordWithValue(line), false, line);
  }
});
