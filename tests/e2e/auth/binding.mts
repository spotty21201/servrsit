/**
 * Binding of the abstract owner-login contract (support/contract.mts) to T-053.
 *
 * Two wirings, both using the product's real OwnerAuth, guard and routes:
 *
 *  - "isolated": OwnerAuth + installAuthGuard + authRoutes on a bare Fastify, with the
 *    product's own logger options and @fastify/cookie, two test routes behind the guard
 *    and a generous rate limiter. Needed because buildServer cannot inject the limiter:
 *    its global limit is 10 auth POSTs per minute (a login is 2), so lockout scenarios
 *    would "pass" on RATE_LIMITED instead of on the lockout.
 *  - "full": real buildServer (fixture fleet, no start-up checks, so no SSH or network),
 *    used for the subset of scenarios that fit inside the built-in limit.
 *
 * The product's flow (password, then TOTP on a second request) is mapped onto the
 * abstract single `login`. TOTP codes always come from support/totp.mts, never from
 * the product's own library.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { totp } from "./support/totp.mts";
import type { AuthHarness, CallInput, CookieAttrs, LoginInput, Res, Session } from "./support/contract.mts";
import { buildServer } from "../../../apps/api/src/server.ts";
import { OwnerAuth } from "../../../apps/api/src/auth/owner-auth.ts";
import { authRoutes, installAuthGuard } from "../../../apps/api/src/auth/routes.ts";
import { SlidingWindowLimiter } from "../../../apps/api/src/assistant/rate-limit.ts";
import { createLoggerOptions } from "../../../apps/api/src/redaction.ts";
import { SqliteAuthStore } from "../../../packages/store/src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const apiRequire = createRequire(join(here, "../../../apps/api/package.json"));

export const ORIGIN = "http://127.0.0.1:5173";
export const USERNAME = "owner";
export const PASSWORD = "tester-only-password-not-real-0001";
const SESSION = "servrsit_session";
const ENROL = "servrsit_enrol";
const MFA = "servrsit_mfa";

interface Injected { statusCode: number; body: string; headers: Record<string, unknown> }
interface App { inject(o: Record<string, unknown>): Promise<Injected>; close(): Promise<unknown>; ready?(): Promise<unknown> }

export type Wiring = "isolated" | "full";

export interface BindingOptions {
  readonly wiring: Wiring;
  /** Isolated only. Default: effectively unlimited, so lockout is what is being tested. */
  readonly limit?: number;
  readonly secureCookies?: boolean;
  /** Isolated only: leave the setup token on the product's default sink (stderr). */
  readonly defaultTokenSink?: boolean;
  /** Use a database file instead of memory (to inspect what is stored). */
  readonly storePath?: string;
  /** Isolated only: T-066 `clockTrusted` (false = ServrSit's own clock is untrusted; enrolment is refused). */
  readonly clockTrusted?: () => boolean;
}

interface SetCookie { name: string; value: string; attrs: Record<string, string | true> }

function parseSetCookie(headers: Record<string, unknown>): SetCookie[] {
  const raw = headers["set-cookie"];
  const list = raw === undefined ? [] : Array.isArray(raw) ? (raw as string[]) : [String(raw)];
  return list.map((line) => {
    const [pair = "", ...rest] = line.split(";").map((s) => s.trim());
    const eq = pair.indexOf("=");
    const attrs: Record<string, string | true> = {};
    for (const a of rest) {
      const i = a.indexOf("=");
      if (i < 0) attrs[a.toLowerCase()] = true; else attrs[a.slice(0, i).toLowerCase()] = a.slice(i + 1);
    }
    return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs };
  });
}

export class AuthBinding implements AuthHarness {
  readonly name: string;
  readonly protectedGet: string;
  readonly protectedPost: string;
  private t = Date.parse("2026-02-10T03:00:07Z");
  private readonly lines: string[] = [];
  private token: string | null = null;
  private app!: App;
  private store!: SqliteAuthStore;
  private readonly cookieSeen = new Map<string, SetCookie>();
  private secret: string | null = null;
  /** The session created by setup confirmation: a real second session for other-session CSRF tokens. */
  private setupSession: Session | null = null;
  recoveryCodes: string[] = [];
  /** Every set-cookie seen, for extra checks. */
  readonly allSetCookies: SetCookie[] = [];

  private constructor(private readonly opts: BindingOptions) {
    this.name = `T-053 (${opts.wiring})`;
    this.protectedGet = opts.wiring === "full" ? "/api/fleet" : "/api/_t/read";
    this.protectedPost = opts.wiring === "full" ? "/api/plans" : "/api/_t/write";
  }

