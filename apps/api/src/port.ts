/**
 * Listening port. Configurable with the PORT environment variable so a second
 * instance can run next to the first (for example for testing). The bind
 * address is not configurable: the API listens on 127.0.0.1 only.
 */

export const DEFAULT_PORT = 3001;

export function resolvePort(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env["PORT"];
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}
