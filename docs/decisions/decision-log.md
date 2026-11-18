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

## ADR-009 — Disposable Ubuntu target: founder-provisioned

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator |
| **Status** | [FOUNDER DECISION] — Recorded |

**Decision:** Spotty will provision the disposable Ubuntu 24.04 target when ready. Coder documents the exact requirements (spec, SSH access, teardown) in T-010 so the machine can be set up quickly when available.

**Consequences:** T-010 through T-014 (SSH mechanics, helper bootstrap, APT locking, disconnect/retry proof) are blocked until the VM is provided. T-015 AWS worksheet, T-017–T-022 visual screens, and T-023 API scaffold are all unaffected and proceed now.

---

## ADR-010 — AWS cost worksheet: public pricing estimate, no account access

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator |
| **Status** | [FOUNDER DECISION] — Recorded |

**Decision:** No AWS account exists. T-015 produces a cost worksheet using AWS public pricing pages only. No resources are created or accessed.

**Consequences:** The worksheet will be estimates from published pricing, not measured actuals. It remains valid as a decision input — the purpose is to determine whether the dedicated-per-owner architecture fits the US$7.25 direct cost envelope before Spotty decides to open an AWS account. If costs are clearly infeasible, the architecture decision (ADR-004) is revisited before any account is created.

---

## ADR-011 — Founder UX direction v1 overrides UX Spec v0.1 on six points

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator |
| **Status** | [FOUNDER DECISION] — Recorded |
| **Source** | docs/team/ux-feedback-001.md |

**Decision:** (1) Remove the large briefing headline. (2) Replace the warm Canvas background. (3) Lighten the display/title weight (floor 300). (4) Pixel-art server icon replaces the geometric emblem. (5) Server cards first, chat bar bottom, shorter and narrower. (6) Keep server card design.

**Rationale:** Founder is the product decision-maker (PRD §18). UX Spec v0.1 was proposed for founder review.

**Consequences:** UX Spec signature 1 (typographic briefing) is retired. PRD FR-06 still requires that unknown/stale/failed states are visible and never shown as healthy; that is met by per-card status badges and the attention list, not a headline. Orchestrator will reflect these changes in the UX Spec after the founder approves the second mockup. Contrast checks (WCAG 2.2 AA) still apply to any new palette.

---

## ADR-012 — Dev wiring: read-only inspection of real servers, Kiro as interim AI

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Owner** | Orchestrator |
| **Status** | [FOUNDER DECISION] with Orchestrator-imposed limits |

**Founder authorization (2026-11-15):** wire the app to Sentani, Nabire, Timika and Merauke over SSH (`ssh spotty@<host>`), and use Kiro as the AI for now.

**Scope limits (Orchestrator):**
1. **Read-only inspection only.** Fixed, reviewed collectors. No sudo, no writes, no `apt update` (it is a write), no helper install, no restart/reboot, no fault injection. Maintenance stays blocked until disposable-target gates pass and specific live work is authorized (execution-security invariants 11-12).
2. **Host identity:** the app uses a pinned known_hosts file with StrictHostKeyChecking=yes. Entries are added only after the founder verifies each fingerprint out of band. Until then the app must not log in to that host.
3. **Credentials:** dev uses the founder's existing SSH keys on the dev host (Nabire has a dedicated key). Spec 5 prefers dedicated keys; recommended later. Keys are never read into the app, logged, or sent to AI.
4. **Merauke is the dev host and controller** (it runs the app and agents). It resolves to loopback, which Technical Spec 6.2 blocks. Accepted for dev only: Merauke is inspected by a local collector (no SSH to itself) and labeled "Dev host". The production controller on AWS will not manage itself.
5. **Data labeling:** every card shows its data source (FIXTURE or LIVE). Live and fixture data never mix without a visible label (invariant 14).

**Interim AI (Kiro CLI) deviations from the spec (Bedrock):** adapter calls `kiro-cli chat --no-interactive` with a dedicated agent that has NO tools. Input is sanitized structured observations only: no credentials, no raw files, no raw command output. Output is explanation text only and is never executed or treated as authorization or proof. Kiro's data retention and processing terms have not been verified against the product data policy, so this is for the founder's own servers only, never customer data. Kiro usage is metered (a monthly limit was already hit once), and AI failure must not break inspection (FR-08).

## ADR-013 — Interim AI: OpenAI-compatible routing endpoint (replaces Kiro CLI as default)

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Status** | [FOUNDER DECISION] |

**Decision:** AI calls go to an OpenAI-compatible endpoint (`AI_BASE_URL`, provider `vip-api.mind-aku.my.id`), model `deepseek-v4.1-flash`, via `/chat/completions`. Configured in `apps/api/.env` (gitignored, mode 600); `.env.example` committed with placeholders. Kiro adapter kept as `AI_PROVIDER=kiro`; `none` = deterministic only.