  static async create(opts: BindingOptions): Promise<AuthBinding> {
    const b = new AuthBinding(opts);
    await b.start();
    return b;
  }

  now = (): number => this.t;
  async advance(ms: number): Promise<void> { this.t += ms; }
  logText(): string { return this.lines.join(""); }
  get totpSecret(): string | null { return this.secret; }
  get authStore(): SqliteAuthStore { return this.store; }
  async close(): Promise<void> { await this.app.close(); this.store.close?.(); }

  private async start(): Promise<void> {
    const logStream = { write: (m: string) => { this.lines.push(m); } };
    this.store = new SqliteAuthStore({ path: this.opts.storePath ?? ":memory:" });
    const sink = this.opts.defaultTokenSink === true ? undefined : (t: string) => { this.token = t; };
    if (this.opts.wiring === "full") {
      this.app = (await buildServer({
        logStream, startChecks: false, mode: "fixture", ownerContextPath: null,
        auth: { store: this.store, now: this.now, ...(sink === undefined ? {} : { onSetupToken: sink }) },
      })) as unknown as App;
      await this.app.ready?.();
      return;
    }
    const Fastify = apiRequire("fastify") as (o: unknown) => any;
    const cookie = apiRequire("@fastify/cookie");
    const f = Fastify({ logger: createLoggerOptions({ level: "info", secrets: [], stream: logStream }) });
    await f.register(cookie);
    const auth = new OwnerAuth({ store: this.store, now: this.now, ...(sink === undefined ? {} : { onSetupToken: sink }), ...(this.opts.clockTrusted ? { clockTrusted: this.opts.clockTrusted } : {}) });
    await auth.init();
    installAuthGuard(f, { auth });
    await f.register(authRoutes, {
      auth, now: this.now, secureCookies: this.opts.secureCookies ?? false,
      limiter: new SlidingWindowLimiter(this.opts.limit ?? 1_000_000, 60_000, this.now),
    });
    f.get("/api/_t/read", async () => ({ ok: true }));
    f.post("/api/_t/write", async () => ({ ok: true }));
    await f.ready();
    this.app = f as App;
  }

  // ---------------------------------------------------------------- plumbing
  injectRaw(o: Record<string, unknown>): Promise<Injected> { return this.app.inject(o); }
  async raw(method: string, url: string, o: { body?: unknown; cookies?: Record<string, string>; headers?: Record<string, string>; client?: string } = {}) {
    const cookieHeader = Object.entries(o.cookies ?? {}).map(([k, v]) => `${k}=${v}`).join("; ");
    const headers: Record<string, string> = { ...(o.body === undefined ? {} : { "content-type": "application/json" }), ...(cookieHeader ? { cookie: cookieHeader } : {}), ...(o.headers ?? {}) };
    const res = await this.app.inject({ method, url, headers, ...(o.body === undefined ? {} : { payload: JSON.stringify(o.body) }), ...(o.client ? { remoteAddress: o.client } : {}) });
    const set = parseSetCookie(res.headers);
    for (const c of set) { this.allSetCookies.push(c); if (c.name === SESSION && c.value) this.cookieSeen.set(c.value, c); }
    let json: Record<string, any> = {};
    try { json = res.body ? JSON.parse(res.body) : {}; } catch { json = {}; }
    return { status: res.statusCode, json, text: res.body, set, headers: res.headers };
  }

  private toRes<T>(r: { status: number; json: Record<string, any>; text: string }, data?: T): Res<T> {
    return { ok: r.status < 300, status: r.status, code: typeof r.json["error"] === "string" ? r.json["error"] : undefined, data, raw: r.text };
  }

  // ---------------------------------------------------------------- contract
  async setupToken(): Promise<string> {
    if (this.token === null) throw new Error("the product did not hand out a setup token");
    return this.token;
  }

