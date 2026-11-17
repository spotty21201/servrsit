/**
 * Integration test (D4): the REAL entry point must exit on SIGTERM/SIGINT even
 * when nothing reads its output. Starts src/index.ts as a child process in
 * fixture mode (no SSH) on a free loopback port, never reads its stdout so
 * the pipe fills, then sends the signal.
 *
 * Also checks D2 on the real entry point: PORT is honoured and the bind is
 * 127.0.0.1 only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..");
const tsxLoader = createRequire(import.meta.url).resolve("tsx/esm");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a !== null ? a.port : 0;
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const healthy = (port: number) => async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
    return r.status === 200;
  } catch {
    return false;
  }
};

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`exits on ${signal} while its stdout pipe is full and unread`, { skip: process.platform !== "linux", timeout: 40_000 }, async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ["--import", tsxLoader, "src/index.ts"], {
      cwd: apiDir,
      // T-053: the auth database goes to a temp file, never the real apps/api/.data.
      env: { ...process.env, PORT: String(port), SERVRSIT_FLEET_MODE: "fixture", AI_PROVIDER: "none", SERVRSIT_AUTH_DB: join(mkdtempSync(join(tmpdir(), "servrsit-proc-")), "auth.db") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Deliberately never read stdout/stderr: the pipes fill and stall.
    child.stdout.pause();
    child.stderr.pause();
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));

    try {
      assert.ok(await waitFor(healthy(port), 15_000), "server came up");

      // D2: only the loopback address answers on this port.
      const other = await fetch(`http://[::1]:${port}/health`, { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
      assert.equal(other, false, "nothing listens on ::1");

      // Fill the stdout pipe (each request is logged) well past 64 KiB.
      for (let i = 0; i < 600; i++) {
        await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }).catch(() => undefined);
      }

      child.kill(signal);
      const code = await Promise.race([exited, new Promise<"hung">((r) => setTimeout(() => r("hung"), 12_000))]);
      assert.notEqual(code, "hung", `process did not exit within 12 s of ${signal}`);
      assert.equal(await healthy(port)(), false, "port released");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  });
}
