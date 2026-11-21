/**
 * T-089: runs the Dispatcher in the API process. One step at a time, never
 * overlapping, one every `intervalMs` (a step is at most a few SSH
 * connections). Backoff after an unreachable target is the
 * Dispatcher's own (deferred outbox entries). An unexpected error is logged
 * and the loop goes on; the operation stays where its store says it is.
 */

import type { Dispatcher } from "@servrsit/worker";

export const DEFAULT_DISPATCH_INTERVAL_MS = 5_000;

export interface DispatchLoopOptions {
  readonly intervalMs?: number | undefined;
  readonly log: { error(o: object, m: string): void; info(o: object, m: string): void };
}

/** Starts the loop; the returned function stops it (a step in flight finishes, no new one starts). */
export function startDispatchLoop(dispatcher: Pick<Dispatcher, "runOnce">, o: DispatchLoopOptions): () => void {
  const interval = o.intervalMs ?? DEFAULT_DISPATCH_INTERVAL_MS;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), ms);
    timer.unref();
  };

  const tick = async () => {
    timer = null;
    try {
      const r = await dispatcher.runOnce();
      if (r.status !== "idle") o.log.info({ operationId: r.operationId, state: r.state }, "writes: dispatcher step");
    } catch (error) {
      o.log.error({ err: error }, "writes: dispatcher step failed");
    }
    schedule(interval);
  };

  schedule(0);
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}
