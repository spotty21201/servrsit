# ServrSit — Contradiction and Conflict Log

Documents where source documents conflict, are ambiguous, or require a resolution decision before implementation.  
Maintained by Orchestrator. Agents must not resolve contradictions silently — log here and wait for resolution.

---

## Status legend

| Symbol | Meaning |
|---|---|
| ⚠️ Open | Conflict identified; resolution pending |
| ✅ Resolved | Resolution decided; logged in decision-log.md |
| ℹ️ Note | Not a conflict; clarification recorded for implementation |

---

## C-001 — "ServrSit" vs "ServerSit" spelling

| Field | Value |
|---|---|
| **Status** | ✅ Resolved |
| **Documents** | Manifesto, PRD §1.1, UX Spec §2 |
| **Conflict** | Manifesto and product copy use "ServrSit". PRD requests "ServerSit" for document filenames. UX Spec §2 explicitly states "The product spelling is ServrSit. Requested document filenames retain ServerSit." |
| **Resolution** | Product copy, UI, branding, and code identifiers use **ServrSit**. Document filenames in `docs/product/` retain **ServerSit** prefix. This distinction is maintained until Spotty makes a final branding decision. No agent changes either convention. |

---

## C-002 — Helper as "non-daemon" vs. "small restricted helper"

| Field | Value |
|---|---|
| **Status** | ✅ Resolved (pending founder confirmation of acceptability) |
| **Documents** | Technical Spec §7.2; PRD §5.2 "No persistent ServrSit agent required" |
| **Conflict** | PRD §5.2 states "No persistent ServrSit agent required." Technical Spec §7.2 specifies a "small, explicitly installed restricted helper" with a remote operation ledger. These appear contradictory on first read. |
| **Resolution** | Technical Spec §7.2 clarifies the reconciliation: "This is not a continuously running agent: it has no listening port, polling loop, or background model. It runs only for authenticated SSH requests and already accepted transient jobs." The PRD's intent is no always-running background process — the helper satisfies that. It is a material onboarding choice; Spotty must confirm acceptability before write enablement (Decision D-HELPER-01). Designer must disclose the files, permissions, dependencies, and removal process clearly in the connection flow. |

---

## C-003 — Tailscale as dependency outside Amazon

| Field | Value |
|---|---|
| **Status** | ⚠️ Open — requires T-016 investigation |
| **Documents** | PRD §11.3; Technical Spec §6.1 |
| **Conflict** | PRD §11.3 describes Tailscale as "an intentional compatibility dependency outside Amazon" but also states "If the founder later requires exclusively Amazon components, the replacement must preserve private access and acceptable setup effort." Technical Spec uses Tailscale as the assumed private-network path. No purely-AWS alternative is designed. |
| **Resolution needed** | T-016 must document Tailscale enrollment flow and investigate commercial terms for pilot use. Orchestrator presents findings to Spotty before private-network work on real servers begins. If Tailscale is unacceptable, a VPN/AWS alternative design must be proposed. |

---

## C-004 — "Package metadata refresh" permission classification

| Field | Value |
|---|---|
| **Status** | ✅ Resolved |
| **Documents** | PRD §5.2 FR-05; Technical Spec §8 `refresh.package_metadata.v1` |
| **Conflict** | PRD FR-05 states "Refreshing package metadata is identified as a bounded system write, covered by a disclosed setup permission or a separate approval; it is not mislabeled as purely read-only." Technical Spec lists it as "Explicit bounded standing consent or per-plan approval." The UX Spec §7.3 says "The bounded Allow package-list refresh permission is separate from package installation. Default it off until explicitly selected." |
| **Resolution** | Package metadata refresh (`apt-get update` equivalent) is a write operation. It defaults to OFF. It requires either: (a) explicit opt-in during server setup disclosed as a bounded write, or (b) per-plan approval. It is never implied by a read-only inspection. The UI must show this as a distinct permission with the explanation: "Refreshes available-package information on this machine. It does not install updates." |

---

## C-005 — "Up to 20 servers" performance targets

| Field | Value |
|---|---|
| **Status** | ℹ️ Note |
| **Documents** | PRD §10; Technical Spec §19 |
| **Conflict** | None — consistent. PRD states targets; Technical Spec carries them forward with the same numbers. |
| **Note** | Performance targets (p95 fleet view <2s; 95% of inspections <30s at ≤350ms RTT; 99% schedules start within 2 min) are **proposed acceptance targets**, not guaranteed specifications. Technical Spec §19 explicitly states "Measure them in representative conditions and revise openly if feasibility testing shows they are inappropriate." Load test at 20 servers, 4 concurrent inspections. |

---

## C-006 — Reboot verification window

| Field | Value |
|---|---|
| **Status** | ℹ️ Note |
| **Documents** | Technical Spec §10.3 |
| **Conflict** | None — but requires explicit implementation note. |
| **Note** | Initial reboot return-verification window is **10 minutes**, configurable by operation policy. At expiry, outcome is marked unknown/unresolved. ServrSit does not issue another reboot attempt. This is a policy decision embedded in the Technical Spec that the Coder must implement exactly — not a configurable end-user setting in Stage A. |

---

## C-007 — "Inspect only" mode without helper vs. write mode requiring helper

| Field | Value |
|---|---|
| **Status** | ✅ Resolved |
| **Documents** | Technical Spec §7.1–7.2; PRD §5.2 |
| **Conflict** | The spec describes two distinct modes. The connection flow (UX §7.3) distinguishes "Inspect only" and "Enable approved maintenance." Some Stage A requirements (FR-05 inspection) work without the helper; others (FR-12 package updates) require it. |
| **Resolution** | Inspect-only mode: no helper installed, runs fixed bounded collectors over SSH. Approved-maintenance mode: requires helper installation, which is a separate explicit step disclosed to the owner. The UI clearly separates these access levels. Stage A must fully support inspect-only; approved maintenance requires the helper and passes the disposable-target gate first. No silent elevation between modes. |

---

## C-008 — Cognito managed login vs. brand visual consistency

| Field | Value |
|---|---|
| **Status** | ⚠️ Open — Designer to address at T-022 and UX-01 |
| **Documents** | UX Spec §7.1; Technical Spec §5 |
| **Conflict** | UX Spec §7.1 states "Managed identity screens may have provider layout limits; do not build insecure custom authentication to achieve visual consistency." Designer must carry brand through "supported theming." Technical Spec uses Cognito managed login (hosted UI). |
| **Resolution needed** | Designer determines what Cognito hosted UI theming supports (logo, colors, return navigation) and designs within those limits. If theming is insufficient for the brand, the resolution is to accept the limitation — not to build custom auth. Document the specific theming constraints as part of T-022. |
