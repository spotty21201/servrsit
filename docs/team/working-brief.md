# ServrSit — Working Brief

Prepared by Kiro Orchestrator · 2026-11-15 · Based on all four source documents read in full.

---

## What we are building

ServrSit is a cloud-hosted, AI-assisted caretaker for a small personal fleet of Ubuntu servers. The owner — Spotty, a designer-builder with servers named Sentani, Nabire, and Timika — wants to spend less time being a server administrator and more time building.

The product replaces: opening multiple terminals, reconstructing context, manually running updates, and not knowing whether anything worked.

The core loop is: **Inspect → explain → propose → approve → execute → verify.**

The owner approves named, scoped work. ServrSit runs it durably (independent of the laptop), confirms the result, and keeps an honest record. AI interprets intent and explains evidence; a constrained execution system performs supported operations. The model does not administer servers.

---

## Who it is for

**Primary:** Spotty (founder and first user). Independent founder/designer/builder with 2–20 Ubuntu servers, existing SSH access, no infrastructure team, no appetite for becoming a sysadmin.

**Secondary:** Independent developers, homelab owners with similar profiles.

**Excluded:** Enterprise ops teams, MSPs, Kubernetes operators, regulated deployments, anyone who cannot establish any remote access.

---

## First release (Founder Alpha — Stage A)

The smallest credible product that replaces Spotty's recurring manual workflow:

- Connect existing servers; verify host identity independently
- Inspect: OS, uptime, CPU/memory/disk, services, pending packages, reboot evidence
- Explain findings in plain language; honest freshness and coverage
- Propose package updates with exact scope and interruption risk
- Approve per-server; execute durably; verify actual postconditions
- Explicitly restart a service (separate approval); explicitly reboot (separate approval)
- Compare servers against an owner-defined baseline of directories and packages
- Prepare a new server against that baseline (no cloning of secrets or app data)
- Scheduled checks every 15 min (health) and daily (inventory) — runs with laptop closed
- In-app findings; operation history; export
- Deterministic fallback when AI is unavailable

**Exit gate:** All Stage A requirements pass + four weeks of real use by Spotty.

---

## Non-goals (Stages A–B — do not build, do not hint at)

Kubernetes · containers · CI/CD · application deployment · autonomous remediation · scheduled patching · unrestricted AI shell commands · writable terminal · multi-operator permissions · enterprise SSO · public APIs · database administration · backup/restore management · OS installation · release upgrades · billing · payment integration.

---

## Critical invariants

1. AI text is never authorization or proof of server state.
2. No model-generated shell commands execute on any server.
3. Approval binds to one plan version, one scope, one expiry.
4. SSH disconnection is not evidence a command stopped.
5. Unknown outcome blocks conflicting writes.
6. Exit code zero is not sufficient verification.
7. No fault injection on Sentani, Nabire, Timika.
8. No live maintenance until disposable-target gates pass.
9. Fixture data and live data are always visibly distinct.
10. The owner retains independent SSH access; ServrSit's disconnect does not lock them out.

---

## Architecture summary

One dedicated EC2 instance per owner (separate per pilot owner). Web app + API + worker + SSH executor + PostgreSQL running as local services. AWS managed services for: Cognito (auth + MFA), Secrets Manager + KMS (credentials + signing), S3 (backups + audit objects), Bedrock (inference), CloudWatch (ops).

Private-network access via Tailscale (controller enrolled as narrowly scoped device in owner's tailnet). No persistent agent required on managed servers — a small restricted helper is installed only after disposable-target gates pass and owner authorizes it.

**Feasibility checkpoint required before any live maintenance.** AWS cost worksheet required before any AWS spend.

---

## Three workstreams (can begin in parallel after M0)

| Workstream | Owner | First task |
|---|---|---|
| Visual foundation + core screens | Designer | T-017: token system and component library |
| Risky mechanics proof | Coder | T-010: disposable Ubuntu target + T-004: monorepo init |
| Acceptance test matrix | Tester | T-009: acceptance matrix from PRD scenarios |

---

## Decisions needed from Spotty (not yet, but flagged)

| Decision | When |
|---|---|
| AWS region and spend authorization | After T-015 cost worksheet is complete |
| Helper bootstrap acceptance (persistent file on managed servers) | Before write enablement on real servers |
| Tailscale enrollment for controller | Before private-network feasibility test |
| Final product spelling / domain / branding | Before any public-facing deployment |
| Commercial decision (charge or personal tool) | After Stage B pilot evidence |

None of these block M0–M1 work on fixtures, local mechanics, and the acceptance matrix.

---

## Known gaps and open questions

See `docs/decisions/contradictions.md` for document-level conflicts.
See `docs/decisions/risk-register.md` for principal risks.

**Unresolved at M0:**
- Exact Node.js and PostgreSQL minor versions (Coder confirms at T-005)
- Bedrock model/region selection and data retention verification (Coder at M1–M2)
- Exact Tailscale commercial terms for multi-owner pilot use (Coder at T-016)
- python3-apt API behavior on Ubuntu 24.04 specifically (Coder at T-014)
- Whether dedicated-per-owner EC2 fits the US$7.25 direct cost envelope (Coder at T-015)
