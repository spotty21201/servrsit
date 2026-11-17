/**
 * Non-blocking log output for the API process (D4).
 *
 * pino's default stdout destination writes synchronously and, when the pipe is
 * full, retries in a blocking loop. It also flushes synchronously on exit. So
 * a stalled stdout reader (for example a stopped `tee`) blocked the process so
 * hard that it could not exit on SIGTERM or SIGINT.
 *
 * This stream never blocks the event loop and never flushes synchronously:
 *  - writes use async fs.write, one at a time, so lines stay in order
 *  - EAGAIN (pipe full) is retried later on an unref'd timer
 *  - pending output is capped; anything beyond the cap is dropped and counted
 *  - EPIPE / EBADF (reader gone) stops output; the process keeps running
 *
 * Trade-off: log lines can be lost when the reader is stalled or gone. A
 * process that can always be stopped is worth more than those lines.
 */

import { write as fsWrite } from "node:fs";

export const DEFAULT_MAX_PENDING_BYTES = 1024 * 1024;
export const DEFAULT_RETRY_MS = 50;

type WriteFn = (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: null,
  callback: (err: NodeJS.ErrnoException | null, written: number) => void,
) => void;

export interface AsyncLogStreamOptions {
  readonly fd?: number;
  readonly maxPendingBytes?: number;
  readonly retryMs?: number;
  /** For tests. */
  readonly writeFn?: WriteFn;
  readonly setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
}

export interface AsyncLogStream {
  write(message: string): boolean;
  /** Lines dropped because the pending cap was reached or output had stopped. */
  readonly dropped: number;
  readonly pendingBytes: number;
  /** True after the reader went away (EPIPE and similar). */
  readonly stopped: boolean;
}

const RETRYABLE = new Set(["EAGAIN", "EWOULDBLOCK", "EINTR"]);

export function createAsyncLogStream(options: AsyncLogStreamOptions = {}): AsyncLogStream {
  const fd = options.fd ?? 1;
  const maxPending = options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const writeFn: WriteFn = options.writeFn ?? (fsWrite as unknown as WriteFn);
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));

  const queue: Buffer[] = [];
  let pending = 0;
  let inFlight = false;
  let waiting = false;
  let stopped = false;
  let dropped = 0;

  const pump = (): void => {
    if (inFlight || waiting || stopped) return;
    const head = queue[0];
    if (head === undefined) return;
    inFlight = true;
    writeFn(fd, head, 0, head.length, null, (err, written) => {
      inFlight = false;
      if (err !== null) {
        if (RETRYABLE.has(err.code ?? "")) {
          waiting = true;
          setTimer(() => {
            waiting = false;
            pump();
          }, retryMs).unref?.();
          return;
        }
        stopped = true;
        dropped += queue.length;
        queue.length = 0;
        pending = 0;
        return;
      }
      if (written < head.length) {
        queue[0] = head.subarray(written);
      } else {
        queue.shift();
      }
      pending -= written;
      pump();
    });
  };

  return {
    write(message: string): boolean {
      if (stopped) {
        dropped += 1;
        return true;
      }
      const buffer = Buffer.from(message, "utf8");
      if (pending + buffer.length > maxPending) {
        dropped += 1;
        return true;
      }
      queue.push(buffer);
      pending += buffer.length;
      pump();
      return true;
    },
    get dropped() {
      return dropped;
    },
    get pendingBytes() {
      return pending;
    },
    get stopped() {
      return stopped;
    },
  };
}
