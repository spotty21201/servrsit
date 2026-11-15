---
inclusion: always
---

# ServrSit — Technology steering

## Stack (from Technical Spec §3.1)

| Layer | Selection | Constraint |
|---|---|---|
| Web | React + TypeScript, Vite | Accessible headless primitives; CSS tokens from UX Spec |
| API | Fastify + TypeScript | Schema-validated endpoints; server-managed sessions |
| Worker/executor | Node.js TypeScript | OpenSSH subprocess with fixed arguments; no model-generated shell |
| Shared contracts | Runtime schemas + generated TypeScript types + OpenAPI | One schema library throughout |
| Database | PostgreSQL 17 (current supported minor at kickoff) | Local Unix socket; no public port |
| Durable jobs | pg-boss | Requires separate remote operation ledger for exactly-once SSH side effects |
| Target helper | Python 3.12, Ubuntu-packaged deps including python3-apt | No pip from unpinned internet; versioned, checksum-verified |
| Runtime | Node.js 24 LTS (pin current security patch) | Record planned upgrade before end of support |
| Infrastructure | AWS CDK in TypeScript | Reviewable CloudFormation output |
| Browser tests | Playwright | Accessibility automation + manual keyboard/screen-reader |
| Unit/integration | Compatible TS runner + pytest for target helper | — |

## Dependency discipline

- Pin **exact** versions in lockfile and deployment manifest. Never use `latest`.
- Verify Node.js and PostgreSQL support lifecycles at repository initialization — do not trust this document's versions as current.
- Recheck all external sources (libraries, AWS services, Tailscale) during implementation.

## Repository structure

```
docs/product/          # Source documents — read-only during implementation
docs/decisions/        # ADRs, contradiction log, approved requirement changes
docs/team/             # Task board, handoffs, risk register, test evidence
.kiro/steering/        # These steering files
.kiro/specs/           # Feature requirements, design, tasks traced to PRD IDs
.kiro/agents/          # Agent definitions
apps/web/              # Screens, routes, view models, local UI state
apps/api/              # Auth, authorization, API, plans, approvals, event streams
apps/worker/           # Scheduler, queue, execution, reconciliation, verification
packages/contracts/    # Shared schemas, state enums, API error codes
packages/domain/       # Deterministic policy, plan validation, finding rules
packages/ui/           # Tokens and accessible presentation components
packages/ssh/          # Transport, host identity, collectors, bounded parsing
packages/ai/           # Bedrock adapter, structured intent, grounded summaries
target-helper/         # Restricted gateway, operation adapter, signed manifests, remote ledger
infra/                 # CDK, service configuration, deployment/recovery scripts
tests/fixtures/        # Clearly labeled synthetic server snapshots and malicious-output cases
tests/e2e/             # Browser and complete workflow tests
```

## AWS direction

Preferred for hosting, secrets, identity, signing, inference, and backups. Not finalized until the cost worksheet is reviewed and authorized by Spotty.

**Initial hosting model:** One dedicated EC2 instance per owner. Separate installation per invited pilot owner.

**First-region candidate for evaluation:** Singapore (ap-southeast-1) — subject to service/model availability, measured routing to founder's servers, data requirements, and cost. Founder authorizes spend and region after reviewing concrete cost worksheet.

**Do not:**
- Purchase a domain, change DNS, deploy publicly, or create paid resources without explicit founder authorization.
- Use Fargate, Lambda, or shared multi-tenant execution without a separate reviewed design.

## Package manager

Use a workspace package manager (pnpm preferred for monorepo) with a committed lockfile. Do not commit generated credentials, environment files, database dumps, or raw server outputs. Commit example configuration with placeholders only.
