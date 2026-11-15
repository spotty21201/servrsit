# ServrSit — Risk Register

Maintained by Orchestrator. Updated when risks change materially.  
Source: PRD §15 and Technical Spec §16, supplemented by implementation analysis.

---

## Risk rating

**Likelihood:** Low / Medium / High  
**Impact:** Low / Medium / High / Blocker  
**Status:** Open / Mitigated / Closed / Triggered

---

## R-001 — Dedicated EC2 cost exceeds US$7.25/workspace envelope

| Field | Value |
|---|---|
| **Likelihood** | High |
| **Impact** | Blocker for paid launch |
| **Status** | Open |
| **Source** | PRD §13.3; Technical Spec §19 |

An always-on dedicated EC2 instance per owner, with Tailscale, S3, KMS, Secrets Manager, Cognito, CloudWatch, and Bedrock inference, is likely to exceed the US$7.25 direct cost implied by an illustrative US$29 subscription at 25% gross margin.

**Response:** T-015 produces a concrete dated cost worksheet before any AWS spend. If costs exceed the envelope, Spotty decides: raise price, change architecture (shared service with reviewed isolation design), or treat as a personal tool with no paid launch. Never silently pool private-network access to reduce costs.

**Trigger to escalate:** T-015 estimate exceeds US$10/workspace/month at idle.

---

## R-002 — Private-network onboarding is too hard for pilot users

| Field | Value |
|---|---|
| **Likelihood** | Medium |
| **Impact** | High |
| **Status** | Open |
| **Source** | PRD §15 |

Tailscale enrollment for a dedicated controller, plus SSH key setup and host-key independent verification, may be too complex for the target Stage B pilot users who "can establish SSH access, sometimes with help."

**Response:** Measure total setup time in Stage A with Spotty. If onboarding takes >30 minutes without developer help, revisit before Stage B. Consider assisted onboarding as a separately priced service. Never hide setup difficulty from pilot recruitment messaging.

**Trigger to escalate:** Spotty's setup takes >30 minutes, or first Stage B tester fails to connect independently.

---

## R-003 — Update interruption leaves uncertain state; blind retry makes it worse

| Field | Value |
|---|---|
| **Likelihood** | Medium |
| **Impact** | Blocker |
| **Status** | Open (mitigated by design) |
| **Source** | PRD §15; Technical Spec §9.3–9.4 |

An SSH disconnect during a package transaction cannot be treated as confirmation the transaction stopped. A naive retry would issue a second concurrent dpkg operation.

**Mitigation designed:** Remote operation ledger with atomic claim; query-before-retry invariant; outcome-unknown state blocks conflicting writes; T-013 and T-014 prove this on disposable targets before any live maintenance. No manual lock deletion, no kill of package manager.

**Trigger to escalate:** T-013 or T-014 fail to demonstrate safe reconciliation. Blocks all live maintenance until resolved.

---

## R-004 — AI output or server content used as execution instruction

| Field | Value |
|---|---|
| **Likelihood** | Low (by design) |
| **Impact** | Blocker |
| **Status** | Open (mitigated by architecture) |
| **Source** | Technical Spec §16; execution-security steering |

Prompt injection via server output (package names, log lines, filenames) could attempt to cause the model to issue executable instructions. A compromised model response could attempt to authorize operations.

**Mitigation designed:** Model output never reaches an execution path. All operations use a fixed catalog with validated inputs. Server output is treated as untrusted text. The permission boundary holds independently of prompt-injection detection. Adversarial fixtures in `tests/fixtures/` test this explicitly (T-008).

**Trigger to escalate:** Any test shows server data influencing operation selection or authorization.

---

## R-005 — Product becomes a chat wrapper (no durable value over existing tools)

| Field | Value |
|---|---|
| **Likelihood** | Medium |
| **Impact** | High (commercial) |
| **Status** | Open |
| **Source** | PRD §15 |

If ServrSit only generates SSH commands that the user then runs manually, it offers no advantage over the founder's current SSH + coding-assistant workflow.

