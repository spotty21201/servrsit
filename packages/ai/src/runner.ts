/**
 * Runner for the kiro-cli subprocess. Argument array, `shell: false`, a fixed
 * working directory, an allowlisted environment, bounded output, a hard timeout.
 */

import { spawn } from "node:child_process";

export interface KiroRunRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
}

export interface KiroRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnFailed: boolean;
}

export type KiroRunner = (request: KiroRunRequest) => Promise<KiroRunResult>;

/** Only what kiro-cli needs to find its own login state. No cloud or SSH credentials. */
const ENV_ALLOWLIST = ["HOME", "PATH", "LANG", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR"] as const;

function allowlistedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NO_COLOR: "1", TERM: "dumb" };
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export const spawnKiro: KiroRunner = (request) =>
  new Promise<KiroRunResult>((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let spawnFailed = false;
    let settled = false;

    let child;
    try {
      child = spawn(request.file, [...request.args], {
        shell: false,
        cwd: request.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: allowlistedEnv(),
        windowsHide: true,
      });
    } catch {
      resolve({ exitCode: null, stdout: "", stderr: "", timedOut: false, spawnFailed: true });
      return;
    }

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
        spawnFailed,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, request.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const room = request.maxStdoutBytes - outBytes;
      if (room <= 0) return;
      out.push(chunk.subarray(0, room));
      outBytes += Math.min(chunk.length, room);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const room = 8 * 1024 - errBytes;
      if (room <= 0) return;
      err.push(chunk.subarray(0, room));
      errBytes += Math.min(chunk.length, room);
    });
    child.on("error", () => {
      spawnFailed = true;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
