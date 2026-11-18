# ADR-017 — Local owner auth until Cognito

| Field | Value |
|---|---|
| **Date** | 2026-11-18 |
| **Owner** | Coder |
| **Status** | [AGENT DECISION] — Adopted for the local build, as directed in steer-6eb23122 (T-053, fixes Tester finding F1). Orchestrator to index in `decision-log.md`. |
| **Requirements** | Technical Spec §5; PRD FR-01; UX §7.1; ADR-014 (no AWS yet) |

## Context

Technical Spec §5 chooses Cognito with PKCE and TOTP MFA. Cognito is not available because ADR-014 keeps everything local and authorizes no AWS spend. The API had only a pass-through stub (D3), and the Tester's report `test-report-care-loop-001` (F1) showed that an approval with no session was accepted. That blocks enabling writes on any server.

## Decision

The API authenticates one owner itself, following the parts of §5 that do not depend on Cognito:

| §5 requirement | Local implementation |
|---|---|
| MFA required for the owner | TOTP (RFC 6238) via `otpauth` 9.6.0, pinned: SHA-1, 6 digits, 30 s, ±1 step. **No session exists until the TOTP step passes.** A time step is accepted once, and never one older than the last accepted step, so a code cannot be replayed. |
| Password handling (Cognito's job) | argon2id via `@node-rs/argon2` 2.2.2, pinned (prebuilt binaries, no install script). Parameters: 19 MiB, 2 passes, 1 lane (OWASP minimum). 12 to 256 characters. |
| Opaque server-side session; hash stored | 32 random bytes, base64url. Only SHA-256 is stored. Cookie `servrsit_session`: HttpOnly, SameSite=Strict, Path=/. Secure in production and whenever the request is HTTPS. |
| 60 min inactivity, 8 h absolute | Enforced on every request. The session row is deleted when either limit is reached. |
| CSRF and Origin validation on state-changing requests | A global `onRequest` guard checks every POST, PUT, PATCH and DELETE under `/api`. Origin must be allowed, `Sec-Fetch-Site: cross-site` is refused, and `X-CSRF-Token` must equal **this session's** token (constant-time compare). |
| Nothing in browser storage | The web client keeps only the CSRF token, in memory. The session cookie is HttpOnly. |

**Account setup (first run only):**

- When no owner exists, startup creates a one-time setup token. It is printed to the API's stderr, not the structured log, and stored as SHA-256. It works once, and a restart replaces it.
- Setup step 1 uses the token, sets the username and password, and returns the TOTP secret.
- Step 2 requires a valid code from that secret. Only then does it create the owner, issue a session, and return **10 recovery codes**. The codes are shown once and stored as SHA-256; each works once in place of a TOTP code.
- After the owner exists, setup always answers `SETUP_UNAVAILABLE`.

**Brute force:**

- Login, TOTP and setup are limited to 10 requests per minute.
- Failed password and second-factor attempts are counted for the account (there is one). From the 5th consecutive failure, sign-in is locked for 30 s, doubling per further failure up to 15 min.
- While locked, even the right password is refused.
- A sign-in ticket allows 5 code attempts before it is spent.

**No disclosure:**

- A wrong username, a wrong password and "no account yet" give the same 401 `INVALID_CREDENTIALS` with the same body. Each of them costs one argon2 verification (a dummy hash when no owner exists).
- `GET /api/auth/session` says only whether this browser is signed in.

**Scope of the guard:**

- Every `/api` route, registered or not, answers 401 `UNAUTHENTICATED` without a session. The 401 comes before CSRF, validation or 404.
- The exceptions are the session-creating routes `/api/auth/{setup, setup/confirm, login, totp, session, logout}`, which check Origin themselves.
- `/health` stays open; it is outside `/api` and carries no data.

**Storage:**

- `SqliteAuthStore` in `packages/store`, a separate file `apps/api/.data/auth.db` (gitignored).
- The file is created mode 0600, and its directory 0700 if the store creates it. `SERVRSIT_AUTH_DB` overrides the path.
- `buildServer()` without a store uses an in-memory store, so tests and other callers never touch the real file. Auth is still enforced in that case.

**Logging:** auth lines carry the step and outcome code only. Tests check the log for passwords, setup tokens, TOTP secrets and codes, session ids, CSRF tokens, MFA tickets and recovery codes, and find none.

## Removed

- `apps/api/src/auth/stub.ts`.
- `@fastify/session` and the `SESSION_SECRET` requirement. Sessions are opaque random ids checked against stored hashes, so no signing secret is needed.
- The per-process `CsrfGuard`: its token was shared by every client. `/api/csrf` now returns the caller's session token and requires a session.

## Limits (accepted for the local build)

- **The TOTP secret is stored as plain text** in `auth.db`, because verifying a code needs it. The protection is the file mode and the host. Before any hosted deployment, encrypt it with a KMS key, or move to Cognito.
- **No re-authentication flow** for credential changes or disruptive approval (§5 "recent authentication"). Nothing in Stage A uses one yet; it must exist before credential input or real writes.
- **No password change, TOTP re-enrolment or account reset through the API.** Recovery codes grant a session, nothing more. Losing every factor means deleting `auth.db` on the host and running setup again, which needs host access by design.
- **No user interface yet.** `apps/web/src/api/auth.ts` is the data layer only; the screens are Designer work. Until they exist, the web UI gets 401 for fleet data.
- **Lockout is per account.** Someone on the network can keep the owner locked out by failing on purpose. That trade-off is accepted while the API binds to 127.0.0.1 and the tailnet.

## Exit

Replace this with Cognito (§5) when AWS hosting is authorized. The guard, cookie, CSRF and session-lifetime code stays. `OwnerAuth`'s password and TOTP steps are swapped for the PKCE callback.