**Response:** The differentiating features are durable schedules (run with laptop closed), fleet context, explicit approvals, verified outcomes, and permanent history. These must be working and demonstrably saving time by Stage A exit. PRD §12 defines the measurement: at least 50% reduction in active administrative time for supported recurring tasks.

**Trigger to escalate:** Stage A use shows no measurable time reduction, or Spotty still opens a terminal for every maintenance task.

---

## R-006 — Scope creep into general administration

| Field | Value |
|---|---|
| **Likelihood** | Medium |
| **Impact** | Medium |
| **Status** | Open |
| **Source** | PRD §15 |

Pressure to add "just one more" operation (firewall rules, user management, file cleanup, OS upgrades) adds failure modes and support cost faster than it adds value.

**Response:** Every new supported operation requires: evidence of repeated user demand, a defined verification/recovery contract, and a PRD change. Agents do not add supported operations based on technical convenience. Orchestrator enforces this boundary.

**Trigger to escalate:** Any agent proposes an operation not in the Technical Spec §8 catalog without a PRD reference.

---

## R-007 — Cross-customer access in pilot through shared infrastructure

| Field | Value |
|---|---|
| **Likelihood** | Low (by architecture) |
| **Impact** | Blocker |
| **Status** | Open |
| **Source** | Technical Spec §4.4; PRD §14 "Cross-customer access" scenario |

A shared Cognito pool, shared S3, or permissive IAM could allow one pilot owner to access another's fleet data, credentials, or private-network routes.

**Mitigation designed:** Separate EC2 + DB + IAM role + signing key + secrets namespace per owner. Installation validates its configured subject allowlist — an authenticated user from another installation is still unauthorized. T-015/T-016 must document the isolation boundary. Real negative IAM tests required before Stage B (PRD §14).

**Trigger to escalate:** Any IAM test shows cross-installation read/write access.

---

## R-008 — Bedrock model unavailable in selected region or data retention unconfigured

| Field | Value |
|---|---|
| **Likelihood** | Medium |
| **Impact** | Medium |
| **Status** | Open |
| **Source** | Technical Spec §15, §22; PRD §11.4 |

The desired Bedrock model may not be available in ap-southeast-1. Cross-region processing may occur without explicit opt-out, violating the stated data policy.

**Response:** T-015 must check Bedrock model availability by region. Before any customer inference, verify model/region, retention settings, invocation logging, and cross-region processing. Document the resulting policy. No inference on customer data until this is confirmed and disclosed.

**Trigger to escalate:** No suitable Bedrock model available in the evaluated region, or retention settings cannot be configured to match the stated product policy.

---

## R-009 — Controller as single point of failure

| Field | Value |
|---|---|
| **Likelihood** | Medium |
| **Impact** | Medium |
| **Status** | Open (accepted for Stage A) |
| **Source** | Technical Spec §4.3; PRD §10 |

Single-host deployment has no HA. Controller failure stops new checks and decisions.

**Mitigation designed:** Already-accepted remote work may continue. Recovery uses infrastructure definitions + off-instance backups + secrets + remote ledgers. RPO: 24 hours. RTO: 4 hours (Stage B gate). Existing applications on managed servers are not affected by controller downtime.

**Trigger to escalate:** Recovery test at T-015/M4 shows actual RTO >4 hours or non-operational history loss >24 hours.

---

## R-010 — Founder fit mistaken for market fit

| Field | Value |
|---|---|
| **Likelihood** | Medium |
| **Impact** | Medium (commercial) |
| **Status** | Open |
| **Source** | PRD §15, §13.4 |

Spotty's enthusiasm and personal need does not establish that 5–10 independent owners will pay US$29/month for the same product.

**Response:** Stage B requires at least 5 external owners who complete an independent trial. Stage C requires at least 3 of 5 qualified external owners to accept a real paid-pilot offer (actual commitment or payment, not encouragement). Personal tool outcome is legitimate. Do not expand scope to manufacture demand.

**Trigger to escalate:** Stage B shows <3 of 5 external users successfully onboard independently.