**Limits (unchanged from ADR-012):** sanitized structured observations only; no credentials, key paths, raw files or raw output; explanation text only; never executed, never authorization or proof; timeout and deterministic fallback (FR-08).

**Risks accepted for dev:** (1) the key was shared in chat, so it should be rotated before any wider use; (2) this is a third-party routing proxy whose data retention and onward routing are unknown, so it is acceptable for the founder's own sanitized server facts only, never customer data; (3) the response reports model `cb/deepseek-v4.1-flash`, so the actual upstream is set by the proxy and is not verified. Replace with the spec's Bedrock adapter (or a vetted provider) and a secrets manager before Stage B.

## ADR-014 — Local-only hosting for development; disposable server after development; dedicated keys

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Status** | [FOUNDER DECISION] with Orchestrator gate |

**Decisions:** (1) The disposable Ubuntu server will be provided after development. (2) Dedicated ServrSit SSH keys for Sentani and Timika, stored on Merauke in `~/.ssh/servrsit/` (mode 700/600), installed by the founder with `restrict,from="100.104.220.8"` (no forwarding/PTY; only from Merauke's tailnet address). (3) No AWS for now; ServrSit runs locally on Merauke. Prepare the AWS deployment definition and runbook so it is ready when the founder approves spend.

**Orchestrator gate (non-negotiable, execution-security invariants 11-12):** write operations (package updates, restart, reboot, directory preparation) may be fully built and tested against simulated targets, but stay **disabled for real servers** behind a per-server `writesEnabled=false` flag until the disposable-server tests (T-010–T-014, fault-injection FI-*) pass and the founder authorizes specific live work. Mocks and containers cannot prove APT locking, transient-job survival or reboot behavior.

**Consequences:** Feasibility checkpoint and alpha exit remain open: Merauke is both controller and managed host (PRD D-04 requires independence). Nabire still uses the founder's existing key; moving it to a dedicated ServrSit key is recommended before revocation tests. If the controller's address changes (AWS), the `from=` restriction must be updated on each server.

## ADR-015 — Assistant voice and server roles (voice revised same day)

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Status** | [FOUNDER DECISION] |

**Decision:** Voice (revised by founder the same day): plain English by default, with a light cheeky touch allowed in routine good-news moments, in both the assistant and app copy. Never cheeky about failures, outages, data loss, security or client-facing impact. This matches the manifesto and UX Spec §17. Server roles: Timika = remote client-facing VPS in Europe (production); Sentani = personal server, planned home of Hermes, limited resources (non-production); Nabire and Merauke = development servers in the home studio (non-production; Merauke is also the dev host). No important services selected yet. Source: docs/team/assistant-context-draft.md.

**Resolved:** applies to both assistant and UI copy.

## ADR-016 — Founder authorization for unattended development run

| Field | Value |
|---|---|
| **Date** | 2026-11-15 |
| **Status** | [FOUNDER DECISION] |

**Authorized:** Orchestrator continues pending tasks 2–8 without further check-ins: design, code, tests, merges into `integration/live-v1`, read-only inspection of the four servers.
**Not covered (still require founder):** any write on a real server (updates, restarts, reboots, files, helper install), any spending (AWS, domains), changes to keys/authorized_keys, Tailscale changes, exposing anything beyond the tailnet, and product-scope changes. Decisions made during the run are logged here and summarised for the founder.

## ADR-018 — Login merge sequencing

| Field | Value |
|---|---|
| **Date** | 2026-11-17 |
| **Status** | [AGENT DECISION] (within ADR-016) |

**Decision:** Keep owner login (T-053, branch `feat/coder/owner-auth`) and login screens (T-065) out of `integration/live-v1` until (1) the founder has fixed Merauke's clock (founder-actions.md item 1) and (2) T-066 lands. Then merge, and the founder enrols.

**Reason:** Enrolling while the controller clock is 7 h fast leaves TOTP unusable after the correction (D-A3), and an un-merged login keeps the founder's current dev UI working. Risk accepted meanwhile: the dev API stays open on loopback and, via the Vite proxy, to the founder's tailnet (F8). Writes remain disabled on all real hosts.

## ADR-019 — `integration/next` branch for work that depends on login

| Field | Value |
|---|---|
| **Date** | 2026-11-18 (controller clock) |
| **Status** | [AGENT DECISION] (within ADR-016) |

**Decision:** Coder creates `integration/next` = `integration/live-v1` + `feat/coder/owner-auth` + `feat/coder/server-registration`, resolving the repeated API conflicts once (auth guard, clock check, registration, care routes). From then on Coder, Designer and Tester base new work on `integration/next`. `integration/live-v1` stays the founder's running app until ADR-018's conditions are met (clock fixed); then `integration/next` is merged into it.

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
