/**
 * Signal handling for the API process (D4).
 *
 * - The first SIGINT/SIGTERM starts a graceful close, with a deadline. If the
 *   close has not finished by then (for example it is waiting on an in-flight
 *   SSH collection), the process exits anyway with status 1.
 * - A second signal exits immediately with status 1.
 * - The deadline timer is unref'd, so it never keeps the process alive.
 *
 * Exiting does not interrupt anything that matters: inspection is read-only,
 * and the product has no remote changes to protect yet.
 */

export const SHUTDOWN_DEADLINE_MS = 10_000;

export interface ShutdownDeps {
  readonly close: () => Promise<void>;
  readonly exit: (code: number) => void;
  readonly log: (level: "info" | "warn" | "error", message: string, extra?: object) => void;
  readonly setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  readonly deadlineMs?: number;
}

export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const deadlineMs = deps.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
  let started = false;
  let finished = false;

  return async (signal: string): Promise<void> => {
    if (started) {
      deps.log("warn", "Second shutdown signal: exiting now", { signal });
      finished = true;
      deps.exit(1);
      return;
    }
    started = true;
    deps.log("info", "Received shutdown signal — closing server", { signal, deadlineMs });

    setTimer(() => {
      if (finished) return;
      finished = true;
      deps.log("error", "Shutdown deadline reached: exiting without a clean close", { deadlineMs });
      deps.exit(1);
    }, deadlineMs).unref?.();

    try {
      await deps.close();
      if (finished) return;
      finished = true;
      deps.log("info", "Server closed cleanly");
      deps.exit(0);
    } catch (err) {
      if (finished) return;
      finished = true;
      deps.log("error", "Error during shutdown", { err });
      deps.exit(1);
    }
  };
}
