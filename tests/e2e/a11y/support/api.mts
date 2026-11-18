/** A scripted stand-in for the ServrSit API, installed as globalThis.fetch. Synthetic data only. */
export type Handler = (req: { method: string; path: string; body: unknown }) => { status?: number; json?: unknown; headers?: Record<string, string> } | "hang" | "network-error";

const CSRF = "A".repeat(43);
export const sessionInfo = () => ({
  authenticated: true, username: "owner", csrfToken: CSRF, csrfHeader: "x-csrf-token",
  idleExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), absoluteExpiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
});
export const RECOVERY = Array.from({ length: 10 }, (_, i) => `rc${String(i).padStart(2, "0")}-aaaa-bbbb-cccc`);
const fleet = () => ({
  mode: "fixture", generatedAt: new Date().toISOString(), healthIntervalMinutes: 15, ownerTimeZone: "Asia/Jakarta", nextCheckAt: null,
  controlPlane: { clock: { status: "not-checked", checkedAt: null, ntpSynchronized: null, offsetSeconds: null, uncertaintySeconds: null, basis: "none", sources: [], reason: "[FIXTURE DATA] Fixture mode does not check ServrSit's own clock." }, findings: [] },
  servers: [
    server("11111111-1111-4111-a111-111111111111", "Fixture One", "fresh", null),
    server("22222222-2222-4222-a222-222222222222", "Fixture Two", "unreachable", { at: new Date().toISOString(), succeeded: false, failure: { code: "ROUTE_UNAVAILABLE", message: "The host could not be reached." }, consecutiveFailures: 2 }),
    server("33333333-3333-4333-a333-333333333333", "Fixture Three", "stale", null),
  ],
});
function server(id: string, name: string, status: string, latestAttempt: unknown) {
  const now = Date.now();
  return { id, name, role: null, production: false, importantServices: [], access: "ssh", source: "fixture", status, statusReason: `[FIXTURE DATA] Synthetic ${status} server.`,
    observedAt: new Date(now - 60_000).toISOString(), freshUntil: new Date(now + (status === "stale" ? -1 : 1) * 600_000).toISOString(), coverage: null, latestAttempt, findings: [], observation: null };
}

export interface Installed { calls: string[]; restore(): void }

export function installFetch(overrides: Record<string, Handler> = {}): Installed {
  const calls: string[] = [];
  const original = globalThis.fetch;
  const defaults: Record<string, Handler> = {
    "GET /api/auth/session": () => ({ json: { authenticated: false } }),
    "POST /api/auth/login": () => ({ json: { next: "totp" } }),
    "POST /api/auth/totp": () => ({ json: sessionInfo() }),
    "POST /api/auth/setup": () => ({ json: { totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/ServrSit:owner?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=ServrSit", expiresInSeconds: 900 } }),
    "POST /api/auth/setup/confirm": () => ({ json: { recoveryCodes: RECOVERY, session: sessionInfo() } }),
    "POST /api/auth/logout": () => ({ status: 204 }),
    "GET /api/fleet": () => ({ json: fleet() }),
    "GET /api/csrf": () => ({ json: { token: CSRF, header: "x-csrf-token" } }),
  };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL | Request) instanceof URL ? (input as URL).pathname : (input as Request).url;
    const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0]!;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown; try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
    calls.push(`${method} ${path}`);
    const h = overrides[`${method} ${path}`] ?? defaults[`${method} ${path}`];
    if (!h) return new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } });
    const r = h({ method, path, body });
    if (r === "hang") return new Promise<Response>(() => {});
    if (r === "network-error") throw new TypeError("fetch failed");
    return new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}
