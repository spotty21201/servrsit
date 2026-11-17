/**
 * Spec-derived reference model of the owner login. Used ONLY to prove the
 * scenarios can pass and can fail. It is not the product and says nothing
 * about it. Faults ("mutants") switch one rule off at a time.
 */
import { createHash, randomBytes } from "node:crypto";
import { base32Encode, hotp, base32Decode } from "./support/totp.mts";
import { HOUR, MIN, STEP_MS, type AuthHarness, type CallInput, type CookieAttrs, type LoginInput, type Res, type Session } from "./support/contract.mts";

export type Fault =
  | "noSingleUseSetup" | "setupRace" | "noReplayProtection" | "noLockout" | "lockoutPerClient" | "lockoutTooLate"
  | "lockoutForever" | "lockoutTooEager" | "wideWindow" | "verboseErrors" | "arrayCodeAccepted" | "nonOpaqueSession"
  | "sessionFixation" | "noLogoutInvalidate" | "noIdleExpiry" | "noAbsoluteExpiry" | "noCsrf" | "csrfNotBoundToSession"
  | "noOriginCheck" | "logsCode" | "logsSetupToken" | "logsCookie" | "echoesInput" | "secretInLoginResponse"
  | "notHttpOnly" | "weakSetupToken" | "shortCookie" | "idleTooShort";

const ok = <T,>(status: number, data?: T, raw = "{}"): Res<T> => ({ ok: true, status, data, raw });
const fail = (status: number, code: string, raw?: string): Res<never> => ({ ok: false, status, code, raw: raw ?? JSON.stringify({ error: code }) });

interface Sess { csrf: string; created: number; last: number }

export class ReferenceAuth implements AuthHarness {
  readonly name: string;
  readonly protectedGet = "/api/fleet";
  readonly protectedPost = "/api/plans";
  private t = Date.parse("2026-11-17T10:00:00.000Z");
  private readonly token: string;
  private enrolled = false;
  private used = false;
  private secret: string | null = null;
  private lastStep = -1;
  private failures = new Map<string, number>();
  private readonly locks = new Map<string, number>();
  private readonly sessions = new Map<string, Sess>();
  private readonly lines: string[] = [];
  private n = 0;

  constructor(private readonly faults: ReadonlySet<Fault> = new Set()) {
    this.name = faults.size ? `reference-auth+${[...faults].join(",")}` : "reference-auth";
    this.token = this.has("weakSetupToken") ? "setup" : randomBytes(24).toString("hex");
  }
  private has(f: Fault): boolean { return this.faults.has(f); }
  private log(s: string): void { this.lines.push(`${new Date(this.t).toISOString()} ${s}`); }
  now(): number { return this.t; }
  async advance(ms: number) { this.t += ms; }
  async setupToken() { return this.token; }
  logText(): string { return this.lines.join("\n"); }

  async setup(a: { token: string }): Promise<Res<{ totpSecret: string }>> {
    if (this.has("logsSetupToken")) this.log(`setup attempt token=${a.token}`); else this.log("setup attempt");
    if (this.enrolled && !this.has("noSingleUseSetup")) return fail(409, "SETUP_CLOSED", JSON.stringify({ error: "SETUP_CLOSED" }));
    if (a.token !== this.token) return fail(401, "INVALID_TOKEN", this.has("echoesInput") ? JSON.stringify({ error: "INVALID_TOKEN", got: a.token }) : undefined);
    if (this.used && !this.has("noSingleUseSetup")) return fail(409, "SETUP_CLOSED");
    if (this.has("setupRace")) await Promise.resolve(); // the check and the mark are no longer one step
    this.used = true;
    this.enrolled = true;
    this.secret = base32Encode(randomBytes(20));
    this.log("setup completed");
    return ok(201, { totpSecret: this.secret }, JSON.stringify({ totpSecret: this.secret }));
  }

  private threshold(): number { return this.has("lockoutTooLate") ? 60 : this.has("lockoutTooEager") ? 2 : 5; }

