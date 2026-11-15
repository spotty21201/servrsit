# ServrSit — Decision Log

Architecture decisions, implementation choices, and resolved trade-offs.  
Format: ID · Date · Owner · Status · Summary · Rationale · Consequences.

Proposed decisions pending founder review are marked **[PENDING FOUNDER]**.  
Decisions made by agents within their authority are marked **[AGENT DECISION]**.  
Decisions requiring founder input before proceeding are marked **[BLOCKED: FOUNDER INPUT NEEDED]**.

---

## ADR-001 — Monorepo with pnpm workspaces

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator |
| **Status** | [AGENT DECISION] — Adopted |
| **Requirements** | Technical Spec §3.2 |

**Decision:** Use pnpm workspaces for the monorepo package manager.

**Rationale:** Technical Spec specifies a workspace package manager with committed lockfile. pnpm provides efficient disk usage, strict dependency isolation between packages, and first-class workspace support. Compatible with the specified stack (Node.js 24, TypeScript, Vite).

**Consequences:** All agents use `pnpm` commands. `pnpm-lock.yaml` committed. `node_modules` gitignored at root. Per-package `node_modules` managed by pnpm.

---

## ADR-002 — Single schema library: Zod

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator |
| **Status** | [AGENT DECISION] — Adopted, subject to Coder confirming version at T-005 |
| **Requirements** | Technical Spec §3.1 "choose one schema library consistently" |

**Decision:** Use Zod for runtime schema validation and TypeScript type generation throughout `packages/contracts/`.

**Rationale:** Zod is a single library that covers runtime validation and TypeScript type inference, satisfying the spec's requirement for one consistent schema library. Avoids dual-stack of e.g. JSON Schema + separate type generation. Well-maintained; compatible with Fastify via `fastify-type-provider-zod`.

**Consequences:** All shared schemas in `packages/contracts/` use Zod. API request/response validation uses the same schemas. Types are inferred (`z.infer<typeof Schema>`), not separately maintained.

---

## ADR-003 — AWS region: Singapore (ap-southeast-1) as first evaluation candidate

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator |
| **Status** | [PENDING FOUNDER] — Under evaluation; no resources created |
| **Requirements** | Technical Spec §19; PRD §11.2 |

**Decision proposed:** Evaluate ap-southeast-1 (Singapore) as the first AWS region.

**Rationale:** Technical Spec names Singapore as first-region candidate for evaluation from Indonesia. Subject to: Bedrock model availability in region, measured routing latency to founder's servers, data residency requirements, and cost.

**Consequences:** T-015 cost worksheet must confirm Bedrock model availability in ap-southeast-1. If a required model is not available there, the nearest alternative region is evaluated and presented to Spotty. No resources are provisioned until Spotty reviews the worksheet and authorizes spend.

**Blocked on:** Spotty's AWS spend authorization after reviewing T-015.

---

## ADR-004 — Dedicated EC2 per owner (not shared multi-tenant)

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator |
| **Status** | [AGENT DECISION] — Adopted for Stage A and small pilot B |
| **Requirements** | Technical Spec §1.1; PRD §11.2 |

**Decision:** One dedicated EC2 installation per owner. Each pilot owner gets a separate controller with its own database, IAM role, signing key, secrets namespace, and Tailscale identity.

**Rationale:** Directly satisfies PRD's isolated workspace requirement. Avoids shared-tenancy execution design which is explicitly deferred. Conventional Linux host supports persistent Tailscale and long-lived SSH.

**Consequences:** Per-owner instance cost may exceed the US$7.25 direct envelope at the US$29 illustrative price. T-015 must quantify this. If costs fail the envelope, pricing or architecture must be revised before any paid launch. Never silently pool private-network access to reduce costs.

---

## ADR-005 — Stage A light theme only; no OS dark-mode auto-invert

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator (from UX Spec) |
| **Status** | [AGENT DECISION] — Adopted |
| **Requirements** | UX Spec §4.2 |

**Decision:** Stage A ships light theme only. No automatic color inversion based on OS `prefers-color-scheme: dark`.

**Rationale:** UX Spec explicitly states: "A full alternate dark theme is deferred until its states and contrast receive equivalent design attention; do not auto-invert the application based on OS preference." Transcript surface uses dark Ink as a deliberate design choice, not a system preference response.

**Consequences:** Designer does not implement `prefers-color-scheme` media queries for a global dark theme. The transcript's dark surface is a fixed design element. Dark theme is a future candidate requiring full state/contrast design attention.

---

