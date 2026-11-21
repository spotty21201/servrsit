---
inclusion: always
---

# ServrSit — Product steering

## Product identity

**ServrSit** (product spelling). Document filenames use **ServerSit**. Do not change either convention without an explicit founder decision.

**Tagline:** Your servers have a sitter. Less babysitting. More building.

**Central promise:** The owner spends less time being a server administrator—and enjoys the product that makes that possible.

## What we are building

A cloud-accessible, AI-assisted caretaker for a small fleet of Ubuntu servers (2–20), owned by one person who needs infrastructure to support their work, not become their work.

**Core loop:** Inspect → explain → propose → approve → execute → verify.

## Release stages (evidence gates, not calendar dates)

| Stage | Purpose |
|---|---|
| Feasibility checkpoint | Prove riskiest mechanics: private-network SSH, interrupted-operation recovery, APT transaction safety |
| A — Founder alpha | Replace the founder's recurring manual workflow; four-week real use |
| B — Invited pilot | 5–10 isolated external owners; email alerts; onboarding independence |
| C — Paid release | Subscription with real commercial validation; independent security review |

## Non-goals for Stages A–B (do not build, do not hint at)

- Kubernetes, containers, CI/CD, application deployment
- Autonomous remediation or scheduled patching
- Unrestricted AI-generated shell commands or a writable terminal
- Multi-operator permissions, enterprise SSO, public APIs
- Database administration, backup/restore management
- OS installation, release upgrades, cross-distribution management
- Billing, payment integration

## Founder's real servers

- **Sentani** — reinstalled as the disposable test server (ADR-021); fault injection allowed there only.
- **Nabire, Timika** (and Merauke, the dev host) — real machines. No fault injection. No live maintenance until disposable-target gates pass and the specific work is explicitly authorized.

## Product principles (from PRD §4)

1. Evidence before reassurance — "Healthy" only covers checks performed.
2. Simplicity measured in user effort, not screen sparsity.
3. AI removes interpretation work; execution stays deterministic.
4. Approval must be meaningful — named target, scope, expected impact.
5. Operations outlive conversations.
6. The user can leave — export, disconnect, retain independent SSH.
7. Personality serves clarity; humor belongs in routine success states only.

## Source authority

| Document | Authority |
|---|---|
| `docs/product/01_ServerSit - Founders Vision and Manifesto.md` | Intent and character |
| `docs/product/02_ServerSit - PRD.md` | Scope, outcomes, permissions, acceptance criteria, release gates |
| `docs/product/03_ServerSit - UX Spec.md` | Visual identity, composition, interactions, states |
| `docs/product/04_ServerSit - Technical Spec.md` | Implementation architecture, engineering contracts |

Contradictions between documents are logged in `docs/decisions/contradictions.md` and resolved by the Orchestrator before implementation.
