---
inclusion: always
---

# ServrSit — Structure and collaboration steering

## Agent roles and file ownership

| Agent | Owns | Must not touch independently |
|---|---|---|
| **Orchestrator** | `docs/team/`, `docs/decisions/`, `.kiro/steering/`, integration branches, shared contracts resolution | Any agent's primary files without coordination |
| **Designer** | `packages/ui/`, presentation layer of `apps/web/` | `packages/contracts/`, `packages/domain/`, `apps/api/`, `apps/worker/`, `packages/ssh/`, `packages/ai/` |
| **Coder** | `apps/api/`, `apps/worker/`, `packages/contracts/`, `packages/domain/`, `packages/ssh/`, `packages/ai/`, `target-helper/`, `infra/`, data integration layer of `apps/web/` | `packages/ui/` visual tokens and component presentation |
| **Tester** | `tests/fixtures/`, `tests/e2e/`, test files within any package | Production source files — reports defects, never silently rewrites product code to make tests pass |

## Concurrency rules

- Two agents must not edit the same file at the same time.
- `packages/contracts/` has exactly one owner at any moment — Coder, coordinated by Orchestrator.
- Schema/migration changes are sequential: Coder proposes → Orchestrator approves boundary → Designer adapts UI types.
- Orchestrator controls integration onto the main branch.

## Branch strategy

Use separate branches per agent workstream. Naming convention:
- `feat/designer/<short-description>`
- `feat/coder/<short-description>`
- `feat/tester/<short-description>`
- `integration/<milestone>`

Orchestrator merges integration branches after verifying that acceptance criteria are met with actual evidence (not agent self-report).

## Handoff format

A completed handoff includes:
1. Changed files (paths, what changed, why)
2. Decisions made (record in `docs/decisions/decision-log.md` for anything material)
3. Actual checks run and their results (not "it looks correct")
4. Unresolved limitations or known gaps
5. Next dependent task ID from the task board

A summary paragraph is not a handoff. No milestone is closed without committed code or reproducible test evidence.

## Task board

Canonical location: `docs/team/task-board.md`

Every task requires:
- **ID** (e.g. `T-001`)
- **Owner** (agent name)
- **Requirement links** (PRD `FR-*` IDs and/or UX `UX-*` IDs)
- **Dependencies** (task IDs that must complete first)
- **Acceptance criteria** (observable product behavior, not implementation steps)
- **Status** (`todo` | `in-progress` | `blocked` | `done`)
- **Evidence location** (file path, test name, or screenshot path when done)

## Parallelizable vs. sequential work

**Can run in parallel (no shared file conflicts):**
- Designer building visual components against typed fixtures
- Coder proving SSH/execution mechanics on disposable targets
- Tester writing acceptance matrix and initial test scaffolding

**Must be sequential:**
- Schema changes → all dependent UI/API work
- Feasibility checkpoint → any live-server maintenance
- Disposable-target gate → real-server work
- Founder authorization → any AWS spend or DNS change

## Fixture labeling rule

Any screen, component, or data snapshot that uses synthetic/fixture data must carry a visible `[FIXTURE DATA]` label in the UI and in the file. This label is never removed until the surface is connected to a real, authorized data source. This is a product invariant, not a development convenience.

## Merge rule (O-T2, 2026-11-21)
After merging into `integration/live-v1` (the founder's running app), run `pnpm install && pnpm -r --if-present run build` in /projects/servrsit and check that `curl http://127.0.0.1:3001/health` answers. A stale `dist/` crashed the running API once.
