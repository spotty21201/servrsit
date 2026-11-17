/**
 * Abstract contract for the owner login (T-053). Written from Technical Spec §5,
 * PRD FR-01, UX §7.1 and the task list: every /api route 401 without a session,
 * CSRF, TOTP replay, lockout, single-use setup token, no secrets in logs.
 *
 * The spec fixes behaviour, not endpoints or JSON. All shape assumptions live in
 * the binding. Scenarios assert only on this interface.
 */
export interface Res<T = unknown> {
  readonly ok: boolean;
  readonly status: number;
  readonly code?: string | undefined;
  readonly data?: T | undefined;
  /** Raw response body text, used to check that nothing secret is echoed. */
  readonly raw?: string | undefined;
}

export interface Session { readonly cookie: string; readonly csrf: string }

export interface CookieAttrs { readonly httpOnly: boolean; readonly sameSite: string | null; readonly secure: boolean; readonly path: string | null; readonly hasMaxAgeOrExpires: boolean }

export interface CallInput {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly session?: Session | null;
  /** valid = the session's own token; other-session = a token minted for a different session. */
  readonly csrf?: "valid" | "omit" | "wrong" | "other-session";
  readonly origin?: string;
  readonly fetchSite?: string;
  readonly body?: unknown;
}

export interface LoginInput {
  /** What goes in the code field. Normally a 6-digit string; scenarios also send wrong types. */
  readonly code: unknown;
  /** A different caller identity (address header), to test that lockout is not per-address. */
  readonly client?: string;
  /** A cookie the caller already holds (session fixation test). */
  readonly existingCookie?: string | null;
}

export interface AuthHarness {
  readonly name: string;
  now(): number;
  advance(ms: number): Promise<void>;

  /** The one-time setup token, obtained the way the operator would (console or file), not through the API. */
  setupToken(): Promise<string>;
  /** Enrol the owner. Returns the TOTP secret (base32) shown once. */
  setup(a: { token: string }): Promise<Res<{ totpSecret: string }>>;
  login(a: LoginInput): Promise<Res<Session>>;
  logout(s: Session): Promise<Res>;
  call(a: CallInput): Promise<Res>;
  /** A protected route that exists, for generic calls. */
  readonly protectedGet: string;
  readonly protectedPost: string;
  cookieAttributes(s: Session): CookieAttrs;
  /** Everything logged so far, as one string. */
  logText(): string;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly spec: readonly string[];
  run(h: AuthHarness): Promise<void>;
}

export const STEP_MS = 30_000;
export const MIN = 60_000;
export const HOUR = 60 * MIN;
