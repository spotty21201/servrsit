/**
 * Sliding-window limiter for the assistant: at most `limit` accepted messages
 * per `windowMs`.
 *
 * One global window, not per client. There is no authenticated user yet, and
 * in development every request arrives through the Vite proxy from loopback,
 * so a per-IP key would be one shared key anyway. A global window also caps
 * spend on the metered AI provider regardless of who calls.
 */

export class SlidingWindowLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("windowMs must be positive");
  }

  private prune(t: number): void {
    while (this.hits.length > 0 && (this.hits[0] ?? 0) <= t - this.windowMs) this.hits.shift();
  }

  /** Record a hit if there is room. Returns false (and records nothing) when full. */
  tryAcquire(): boolean {
    const t = this.now();
    this.prune(t);
    if (this.hits.length >= this.limit) return false;
    this.hits.push(t);
    return true;
  }

  /** Milliseconds until the next hit would be accepted (0 when there is room now). */
  retryAfterMs(): number {
    const t = this.now();
    this.prune(t);
    if (this.hits.length < this.limit) return 0;
    return Math.max(0, (this.hits[0] ?? t) + this.windowMs - t);
  }
}
