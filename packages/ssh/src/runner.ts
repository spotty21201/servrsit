/**
 * Subprocess runner.
 *
 * Commands are always started from an executable path plus an argument
 * array with `shell: false`. There is no local shell string anywhere
 * (execution-security steering, "SSH invocation rules"). Output capture is
 * bounded; a run that exceeds its byte cap or wall-clock budget is killed.
 */

import { spawn } from "node:child_process";

export interface RunRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

export interface RunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  /** Used only to classify failures. Never returned to API callers. */
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly stdoutTruncated: boolean;
  /** Set when the process could not be started at all. */
  readonly spawnFailed: boolean;
}

export type CommandRunner = (request: RunRequest) => Promise<RunResult>;

/** A fixed, minimal environment. No SSH agent, no askpass, no inherited secrets. */
const CHILD_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  LC_ALL: "C",
  LANG: "C",
};

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...CHILD_ENV };
  const home = process.env["HOME"];
  if (home !== undefined) env["HOME"] = home;
  return env;
}

export const spawnRunner: CommandRunner = (request) =>
  new Promise<RunResult>((resolve) => {
    let child;
    try {
      child = spawn(request.file, [...request.args], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: childEnv(),
        windowsHide: true,
      });
    } catch {
      resolve({
        exitCode: null, stdout: "", stderr: "", timedOut: false,
        stdoutTruncated: false, spawnFailed: true,
      });
      return;
    }

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let stdoutTruncated = false;
    let timedOut = false;
    let spawnFailed = false;
    let settled = false;

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
        stdoutTruncated,
        spawnFailed,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, request.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) return;
      const room = request.maxStdoutBytes - outBytes;
      if (chunk.length > room) {
        if (room > 0) out.push(chunk.subarray(0, room));
        outBytes = request.maxStdoutBytes;
        stdoutTruncated = true;
        child.kill("SIGKILL");
        return;
      }
      out.push(chunk);
      outBytes += chunk.length;
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const room = request.maxStderrBytes - errBytes;
      if (room <= 0) return;
      err.push(chunk.subarray(0, room));
      errBytes += Math.min(chunk.length, room);
    });

    child.on("error", () => {
      spawnFailed = true;
      finish(null);
    });
    child.on("close", (code) => finish(code));

    child.stdin.on("error", () => {
      // The process may exit before reading all input. The exit code and the
      // missing section markers already describe that outcome.
    });
    child.stdin.end(request.stdin);
  });
