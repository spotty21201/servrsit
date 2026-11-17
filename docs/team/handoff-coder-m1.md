# Handoff: Kiro Coder — T-023 and T-015

**Date:** 2026-11-17
**Branch:** `feat/coder/api-scaffold`
**Tasks:** T-023 (authenticated read-only API scaffold), T-015 (AWS cost worksheet)
**Next dependent tasks:** T-025 (plan/approval API, needs T-013), T-031 and T-034 (need T-023)

## 1. Changed files

| File | Change | Why |
|---|---|---|
| `apps/api/package.json` | Fixed in `3c7fc51` | Pins `fastify-type-provider-zod` to 4.0.2. Version 5.1.0 was wrong (see Decisions) |
| `pnpm-lock.yaml` | Updated in `3c7fc51` | Lockfile diff contains only the provider swap and its transitive packages |
| `apps/api/tsconfig.json`, `src/index.ts`, `src/auth/stub.ts`, `src/routes/health.ts`, `src/routes/fleet.ts` | Written by me, committed by the Orchestrator in `4419b4e` ("WIP T-023 ... unverified") | Fastify server, fixture fleet route, health route, auth stub. `tsconfig.json` has `skipLibCheck: true`. `src/index.ts` had its pino-pretty transport removed |
| `docs/decisions/aws-cost-worksheet.md` | Created in `8f8f504` | T-015 |

Not committed by me: `apps/web/`, `packages/ui/`. Those working-tree changes belong to Designer.

## 2. Decisions and corrections

- **Correction: I chose the wrong type-provider version.** I picked `fastify-type-provider-zod@5.1.0` because its peer range allows Zod 3. It uses Zod 4 internals. With the Zod 3 schemas from `@servrsit/contracts`, every route returned 500 `FST_ERR_INVALID_SCHEMA`. I switched to 4.0.2, the Zod 3 release. Both endpoints then returned 200.
- **`skipLibCheck: true` in `apps/api/tsconfig.json` only.** Without it `tsc` fails inside the type provider's `.d.ts`, which imports `fastify/types/schema` without an extension. Our own source stays fully strict. `packages/contracts` still has `skipLibCheck: false`.
- **Removed `pino-pretty`.** It was referenced but not a dependency. The logger writes plain JSON.
- **Session plugin registered but unused.** `@fastify/session` is registered with Secure (non-dev), HttpOnly, SameSite=Strict, 60-minute max age. No route reads or writes a session yet.

## 3. Checks run and actual results

| Check | Result |
|---|---|
| `tsc --noEmit` in `apps/api` | exit 0, no output |
| `pnpm run dev`, first attempt (type provider 5.1.0) | server listened, `GET /health` and `GET /api/fleet` both returned `500 FST_ERR_INVALID_SCHEMA` |
| `pnpm run dev`, after switching to 4.0.2 | `GET /health` returned `200 {"status":"ok","timestamp":"2026-11-17T04:42:45.962Z"}` |
| `GET /api/fleet` | `200`, `fixture:true`, three servers: Timika (fresh, reachable), Nabire (health fresh, inventory stale, 1 warning), Sentani (unreachable, health stale, inventory never observed) |
| Auth stub | log line `AUTH STUB — not for production` appeared per request (2 matches in the log after 2 requests) |
| Server stopped afterwards | `ss -ltn | grep 3001` returned nothing |

Not tested: the CORS origin restriction beyond seeing the `access-control-allow-origin: http://localhost:5173` header on responses, graceful shutdown beyond sending a kill signal, and the session cookie flags (no route sets a session). No automated tests exist for the API yet.

## 4. Known gaps and risks

- **Auth is a stub.** Every request passes. The code comments say to replace it with Cognito PKCE validation before any real data or external access. Technical Spec §5 requires issuer, audience, token use, signature, expiry and subject checks. The acceptance criterion "unauthenticated request returns 401" is **not met**.
- **Fleet data is fixture data**, built fresh on each request relative to the current time. It carries `fixture: true`. Freshness values are hardcoded in the fixture, not computed by any freshness rule.
- **Session secret fallback.** In dev the server uses an insecure default and prints a warning. In production it throws without `SESSION_SECRET`.
- **CORS is dev-only** and registered only when `NODE_ENV` is not `production`.
- **`pnpm install` needed `--ignore-scripts`** in my environment because pnpm 12 blocked esbuild's build script. Designer's commit `de33ee4` added `allowBuilds` to `pnpm-workspace.yaml`. I did not re-test a plain `pnpm install` afterward.
- **ServerStatus mismatch.** The fleet route defines its own server summary schema in `apps/api/src/routes/fleet.ts`. It does not reuse `ServerStatusSchema` from contracts. A shared fleet response schema belongs in `packages/contracts/` before Designer binds types to it. That needs Orchestrator approval under the schema-change rule.
- **T-015 limits.** The worksheet uses AWS public price-list files because no web search tool was available. Bedrock in-region invocation availability, Claude 3 Haiku lifecycle, and the Cognito free-tier mapping are not confirmed.

## 5. T-015 result for the Orchestrator and Spotty

The dedicated-per-owner architecture does **not** fit the US$7.25 PRD envelope. List-price idle cost is $33.88 per month (t3.small) or $53.15 (t3.medium). EC2 compute alone is $19.27. The realistic floor is about $27. Technical Spec §19's 4 GiB hypothesis maps to t3.medium. Full detail is in `docs/decisions/aws-cost-worksheet.md`.

Decisions needed from Spotty: region and spend (D-AWS-01 / ADR-003), whether global cross-region Bedrock inference is acceptable (it conflicts with Technical Spec §15's default), and what to do about Stage C economics.

## 6. Process note

The Orchestrator committed my unverified API files as `4419b4e` before I had run them. That commit contained the broken type-provider pin. It is fixed in `3c7fc51`. Anything that checked out `4419b4e` alone would see 500 errors on every route.

## 7. Next dependent task

T-025 (needs T-013 first) and T-031 / T-034 (need T-023). Auth replacement with Cognito PKCE has no task ID yet and should get one.