## ADR-006 — pg-boss for durable job queue; separate remote operation ledger for SSH idempotency

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator |
| **Status** | [AGENT DECISION] — Adopted |
| **Requirements** | Technical Spec §3.1, §9 |

**Decision:** Use pg-boss for job queue state in PostgreSQL. Maintain a separate remote operation ledger on the target for exactly-once SSH side-effect guarantees.

**Rationale:** Technical Spec explicitly states: "pg-boss delivery guarantees do not establish exactly-once execution of an external SSH side effect. That guarantee requires the remote operation ledger and reconciliation." pg-boss alone is insufficient; the two-layer approach is required.

**Consequences:** Coder must implement both: pg-boss for controller-side queue durability, and the target-side ledger (root-owned, atomically claimed) for remote operation idempotency. All retry paths query the remote ledger before any new action.

---

## ADR-007 — Font delivery: self-hosted, not CDN

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator (from UX Spec) |
| **Status** | [AGENT DECISION] — Adopted |
| **Requirements** | UX Spec §4.1 |

**Decision:** Bricolage Grotesque and Geist fonts are served from the application's own delivery path with pinned assets. Not loaded from Google Fonts, Vercel CDN, or any third-party CDN.

**Rationale:** UX Spec states: "Production should serve pinned font assets through the application's own delivery path." Vercel CDN is not required. Using Geist does not imply Vercel hosting.

**Consequences:** Designer obtains font files from the open-licensed source repositories (Bricolage Grotesque: github.com/ateliertriay/bricolage; Geist: github.com/vercel/geist-font). License files committed alongside assets. Load only required styles/weights. System fallbacks defined in CSS.

---

## Pending decisions (require Spotty input before proceeding)

| ID | Decision | Blocking task |
|---|---|---|
| D-AWS-01 | AWS region confirmation and spend authorization | T-015 |
| D-HELPER-01 | Helper bootstrap acceptance (persistent files on managed servers) | T-012, before any live maintenance |
| D-TAILSCALE-01 | Tailscale enrollment for dedicated controller | T-016 |
| D-DOMAIN-01 | Product domain purchase and DNS | Before any public deployment |
| D-COMMERCIAL-01 | Charge vs. personal tool decision | After Stage B |

---

## ADR-008 — Pinned runtime versions: Node.js 24.22.3 and PostgreSQL 17.12

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Coder |
| **Status** | [AGENT DECISION] — Adopted |
| **Requirements** | Technical Spec §3.1 "pin the current supported security patch"; "recheck selected branches at repository initialization" |

**Decision:** Pin Node.js to **24.22.3** and PostgreSQL to **17.12** as the confirmed current patch releases at M0 kickoff.

**Verification method:** Versions confirmed via official release listings.
- Node.js 24.22.3: `https://nodejs.org/dist/latest-v24.x/` — confirmed 2026-11-15, released 2026-11-11.
- PostgreSQL 17.12: `https://www.postgresql.org/ftp/source/` — confirmed 2026-11-15, released 2026-11-09.
- Support lifecycle data sourced from `https://endoflife.date/api/nodejs.json` and `https://endoflife.date/api/postgresql.json`.

**Support lifecycle:**

| Component | Current version | Active support ends | End of life |
|---|---|---|---|
| Node.js 24 LTS | 24.22.3 | 2026-10-20 | **2028-04-30** |
| PostgreSQL 17 | 17.12 | — (rolling security patches) | **2029-11-08** |

**Planned upgrade actions:**

- **Node.js 24 LTS** active support ended 2026-10-20 (security-only maintenance period). Upgrade path to Node.js 26 LTS (expected October 2027 LTS status) must be planned and executed before **2028-04-30**. Create a tracking task before 2027-10-01.
- **PostgreSQL 17** receives security/bug patches until 2029-11-08. Monitor the PostgreSQL release calendar quarterly and apply patch updates at each deployment. No major-version migration is required during Stages A–B.

**Package manager:**
- pnpm **12.21.0** installed alongside Node.js 24.22.3. Pin this version in root `package.json` `engines` field. Update pnpm when security advisories are published.

**Consequences:**
- `.node-version` file at repo root contains `24.22.3` for tooling compatibility.
- Root `package.json` `engines` field specifies `"node": ">=24.22.3"`.
- PostgreSQL version pinned in infrastructure manifests (CDK/deployment config) at T-010+.
- All team members and CI environments use Node.js 24.22.3 exactly. Never infer version compatibility from this document alone — recheck against official release pages before upgrades.