  async setup(a: { token: string }): Promise<Res<{ totpSecret: string }>> {
    const start = await this.raw("POST", "/api/auth/setup", { body: { setupToken: a.token, username: USERNAME, password: PASSWORD }, headers: { origin: ORIGIN } });
    if (start.status >= 300) return this.toRes(start);
    const secret = String(start.json["totpSecret"]);
    const ticket = start.set.find((c) => c.name === ENROL)?.value ?? "";
    const confirm = await this.raw("POST", "/api/auth/setup/confirm", { body: { code: totp(secret, this.t) }, cookies: { [ENROL]: ticket }, headers: { origin: ORIGIN } });
    if (confirm.status >= 300) return this.toRes(confirm);
    this.secret = secret;
    this.recoveryCodes = confirm.json["recoveryCodes"] as string[];
    const sid = confirm.set.find((c) => c.name === SESSION)?.value;
    if (sid) this.setupSession = { cookie: sid, csrf: String(confirm.json["session"]?.["csrfToken"]) };
    // The confirmation consumed this TOTP step. A later login must use a later one.
    this.t += 31_000;
    return this.toRes(confirm, { totpSecret: secret });
  }

  async login(a: LoginInput): Promise<Res<Session>> {
    const pre: Record<string, string> = a.existingCookie ? { [SESSION]: a.existingCookie } : {};
    const step1 = await this.raw("POST", "/api/auth/login", { body: { username: USERNAME, password: PASSWORD }, cookies: pre, headers: { origin: ORIGIN }, ...(a.client ? { client: a.client } : {}) });
    if (step1.status >= 300) return this.toRes(step1);
    const ticket = step1.set.find((c) => c.name === MFA)?.value ?? "";
    // `code` is passed exactly as the scenario gives it, including wrong types.
    const step2 = await this.raw("POST", "/api/auth/totp", { body: { code: a.code }, cookies: { ...pre, [MFA]: ticket }, headers: { origin: ORIGIN }, ...(a.client ? { client: a.client } : {}) });
    if (step2.status >= 300) return this.toRes(step2);
    const sid = step2.set.find((c) => c.name === SESSION)?.value;
    if (!sid) return { ok: false, status: step2.status, code: "NO_SESSION_COOKIE", raw: step2.text };
    return this.toRes(step2, { cookie: sid, csrf: String(step2.json["csrfToken"]) });
  }

  async loginWithRecoveryCode(recoveryCode: string): Promise<Res<Session>> {
    const step1 = await this.raw("POST", "/api/auth/login", { body: { username: USERNAME, password: PASSWORD }, headers: { origin: ORIGIN } });
    if (step1.status >= 300) return this.toRes(step1);
    const ticket = step1.set.find((c) => c.name === MFA)?.value ?? "";
    const step2 = await this.raw("POST", "/api/auth/totp", { body: { recoveryCode }, cookies: { [MFA]: ticket }, headers: { origin: ORIGIN } });
    if (step2.status >= 300) return this.toRes(step2);
    const sid = step2.set.find((c) => c.name === SESSION)?.value ?? "";
    return this.toRes(step2, { cookie: sid, csrf: String(step2.json["csrfToken"]) });
  }

  async logout(s: Session): Promise<Res> {
    return this.toRes(await this.raw("POST", "/api/auth/logout", { cookies: { [SESSION]: s.cookie }, headers: { origin: ORIGIN, "x-csrf-token": s.csrf } }));
  }

  async call(a: CallInput): Promise<Res> {
    const headers: Record<string, string> = {};
    const mutating = a.method !== "GET";
    const mode = a.csrf ?? "valid";
    if (a.session && mode !== "omit") {
      const real = a.session.csrf;
      if (mode === "valid") headers["x-csrf-token"] = real;
      else if (mode === "wrong") headers["x-csrf-token"] = real.slice(0, -1) + (real.endsWith("A") ? "B" : "A");
      else headers["x-csrf-token"] = this.setupSession?.csrf ?? "no-other-session";
    }
    if (mutating || a.origin) headers["origin"] = a.origin ?? ORIGIN;
    if (a.fetchSite) headers["sec-fetch-site"] = a.fetchSite;
    const r = await this.raw(a.method, a.path, { ...(a.body === undefined ? {} : { body: a.body }), cookies: a.session ? { [SESSION]: a.session.cookie } : {}, headers });
    return this.toRes(r);
  }

  cookieAttributes(s: Session): CookieAttrs {
    const c = this.cookieSeen.get(s.cookie);
    if (!c) throw new Error("no Set-Cookie was seen for this session");
    const ss = c.attrs["samesite"];
    return { httpOnly: c.attrs["httponly"] === true, sameSite: typeof ss === "string" ? ss : null, secure: c.attrs["secure"] === true, path: typeof c.attrs["path"] === "string" ? c.attrs["path"] : null, hasMaxAgeOrExpires: c.attrs["max-age"] !== undefined || c.attrs["expires"] !== undefined };
  }
}
