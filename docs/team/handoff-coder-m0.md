# Handoff: Kiro Coder — M0 (T-004, T-005, T-007)

**Date:** 2026-11-15  
**Branch:** `feat/coder/monorepo-and-contracts`  
**Tasks completed:** T-004, T-005, T-007  
**Next dependent task:** T-008 (typed fixture snapshots — Coder schema; Designer fixture content)

---

## 1. Changed files

### T-004 — Monorepo scaffold

| File | Change | Why |
|---|---|---|
| `pnpm-workspace.yaml` | Created | Declares all 10 workspace packages to pnpm |
| `package.json` (root) | Created | `name: servrsit`, `private: true`, engine pins |
| `.gitignore` | Created | Excludes `node_modules`, `.env*`, `dist`, `build`, `*.pem`, `*.key`, `known_hosts.prod`, `database_dumps/`, `coverage/`, `.DS_Store` |
| `apps/web/package.json` | Created | `@servrsit/web`, private |
| `apps/api/package.json` | Created | `@servrsit/api`, private |
| `apps/worker/package.json` | Created | `@servrsit/worker`, private |
| `packages/contracts/package.json` | Created (stub) | `@servrsit/contracts`, private — updated in T-007 |
| `packages/domain/package.json` | Created | `@servrsit/domain`, private |
| `packages/ui/package.json` | Created (stub) | `@servrsit/ui`, private — Designer owns full content |
| `packages/ssh/package.json` | Created | `@servrsit/ssh`, private |
| `packages/ai/package.json` | Created | `@servrsit/ai`, private |
| `target-helper/package.json` | Created | `@servrsit/target-helper`, private |
| `infra/package.json` | Created | `@servrsit/infra`, private |
| `pnpm-lock.yaml` | Generated | Workspace scaffold lockfile — no app deps yet |

### T-005 — Version pinning

| File | Change | Why |
|---|---|---|
| `.node-version` | Created | Pins Node.js 24.22.3 for tooling compatibility |
| `docs/decisions/decision-log.md` | Appended ADR-008 | Records confirmed versions, sources, lifecycles, and upgrade plan |

### T-007 — Contracts skeleton

| File | Change | Why |
|---|---|---|
| `packages/contracts/package.json` | Updated | Added `zod 3.25.76`, `typescript 5.9.3`, `type: module`, exports map, build scripts |
| `packages/contracts/tsconfig.json` | Created | Strict TypeScript config (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, ES2022, NodeNext) |
| `packages/contracts/src/index.ts` | Created | All shared schemas and types (see below) |
| `pnpm-lock.yaml` | Updated | Added zod + typescript entries |

---

## 2. Decisions made

**Zod version: 3.25.76 (not 4.6.7)**  
The npm `latest` tag now points to Zod 4, which is a breaking-change release. The ecosystem dependencies cited in the Technical Spec (`fastify-type-provider-zod`) target Zod v3. Zod 3.25.76 is the latest stable v3 release. This aligns with ADR-002 and avoids a breaking import boundary at the first real usage. Logged here; if the team decides to adopt Zod 4, it requires a coordinated migration across all packages.

**TypeScript version: 5.9.3 (not 7.0.2)**  
TypeScript 7 is newly available but is a major breaking release (see erasable type declarations, etc.). The Designer's pre-existing work in `packages/ui/` uses TypeScript 5.8.3. Using 5.9.3 keeps both packages on the established v5 line. Upgrade to TypeScript 7 is a separate coordinated decision.

**OperationState has 8 states (not 9)**  
Technical Spec §11 defines 8 states in its table. The task description said "nine states." The spec explicitly says `stop_requested` is "an orthogonal request flag, not proof of cancellation" — it is a boolean field on the Operation record, not a state enum value. The 8 canonical states are implemented; `stopRequested: boolean` is a field on `OperationSchema`. If the Orchestrator confirms a ninth state is intended, this needs an ADR before it is added.

**Node.js runtime for install: 24.22.3**  
No system Node.js was available. Downloaded the official Node.js 24.22.3 Linux x64 binary from `nodejs.org/dist/v24.22.3/` and installed pnpm 12.21.0 via npm. Installed under `/home/spotty/.local/node24/`. This is the runtime used for all pnpm commands during M0 implementation.

---

## 3. Checks run and results

| Check | Command | Result |
|---|---|---|
| pnpm install (workspace scaffold) | `pnpm install` at repo root | ✅ Clean; `pnpm-lock.yaml` generated |
| pnpm install (with deps) | `pnpm install` after adding zod + typescript | ✅ 6 packages resolved and added |
| TypeScript typecheck (no emit) | `tsc --noEmit` in `packages/contracts/` | ✅ Zero errors |
| TypeScript build | `tsc` in `packages/contracts/` | ✅ `dist/index.js`, `dist/index.d.ts`, maps generated |
| Runtime validation | `node -e "import(...)"` on compiled output | ✅ All schemas importable; `OperationSchema.parse()` succeeds on valid input; all enum keys present |
| Node.js version confirmed | `https://nodejs.org/dist/latest-v24.x/` | ✅ 24.22.3 (released 2026-11-11) |
| PostgreSQL version confirmed | `https://www.postgresql.org/ftp/source/` | ✅ 17.12 (released 2026-11-09) |
| Lifecycle dates | `https://endoflife.date/api/nodejs.json` and `.../postgresql.json` | ✅ Node.js 24 EOL 2028-04-30; PostgreSQL 17 EOL 2029-11-08 |
| `dist/` excluded from git | `git status` after build | ✅ `dist/` not tracked; root `.gitignore` covers it |
| Commit on correct branch | `git log --oneline` | ✅ 3 commits on `feat/coder/monorepo-and-contracts` |

---

## 4. Unresolved limitations and known gaps

**packages/ui/** — The Designer's work was already present in `packages/ui/` on a parallel branch (`feat/tester/acceptance-matrix`). The workspace scaffold stub for `packages/ui/package.json` was overwritten by the Designer's version during the branch work. I have not modified the Designer's `packages/ui/` files. The Orchestrator should confirm the branch merge order for `packages/ui/package.json` to avoid a conflict.

**OperationState count** — See decision above. The Orchestrator should confirm whether "nine states" in the task description was an error or whether a ninth state (beyond the 8 in Technical Spec §11) is intended.

**Zod v4 migration** — Noted above. If the team moves to Zod 4 before other packages depend on contracts, it is straightforward. After other packages depend on it, it requires a coordinated migration.

**packages/contracts/src/index.ts exports base schemas only** — The task spec says "base Plan, Approval, and Operation schemas." Operation-specific scope fields (which packages are being updated, which services, etc.) belong in `@servrsit/domain` per the repository structure. The contracts package exports only the shared structural types.

**No `tests/` directory in contracts** — T-007 acceptance criteria required schemas and types only. Unit tests for the contracts schemas should be added as part of T-008 or T-009 when the Tester takes ownership.

---

## 5. Next dependent task

**T-008 — Create typed fixture snapshots** (Owner: Coder schema + Designer fixture data content)  
Depends on: T-007 (this handoff)  
The contracts schemas are now available for the Coder to create typed fixture snapshot shapes and for the Designer to populate fixture data content.

**T-009 — Build acceptance test matrix** (Owner: Tester)  
Depends on: T-007 (this handoff)  
The Tester can now write tests against the exported schemas.