  async login(a: LoginInput): Promise<Res<Session>> {
    if (!this.enrolled || this.secret === null) return fail(401, "INVALID_CODE");
    const who = this.has("lockoutPerClient") ? (a.client ?? "default") : "owner";
    if ((this.locks.get(who) ?? 0) > this.t && !this.has("noLockout")) { this.log("login refused: locked"); return fail(429, "LOCKED"); }
    let candidate: unknown = a.code;
    if (Array.isArray(a.code) && this.has("arrayCodeAccepted")) candidate = a.code.find((c) => typeof c === "string" && this.matches(c) !== null) ?? "";
    if (typeof candidate !== "string" || !/^\d{6}$/.test(candidate)) return fail(400, "INVALID_INPUT");
    const step = this.matches(candidate);
    const replay = step !== null && step <= this.lastStep && !this.has("noReplayProtection");
    if (step === null || replay) {
      if (this.has("logsCode")) this.log(`login failed code=${candidate}`); else this.log("login failed");
      const f = (this.failures.get(who) ?? 0) + 1;
      this.failures.set(who, f);
      if (f >= this.threshold() && !this.has("noLockout")) {
        this.locks.set(who, this.has("lockoutForever") ? Number.MAX_SAFE_INTEGER : this.t + 15 * MIN);
        this.failures.set(who, 0);
      }
      const stale = step === null && this.has("verboseErrors") && this.stale(candidate);
      return fail(401, stale ? "CODE_EXPIRED" : "INVALID_CODE", this.has("echoesInput") ? JSON.stringify({ error: "INVALID_CODE", got: candidate }) : undefined);
    }
    this.lastStep = Math.max(this.lastStep, step);
    this.failures.set(who, 0);
    const cookie = this.has("nonOpaqueSession") ? "owner-session-1" : this.has("sessionFixation") && a.existingCookie ? a.existingCookie
      : randomBytes(this.has("shortCookie") ? 4 : 32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    this.sessions.set(cookie, { csrf, created: this.t, last: this.t });
    this.log(this.has("logsCookie") ? `login ok session=${cookie} csrf=${csrf}` : "login ok");
    const raw = this.has("secretInLoginResponse") ? JSON.stringify({ ok: true, totpSecret: this.secret }) : JSON.stringify({ ok: true });
    return ok(200, { cookie, csrf }, raw);
  }

  private matches(c: string): number | null {
    const span = this.has("wideWindow") ? 3 : 1;
    const base = Math.floor(this.t / STEP_MS);
    for (let o = -span; o <= span; o++) if (hotp(base32Decode(this.secret!), base + o) === c) return base + o;
    return null;
  }
  private stale(c: string): boolean {
    const base = Math.floor(this.t / STEP_MS);
    for (let o = -6; o <= 6; o++) if (hotp(base32Decode(this.secret!), base + o) === c) return true;
    return false;
  }

  async logout(s: Session): Promise<Res> {
    if (!this.has("noLogoutInvalidate")) this.sessions.delete(s.cookie);
    return ok(200);
  }

  async call(a: CallInput): Promise<Res> {
    this.log(`request ${a.method} ${a.path}`);
    const s = a.session ? this.sessions.get(a.session.cookie) : undefined;
    if (!a.session || !s) return fail(401, "UNAUTHENTICATED");
    const idle = this.has("idleTooShort") ? 1 * MIN : 60 * MIN;
    if (!this.has("noIdleExpiry") && this.t - s.last > idle) { this.sessions.delete(a.session.cookie); return fail(401, "UNAUTHENTICATED"); }
    if (!this.has("noAbsoluteExpiry") && this.t - s.created > 8 * HOUR) { this.sessions.delete(a.session.cookie); return fail(401, "UNAUTHENTICATED"); }
    s.last = this.t;
    if (a.method !== "GET") {
      if (!this.has("noCsrf")) {
        if (!this.has("noOriginCheck") && a.origin !== undefined && a.origin !== "http://localhost:5173") return fail(403, "CSRF_INVALID");
        if (!this.has("noOriginCheck") && a.fetchSite === "cross-site") return fail(403, "CSRF_INVALID");
        const mode = a.csrf ?? "valid";
        const bound = !this.has("csrfNotBoundToSession");
        if (mode === "omit" || mode === "wrong") return fail(403, "CSRF_INVALID");
        if (mode === "other-session" && bound) return fail(403, "CSRF_INVALID");
      }
      return fail(400, "INVALID_INPUT"); // past the CSRF check: the body is empty so validation refuses it
    }
    return ok(200);
  }

  cookieAttributes(_s: Session): CookieAttrs {
    return { httpOnly: !this.has("notHttpOnly"), sameSite: "Strict", secure: false, path: "/", hasMaxAgeOrExpires: true };
  }
  /** for tests of the tests */
  digest(): string { return createHash("sha256").update(String(this.n++)).digest("hex"); }
}
