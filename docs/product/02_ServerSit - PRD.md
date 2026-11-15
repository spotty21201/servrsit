# ServrSit — Product Requirements Document

**Your servers have a sitter.**  
**Less babysitting. More building.**

| Document control | Detail |
| --- | --- |
| File | `02_ServerSit - PRD.md` |
| Version | 0.1 — founder review draft |
| Date | 15 November 2026 |
| Product owner | Spotty |
| Source of intent | `01_ServerSit - Founders Vision and Manifesto.md` |
| Development direction | Kiro; Amazon technologies preferred; AWS hosting under evaluation |
| Decision status | Proposed product decisions, subject to founder review; not approved for implementation |
| Next documents | `03_ServerSit - UX Spec.md`, then `04_ServerSit - Technical Spec.md` |

> **Product promise:** Know which servers need attention, understand why, and complete supported maintenance with a clear record of what changed—without becoming a server administrator.

## 1. Executive product decision

Build ServrSit as a cloud-accessible caretaker for people responsible for a small collection of Linux servers. The first user is a founder who creates applications and directs AI agents but wants infrastructure administration to consume less of his attention.

The first release should serve approximately **2–20 servers**, beginning with the founder's real environment. It should combine a concise view of the fleet, ordinary-language requests, and explicit action controls. Its core operating loop is:

**Inspect → explain → propose → approve → execute → verify.**

AI interprets intent and explains evidence. A constrained, predictable execution system performs supported operations. The model does not receive unrestricted authority to administer machines.

The product must work while the owner's laptop is closed. Its management environment must remain independent of Sentani, Nabire, Timika, and any other managed server. Existing servers may remain at home, in a studio, or with another hosting provider.

**Recommendation:** Prove personal usefulness before building a broad subscription business. Ship a private founder alpha, then a small invited pilot. Introduce paid access only after reliable operation, acceptable onboarding effort, and willingness to pay have been demonstrated. A successful personal tool remains a valid outcome.

### 1.1 What this PRD decides

This document defines the user, problem, product boundaries, required outcomes, acceptance criteria, release gates, and commercial hypotheses. It deliberately leaves screens, component layouts, database schemas, AWS service selection, and implementation recipes to the later specifications.

The manifesto uses **ServrSit** as the product name. This document preserves that spelling while using the requested **ServerSit** filename convention. Final public naming remains a founder decision.

## 2. Problem and opportunity

### 2.1 The user's actual problem

Owning several servers creates recurring work: remembering their roles, checking their condition, interpreting updates, maintaining conventions, handling failures, and preparing new machines. This work fragments attention even when the individual commands are straightforward.

The important costs are:

- **Attention:** Switching between terminals and reconstructing context.
- **Uncertainty:** Not knowing whether a machine needs intervention or whether an operation actually succeeded.
- **Inconsistency:** Accidental differences in directories, packages, and routines.
- **Dependence:** Work stopping when the owner's laptop or current chat session is unavailable.
- **Operational exposure:** Applying plausible commands without understanding their effects on running services.

The buyer is purchasing reduced administrative burden and greater confidence. A chat interface alone does not deliver either outcome.

### 2.2 Product hypothesis

If an owner can obtain a trustworthy fleet summary, review a short maintenance proposal, and see a verified result in one place, they will spend less time administering infrastructure and will return to ServrSit regularly.

The strongest initial differentiation is the complete, understandable maintenance experience for a small mixed fleet. It is not exclusive access to Linux commands, SSH, or language models.

### 2.3 Competitive context and implications

This is a focused comparison of official product documentation, not a comprehensive market study or evidence of customer demand. Sources are listed in Section 19.

| Alternative | Established capability | Implication for ServrSit |
| --- | --- | --- |
| SSH plus a coding assistant | The founder already uses this workflow to inspect and change machines. | ServrSit must save context switching and provide durable schedules, permissions, and verification. Merely generating commands is insufficient. |
| Cockpit | Provides a browser interface for server administration and requires installation of its server components. [S2] | A friendly server UI is not unique. Test whether ServrSit's fleet explanations and guided work are substantially easier for this audience. |
| Semaphore UI | Organizes automation around repositories, inventories, credentials, templates, task logs, and schedules. [S3] | Reuse proven automation ideas where helpful. Avoid making the target user learn that configuration model for routine care. |
| AWS Systems Manager | Manages EC2 and hybrid machines; hybrid activation uses SSM Agent on the managed nodes. [S4] | A credible alternative if the product later embraces installed management agents. It is not a transparent substitute for the manifesto's SSH-first approach. |

**Strategic judgment:** The concept is feasible, but its commercial differentiation is unproven. The difficult work will be trust, private-network onboarding, recovery from interrupted operations, and support—not the conversational interface. These must be tested early.

## 3. Target users and jobs

### 3.1 Primary user

An independent founder, designer-builder, or small studio owner with a handful of Ubuntu servers and no dedicated infrastructure team. They can establish SSH access, sometimes with help, but do not want to memorize commands or maintain automation files.

The initial target has:

- Two to twenty personally controlled servers.
- A mixture of development, personal, and public-facing workloads.
- Existing SSH access and authority to administer each connected machine.
- A willingness to approve impactful work and retain an independent recovery route.

### 3.2 Secondary and excluded audiences

Technical solo developers and homelab owners are useful secondary users. Their feedback should improve reliability without turning the product into an expert administration console.

Enterprise operations teams, managed service providers administering many customers, Kubernetes operators, and regulated deployments are outside the first release's target. A person who cannot establish any remote access may need onboarding assistance; ServrSit does not install the operating system or repair a physically disconnected machine.

### 3.3 Jobs to be done

| ID | User intent | Successful outcome |
| --- | --- | --- |
| JT-01 | “How's everyone doing?” | Understand what needs attention, how recently it was checked, and what remains unknown. |
| JT-02 | “Take care of Nabire's updates.” | Review the actual scope and disruption risk, approve it, and receive a verified result. |
| JT-03 | “Why does Sentani need attention?” | See evidence, a plain-language explanation, and a supported next action or honest limitation. |
| JT-04 | “Set this new server up like Nabire.” | Apply selected, compatible conventions without copying secrets, workloads, or machine identity. |
| JT-05 | “Are my servers organized consistently?” | Separate intentional role differences from deviations from an owner-approved baseline. |
| JT-06 | “Keep an eye on things while I'm away.” | Checks continue without an open browser; findings are retained and, in the pilot, delivered through alerts. |
| JT-07 | “What did you change?” | Recover the proposal, approval, execution evidence, and verification for each operation. |

## 4. Product principles and deliberate challenges

1. **Evidence before reassurance.** “Healthy” applies only to the checks performed. Unreachable or stale information must not become “everything is fine.”
2. **Simplicity is measured in user effort.** A visually sparse screen that forces repeated questions is not simple.
3. **AI should remove interpretation work.** Routine collection, thresholds, scheduling, permissions, and execution rules do not need continuous model reasoning.
4. **Approval must be meaningful.** Users approve a named target, scope, and expected impact, rather than a vague “let AI fix it.”
5. **Different roles justify different configurations.** Consistency is measured against intent, not against identical machines.
6. **Operations outlive conversations.** Closing a browser, losing a chat, or switching devices must not erase task state.
7. **The user can leave.** Export operational records, disconnect access, and retain independent SSH administration.
8. **Personality serves clarity.** Light humor belongs in routine success states. Failures, downtime, and security warnings use direct language.

The following constraints intentionally narrow the manifesto's longer-term ambition:

| Vision idea | First-release interpretation | Reason |
| --- | --- | --- |
| Translate intentions into Linux commands | Select from reviewed operations with validated inputs. | Arbitrary generated shell commands create an unbounded support and safety problem. |
| Prepare a server like another | Compare and apply a small approved baseline. | A reference server may contain obsolete packages, private data, and accidental configuration. |
| Lightweight terminal | An expandable execution transcript. | A full writable terminal is a separate administration product and bypasses the guided experience. |
| Handle ordinary problems automatically | Run inspections automatically; require approval for supported changes. | Prove execution and recovery before granting unattended change authority. |
| Work across home and cloud machines | SSH over a verified network path, with private connectivity validated early. | A cloud service cannot reach a private address simply because the address is entered into a form. |

## 5. Release boundaries

### 5.1 Release stages

| Stage | Purpose | Included outcome | Exit requirement |
| --- | --- | --- | --- |
| Feasibility checkpoint | Prove the riskiest assumptions before polishing the UI. | Independent cloud environment reaches the founder's private and public machines; credential revocation and interrupted-job handling demonstrated in a disposable environment. | Technical approach is workable and estimated operating cost is acceptable to the founder. |
| A — Founder alpha | Replace the founder's recurring manual workflow. | Connect, inspect, explain, compare, update, explicitly restart/reboot, prepare basic directories/packages, scheduled checks, in-app findings, history/export. | All A requirements pass; founder uses it on real servers for four weeks. |
| B — Invited pilot | Test repeatability and commercial potential. | Five to ten independent owners; isolated customer access; email alerts; recovery/account controls; measured onboarding, support, and costs. | All B requirements and commercial validation gates pass. |
| C — Paid release | Sell a bounded, supportable service. | Published scope and limits, subscription entitlement, billing/cancellation, customer support and incident process. | Charging is explicitly justified by pilot evidence; operational and security review completed. |

These are evidence gates, not calendar promises. Stage A is the smallest credible product release; the feasibility checkpoint is not a usable product.

### 5.2 Support contract for Stage A

| Dimension | Initial commitment |
| --- | --- |
| Operating system | Ubuntu Server 24.04 LTS, x86-64. Detect the actual version at connection time. Expand only after testing additional platforms. |
| Fleet size | Design and test for up to 20 servers per owner; founder validation starts with the three named in the manifesto. |
| Ownership | One owner and one workspace. Pilot adds multiple isolated owner workspaces, not collaborative administration. |
| Network | Standard OpenSSH over a reachable public or private route. Tailscale is the initial private-network validation target. |
| Authentication | Dedicated SSH keys and verified host identity; read-only operation remains available when elevated permissions are unavailable. |
| Application surface | Responsive web application; full desktop workflow and usable mobile status, approval, and history. English first. |
| Background operation | Scheduled checks independent of the user's laptop and browser. No scheduled changes in Stage A. |
| Managed-node installation | No persistent ServrSit agent required. Explicitly approved temporary execution artifacts or narrowly scoped privilege configuration may be necessary; disclose and track them. |
| Maintenance | Supported Ubuntu package updates and explicit service restart/reboot; no release upgrades or general-purpose repair. |

An unsupported OS may be recorded with its compatibility result, but must not be silently treated as supported or offered executable maintenance.

### 5.3 Explicit non-goals for Stages A–B

- Kubernetes, container orchestration, CI/CD, application deployment, or cloud resource provisioning.
- Database administration, application migrations, full backup/restore management, or disaster recovery automation.
- Unrestricted AI-generated commands or a general writable browser terminal.
- Autonomous remediation, scheduled patching, and automatic reboot decisions.
- SSH/firewall/network-policy editing, partition changes, user deletion, recursive ownership changes, or bulk file cleanup.
- Operating-system installation, major release upgrades, cross-distribution management, or fleet-wide cloning.
- Full vulnerability scanning, compliance certification, or a claim that a server is “secure.”
- Multi-operator permissions, enterprise SSO, agency customer hierarchies, public APIs, or plugin marketplaces.
- Training models on customer infrastructure, continuous AI agents, or support for every coding-agent harness.

These exclusions do not prevent diagnosis or explanation. They prevent unsupported execution and misleading product promises.

## 6. Essential user journeys

### 6.1 Connect and understand the first server

The owner signs in, names a machine, describes its role, and supplies its address and dedicated access method. ServrSit explains the access it requires, tests connectivity, verifies host identity, and performs an initial inspection. The owner sees what was learned, what could not be checked, and which permissions are missing.

**Success:** One verified machine and a useful first summary, without requiring the owner to write a configuration file. Access setup outside the app is measured separately rather than hidden from onboarding metrics.

### 6.2 Return after several days away

The owner opens the fleet view and asks “How's everyone?” ServrSit reports the latest observations, their age, and changes since the previous visit. A disconnected server remains visibly unknown. The owner can refresh one machine or the whole fleet.

**Success:** Within a minute, the owner understands which action, if any, is worth their attention.

### 6.3 Perform maintenance

The owner chooses pending updates or asks to update a named machine. ServrSit refreshes the relevant evidence, presents a plan with package scope and interruption risk, and requests approval. After execution it verifies package state and the selected important services. A reboot requirement is reported separately and needs its own approval.

**Success:** The owner can distinguish “updates installed,” “restart still needed,” and “verification incomplete.” No success claim depends solely on a command returning exit code zero.

### 6.4 Prepare a new server

The owner selects a reference development server. ServrSit discovers a limited set of candidate conventions, asks which ones should become the baseline, compares the target, and proposes compatible changes. It creates missing approved directories and installs approved supported packages. Existing contents and conflicts remain untouched.

**Success:** The new machine follows the chosen conventions; it does not inherit private files, identities, applications, or unexplained settings.

### 6.5 Understand a failure

A check or operation fails. ServrSit reports whether it could reach the machine, whether it had permission, what it attempted, and what evidence it received. It distinguishes observed facts from possible causes and offers a supported next step. If the outcome cannot be established, it says so.

**Success:** The owner can recover or hand the record to a technical helper without reconstructing the conversation.

## 7. Functional requirements

**Priority convention:** A = required for founder alpha; B = additional requirement before invited pilot; C = additional requirement before paid release. Requirements accumulate across stages. Acceptance criteria describe observable product behavior, not the eventual implementation.

### 7.1 Identity, connection, and fleet context

#### FR-01 — Owner access and workspace boundary [A; expanded in B]

The product shall protect access to server information and administrative actions with authenticated owner access. MFA shall be required before enabling write-capable server access. Recovery must not become an easier route around those protections.

**Acceptance:** An unauthenticated request cannot read fleet data or run work. A signed-out session cannot approve an operation. Before B, an owner from one workspace cannot view, infer, use, or modify another workspace's server, credential, network route, conversation, or job, including through direct requests outside the UI.

#### FR-02 — Register and identify servers [A]

The owner shall add, rename, describe, and disconnect a server. Required context is a display name, address, SSH port, access identity, purpose, and production/non-production classification. Production status must be explicitly confirmed; an unset status uses production-level precautions.

**Acceptance:** Two display names cannot accidentally bypass the same-server operation lock. Duplicate or uncertain identity is flagged for resolution. Connection tests distinguish route failure, authentication failure, host-key mismatch, and insufficient privileges when evidence permits. A changed host key blocks access until separately reverified.

#### FR-03 — Access setup and revocation [A]

The owner shall receive understandable setup guidance for a dedicated credential and the minimum supported permissions. Credentials must use a protected setup surface, never ordinary chat. Broad administrator access must not be presented as harmless read-only access.

**Acceptance:** A connection without elevated privilege can still provide supported inspection. On disconnect, new jobs and schedules stop, queued operations are cancelled, and stored access is disabled. The product explains how to revoke the remote key and reports any already-running action that may continue. Reconnection requires valid access and host verification.

#### FR-04 — Roles, important services, and preferences [A]

The owner shall identify important systemd services, server roles, directory conventions, and intentional exceptions. Discovery may suggest services; it must not treat every stopped service as a fault.

**Acceptance:** A service becomes a health expectation only after selection or approval as part of a baseline. Preferences are visible and editable. A conversation-derived preference cannot silently become authorization for future changes.

### 7.2 Inspection and explanation

#### FR-05 — Supported inspection [A]

ServrSit shall collect OS and architecture, uptime, CPU/load, memory, disk and inode utilization, SSH reachability, selected service status, pending package information, reboot-required evidence, and supported basic security observations. Security observations may include available update information and readable SSH/firewall configuration; their coverage must be stated.

**Acceptance:** Every result has a server identity, observation time, and success/partial/failure state. Missing permissions and unavailable tools appear as gaps. Package information shows its last refresh time. Refreshing package metadata is identified as a bounded system write, covered by a disclosed setup permission or a separate approval; it is not mislabeled as purely read-only.

#### FR-06 — Fleet summary with honest freshness [A]

The product shall provide a brief fleet assessment and prioritized exceptions. The default view answers what needs attention before presenting charts or raw metrics.

**Acceptance:** A machine with expired observations cannot appear currently healthy. Health observations expire after two configured health-check intervals; deeper inventory has its own displayed age and expires after two configured inventory intervals. A failed current check immediately shows the failure alongside the last successful result. The owner can see last successful check and next scheduled check. A failed SSH connection is described as “unreachable from ServrSit,” not proof that the server or its applications are down. Host health does not imply application correctness.

#### FR-07 — Grounded conversational requests [A]

The owner shall be able to ask about the fleet and request supported work in ordinary English. Equivalent chat and click actions shall use the same permission and execution rules.

**Acceptance:** An ambiguous target is clarified before a change proposal. “Take care of it” is not accepted as approval of an unspecified operation. Statements about current state link to a recent observation or explicitly say a new check is required. Diagnoses distinguish facts, likely causes, and unknowns. Unsupported requests are explained without executing substitute commands.

#### FR-08 — Deterministic fallback [A]

Inspection, findings, supported action controls, approvals, and job history shall remain usable when AI is unavailable, slow, or over its usage allowance.

**Acceptance:** With inference disabled, the owner can inspect a machine and complete a supported maintenance flow using structured explanations. The product does not invent a natural-language result or mark a task failed solely because its AI summary failed.

#### FR-09 — Baseline comparison [A]

The owner shall compare selected machines against explicit role baselines and view ordinary differences separately from deviations.

**Acceptance:** The comparison covers approved directory paths/ownership expectations and selected package versions or presence. Each difference is shown as expected, actionable, ignored by the owner, or unknown. No comparison automatically copies or deletes anything. Reference observations carry their age and source.

### 7.3 Proposed and approved work

#### FR-10 — Reviewable action plan [A]

Every maintenance or setup change shall have a durable plan before execution. The plan shall identify targets, supported operations, expected effects, service interruption/reboot risk, privileges, preconditions, verification checks, and recovery limitations. Technical details are expandable.

**Acceptance:** The owner can inspect and decline a plan without changing a machine. A plan identifies what will remain unverified. “Safe” or “no downtime” is never asserted merely because the model expects a routine update. Approval controls show the exact target and scope.

#### FR-11 — Bound and expiring approval [A]

Approval shall bind to one plan version, its targets, and its permitted scope. It shall not authorize future unrelated work. Default expiry is 15 minutes for an unstarted plan; preconditions must also be rechecked immediately before execution.

**Acceptance:** A changed target, package transaction, dependency scope, privilege requirement, or material risk invalidates approval and requires a revised plan. Repeated clicks cannot start duplicate work. Natural-language assent alone cannot bypass the authenticated approval control.

#### FR-12 — Package maintenance [A]

ServrSit shall preview and apply supported updates from the machine's existing approved Ubuntu repositories. It shall respect holds and dependency constraints and expose packages that cannot be updated within the supported scope.

**Acceptance:** The plan includes dependency additions and removals, if any; any removal is blocked in A. No repository is added, hold overridden, package downgraded, or OS release upgraded. Lock contention, insufficient storage, broken package state, or an unexpected interactive configuration prompt stops or blocks work with an explanation. Verification reports installed state, remaining updates, selected service results, and reboot evidence separately.

Package installation can itself run maintainer scripts and restart services. A restart-free preview cannot guarantee uninterrupted applications. The product must disclose this and enforce its production preconditions; it must not describe package updates as inherently reversible. [S6]

#### FR-13 — Explicit service restart and reboot [A]

The product shall support a separately approved restart of a selected supported service, and a separately approved reboot of one server. These are never implied by an update approval.

**Acceptance:** The owner sees likely interruption and the relevant recovery route. A production operation requires confirmation that an appropriate recovery path exists. After reboot, ServrSit checks return of SSH, changed boot evidence, and selected important services. Failure to return within the declared verification window produces an unresolved result, not a claim that the reboot succeeded completely.

#### FR-14 — Controlled fleet execution [A]

One request may cover several named machines, but changes shall run one machine at a time in the first release. A production server requires an explicit per-server approval. Read-only inspections may run concurrently within resource limits.

**Acceptance:** The batch view preserves each machine's outcome. A failure or unknown outcome pauses remaining changes. The owner must review before continuing. Two different requests cannot change the same machine simultaneously, and external package-manager activity is respected.

#### FR-15 — Basic server preparation [A]

The owner shall prepare a supported server using an approved baseline of directory conventions and supported Ubuntu packages. The reference machine is evidence for a proposed baseline, not a source for an unrestricted clone.

**Acceptance:** The proposal excludes credentials, SSH host keys, application data, databases, personal files, and machine-specific network settings. It checks compatibility and existing contents. Existing directories with conflicting ownership or content are flagged without recursive alteration. Repeating a completed plan produces no unnecessary changes. Each requested convention is verified independently.

Agent harness installation, new-user creation, and security configuration changes remain later candidates. The first baseline should prove the pattern before expanding its scope.

### 7.4 Durable operations and recovery

#### FR-16 — Visible operation lifecycle [A]

The product shall distinguish proposed, awaiting approval, queued, running, verifying, succeeded, partially succeeded, failed, cancelled-before-start, and outcome-unknown states. A stop request during execution must be shown as a request to stop at a safe boundary, not as an immediate reversal.

**Acceptance:** Refreshing the browser or signing in from another device shows the same operation and evidence. A successful command followed by failed verification cannot be shown as fully verified success. The record shows changed, unchanged, skipped, and unresolved steps.

#### FR-17 — Interruption and retry safety [A]

ServrSit shall reconcile real machine state before retrying after a network loss or executor restart. It must not assume that a disconnected command stopped.

**Acceptance:** Simulated disconnects during package work do not trigger a second concurrent transaction. If the original result cannot be established, the operation remains outcome-unknown and further conflicting writes are blocked pending reconciliation. Cancelling a batch prevents unstarted work without force-killing an active package transaction. Recovery guidance does not promise automatic rollback.

#### FR-18 — Evidence, history, and export [A]

Each operation shall retain the requested intent, plan version, approving identity and time, target identity, action/transcript evidence, timestamps, results, and verification. The owner shall export a readable maintenance report and machine-readable inventory/history without secrets.

**Acceptance:** The record remains understandable without the original chat. Failed and cancelled operations are included. Sensitive command output is redacted before storage and model use. User-visible audit entries cannot be edited into a different outcome; retention and account deletion remain explicit policies.

### 7.5 Continuing care

#### FR-19 — Scheduled checks [A]

The product shall offer a simple check interval, timezone, pause control, and next-run display. Default lightweight health checks run every 15 minutes; deeper inventory and update checks run daily, subject to disclosed metadata-refresh permission.

**Acceptance:** Checks run with the browser and laptop closed. Overlapping runs coalesce instead of accumulating. Missed runs are identified; recovery performs a current check rather than replaying a backlog. No schedule authorizes package installation, restart, reboot, or cleanup in A–B.

#### FR-20 — Findings and restrained notifications [A inbox; B email]

Findings shall distinguish needs-attention, informational, and unknown coverage states. Repeated detections of one unresolved issue shall update the same finding. The owner can acknowledge or snooze a finding; acknowledgement is not resolution.

**Acceptance:** Stage A retains findings in-app and clearly states that external alerts are unavailable. Before B, verified email alerts support opt-in, quiet hours, a digest, delivery failure visibility, and a recovery notice. Critical interruption rules are explicit. No sensitive logs or approval-by-email links are required to understand an alert.

Initial threshold defaults for testing: disk/inode warning at 85% and critical at 95%, sustained across two successful health checks; unreachable finding after two consecutive failed scheduled checks. CPU and memory spikes are advisory until sustained across three samples. Display actual observations and allow simple threshold adjustments. These are proposed product defaults, not universal infrastructure standards.

### 7.6 Ownership, privacy, and commercial readiness

#### FR-21 — Data and AI controls [A; self-service completion in B]

The owner shall know what infrastructure metadata is collected, what is sent for AI explanation, where the service processes it, and how long it is retained. Collection excludes arbitrary home-directory, repository, database, and application-file contents.

**Acceptance:** Secrets never enter prompts. The owner can disable AI processing and still use core structured workflows. Proposed retention is 30 days for observations/chat and 90 days for operation records; longer storage needs an explicit product decision. Before B, self-service export, disconnect, and account deletion are implemented; active data deletion completes within 30 days and backup expiry within a further 30 days, with any exceptions disclosed before collection.

#### FR-22 — Pilot isolation and recovery [B]

Customer workspaces, execution access, and private-network identities shall be isolated. Operator/support access must be limited, recorded, and disclosed. Account recovery, credential rotation, and revocation shall be exercised before inviting external owners.

**Acceptance:** Cross-workspace access attempts fail at the service boundary, not just in navigation. A compromised or revoked workspace credential cannot access another customer. Disconnect and deletion remove future execution ability. A founder-only prototype cannot be relabeled as a safe shared service without passing these checks.

#### FR-23 — Commercial entitlements [C]

If paid access is introduced, the owner shall see price, included server count, AI allowance, renewal terms, and cancellation consequences before subscribing. Usage limits must not interrupt an already-authorized operation or hide its outcome.

**Acceptance:** Billing success/failure, duplicate billing events, downgrade, cancellation, and expired access are tested. A downgrade does not disconnect servers or delete history without notice and a recovery/export period. No surprise AI overage charge is permitted. Core records and access revocation remain available during billing problems.

## 8. Authority and safety policy

Safety is part of the experience, not a disclaimer appended to a powerful shell. User approval does not replace bounded execution or technical validation.

| Action | Default authority | Product behavior |
| --- | --- | --- |
| Supported status checks and comparisons | Allowed after connection consent | Respect collection scope and resource limits; record freshness. |
| Package metadata refresh | Narrow opt-in during setup or explicit approval | Explain the bounded write; do not imply permission to install updates. |
| Supported package changes and new baseline directories | Per-plan approval | Validate inputs, preconditions, exact scope, and verification. |
| Production package changes | Per-server approval plus impact/recovery review | Stop if risk or recovery prerequisites cannot be established sufficiently. |
| Selected service restart or server reboot | Separate explicit approval | Show interruption, recovery route, and post-action verification. |
| Unknown commands, arbitrary scripts, destructive or unsupported changes | Not executable in A–B | Explain limitation and provide evidence for external assistance. |

Additional invariants:

- Treat server names, logs, filenames, package descriptions, and command output as untrusted data. Instructions embedded in them cannot change policy or cause execution.
- Never accept a model's statement that an action is approved, completed, or safe as the authoritative record.
- Privileged access is powerful even when the UI is simple. Package installation may execute privileged scripts; a narrow UI does not eliminate that underlying risk.
- Production update plans must identify important services and confirm the owner has a suitable backup/recovery approach. An owner confirmation is labeled as such, never “backup verified.” ServrSit does not create or test workload backups in this release.
- If current state, approval scope, or audit recording cannot be established, stop new changes and explain why.
- Emergency disconnect prevents future work; it cannot guarantee reversal of a command already accepted by a remote machine.

## 9. Experience requirements for the later UX specification

The UX should make three things obvious: **what needs attention, what ServrSit proposes, and what actually happened.**

The default experience should combine a visual fleet overview, contextual conversation, and structured action/result cards. Chat is an optional entry path, not the only way to operate. Common work must be possible without knowing what to ask.

Required experience qualities:

- Begin with a short assessment and exceptions; reveal metrics and transcripts on demand.
- Keep the target server and production status visible during proposals and execution.
- Use the same language and state model across conversation, fleet cards, alerts, and history.
- Preserve context across devices and interruptions. A mobile approval must be as specific as a desktop approval.
- Use text and icons alongside color; support keyboard navigation, visible focus, screen readers, adequate contrast, and reduced motion. Target WCAG 2.2 AA; the UX specification must define the testable implementation criteria.
- Avoid aggregate “health scores” that hide missing observations or the severity of one critical finding.
- Keep normal success concise. Keep failures factual and helpful. Never joke about data loss, compromised access, or unresolved production downtime.

Illustrative copy, not final UI design:

> “Two servers checked. Timika could not be reached. Its last successful check was 42 minutes ago.”

> “Nabire's updates are installed. A reboot is still required. Your selected services are running.”

> “The connection dropped during the update. I haven't confirmed the outcome. I'm checking before attempting anything else.”

The later UX specification should challenge the proposed interaction model through task testing rather than treating these examples as fixed screens.

## 10. Non-functional requirements and service boundaries

The following are proposed acceptance targets. Measure them in representative conditions and revise openly if feasibility testing shows they are inappropriate.

| Area | Target and boundary |
| --- | --- |
| Perceived speed | Previously collected fleet overview visible within 2 seconds at the 95th percentile on a typical broadband connection; freshness remains visible. |
| Live inspection | At least 95% of lightweight single-server checks complete within 30 seconds on a responsive supported host with network round-trip latency up to 350 ms. Show progress or a bounded failure rather than an indefinite spinner. |
| Scheduling | At least 99% of scheduled checks start within 2 minutes of their intended time while ServrSit's scheduling/execution service is available; report end-to-end misses separately. |
| Private pilot availability | Target 99.5% monthly availability for sign-in, fleet/history viewing, and job submission. Report planned maintenance and outages separately. This is an internal target, not a contractual SLA. |
| Operational integrity | No duplicate conflicting changes; no execution without valid authorization; no false verified-success result in release-gate tests. |
| Control-plane recovery | Before B, demonstrate restoration within 4 hours with at most 24 hours of non-operational history loss. Any gap affecting approval or active-job evidence blocks new writes until reconciled; old jobs must not replay after restoration. |
| Security | Encryption in transit and at rest, protected credentials, least practical privilege, enforced workspace isolation, host-key verification, and auditable access. |
| Resource impact | Checks are bounded in frequency, duration, output size, and concurrency. No unrestricted filesystem crawl or continuous log shipping. |
| Cost control | Measure infrastructure, network, AI, and support costs per active workspace. Set budgets and enforce inference limits without losing operation evidence. |
| Graceful degradation | An AI outage does not disable deterministic checks. A management outage does not stop the user's existing applications. |

ServrSit observes machines from its own network location. It does not establish how an application performs for every end user, distinguish every ISP failure, or guarantee workload uptime. It shall report the boundaries of its observations.

## 11. Amazon and Kiro product constraints

### 11.1 Development tool versus running product

Kiro is the intended development environment. It should turn approved requirements into implementation work; it is not assumed to be the always-on execution engine for customer servers.

Kiro's documented specification workflow separates requirements, design, and tasks. This PRD should inform feature-level requirements; the later UX and Technical Specs should inform design; only then should implementation tasks be generated. Preserve this document's requirement IDs in that translation. [S1]

### 11.2 AWS direction

Prefer Amazon technologies for the running service where they meet the product needs at acceptable cost. AWS hosting and Amazon Bedrock inference are candidates, not finalized architecture decisions. End users should not need an AWS account to use a future hosted subscription.

The Technical Spec must prove that the chosen execution environment supports durable SSH operations, scheduled checks, secure credentials, private routes, and recovery within the cost envelope. “Serverless” is not a product requirement, and an unnecessarily elaborate managed-service stack is not a goal.

Use one deployment region initially unless a demonstrated requirement justifies more. Compare candidate regions using measured founder experience, network reachability, model/service availability, and cost. Do not infer server performance from geography alone.

### 11.3 Private access is a feasibility gate

Tailscale can provide controlled access between machines in a private network, including servers provisioned with scoped identities and tags. That supports the founder's existing approach but still requires explicit network authorization and lifecycle management. [S5]

Stage A must demonstrate AWS-to-founder-tailnet access without relying on the founder's laptop or making a managed server the permanent coordinator. Before B, prove that each customer's route and credentials remain isolated. Do not solve commercial onboarding by putting all customers in an unrestricted shared network.

Tailscale is an intentional compatibility dependency outside Amazon, not a requirement to replace the customer's network. If the founder later requires exclusively Amazon components, the replacement must preserve private access and acceptable setup effort; that would be a scope decision.

### 11.4 AI data handling

The chosen inference configuration must satisfy the product's stated data policy. AWS documentation makes clear that customers retain responsibility for configuring protection of their content. Do not assume that selecting a managed AI service alone settles privacy. [S7]

Before external pilots, verify the actual model, region, retention settings, logging, and any cross-region processing, and disclose the resulting policy. No model name or provider-specific retention promise is fixed by this PRD.

## 12. Measurement and validation

### 12.1 Primary outcome

**Reduce the owner's active administrative time for supported recurring tasks, while maintaining truthful state and controlled execution.**

Measure the founder's current workflow for two weeks or at least five representative maintenance sessions. Compare equivalent tasks during a four-week alpha. Exclude unattended command runtime from active effort, but include approval reading, troubleshooting, and recovery time. Track onboarding separately.

### 12.2 Proposed success measures

| Measure | Initial target | How to assess |
| --- | --- | --- |
| Active administrative time | At least 50% lower than baseline for supported recurring work. | Owner session diary plus task timestamps; compare like-for-like tasks. |
| First useful inspection | Median under 10 minutes after valid network access and credentials are available. | Timed onboarding; also report total elapsed setup time. |
| Pilot onboarding independence | At least 4 of 5 tested target users connect a supported server without live developer intervention. | Observe setup with help documentation available; record every failure. |
| State comprehension | At least 4 of 5 participants correctly identify affected server, freshness, risk, and next step in each core scenario. | Task-based usability testing, including stale and partial results. |
| Supported maintenance completion | At least 90% reach verified completion without external terminal intervention in alpha; all exceptions are explained honestly. | Eligible operations are defined before measurement; blocked and failed attempts are also reported. |
| Trust | Zero unapproved writes, exposed credentials, or false verified-success results. | Release tests, audit review, and incident monitoring. Any occurrence blocks expansion. |
| Continuing care | Missed checks and alert delivery failures are visible; repeated findings do not cause repeated notifications every interval. | Failure simulation and four-week pilot review. |
| Repeat use | At least 60% of invited pilot owners use it in three of four weeks. | Meaningful inspections, reviews, or maintenance, not page views. |
| Willingness to pay | At least 3 of 5 qualified external owners accept a real paid-pilot offer after using it. | Actual commitments or payments; exclude founder/friends expressing only encouragement. |

Small samples are directional evidence, not market proof. Report counts alongside percentages and investigate failures rather than hiding them in an average.

## 13. Commercial strategy without premature commitment

### 13.1 Initial positioning

**“A server caretaker for founders and small teams who need their machines working while they work on something else.”**

Start with people whose infrastructure resembles the founder's: a few Ubuntu machines, real applications, limited appetite for administration. Recruit through personal builder and studio networks before broad advertising.

The purchase case should emphasize less manual checking, understandable maintenance, and a reliable history. Avoid claims of replacing an infrastructure engineer, preventing all incidents, or providing round-the-clock human support.

### 13.2 Pricing hypothesis to test

A workspace subscription with an included server allowance is the recommended starting hypothesis. Charging per command or per chat message may discourage the behavior that creates value.

**Illustrative offer for testing only:** US$29 per month for one owner and up to five servers, with a clearly stated AI allowance and no surprise overages. This is not a researched market price, an approved price, or a margin claim. Test the value of the actual working product before defining tiers. Manual paid-pilot invoicing can precede a billing integration.

Do not create a permanent free hosted plan until its security, support, and operating cost are understood. A time-limited guided trial is a simpler candidate. Assisted initial setup may be a separately priced service if customers value it, but recurring support must not consume the subscription's margin.

### 13.3 Economic gate

Measure monthly cost per workspace as:

**Allocated hosting + execution/network + AI + retained data + payment costs + recurring support labor.**

Separate one-time onboarding labor from recurring support. As a provisional target, direct infrastructure/AI costs should stay below 25% of subscription revenue, and recurring support should trend below 15 minutes per workspace per month after onboarding. These targets must be tested; they are not AWS cost estimates.

At the illustrative US$29 price, the direct infrastructure/AI envelope is US$7.25 per workspace per month. A dedicated private-network execution environment could make that unrealistic. If measured costs exceed the envelope, change the price, architecture, or customer segment before charging at an unsustainable rate.

### 13.4 Three legitimate outcomes

| Outcome | Evidence | Next move |
| --- | --- | --- |
| Personal tool | Strong founder benefit; weak external demand or difficult support economics. | Maintain a small private product and avoid billing overhead. |
| Small paid product | Repeat use, safe onboarding, demonstrated payment, sustainable costs. | Launch a bounded subscription with clear support scope. |
| Assisted offering | Customers value setup/support but cannot onboard independently. | Price human assistance honestly; do not label a labor-intensive service as self-service SaaS. |

Do not expand scope merely to manufacture reasons to charge. Better reliability and lower effort may be more valuable than additional features.

## 14. Release acceptance and validation scenarios

All scenarios use disposable or explicitly authorized test machines for fault injection. Real production systems are used for normal owner-approved validation, not destructive experiments.

| Scenario | Required observable result | Gate |
| --- | --- | --- |
| Connect the founder's fleet | Inspect Sentani, Nabire, and Timika with roles and permissions confirmed from actual machines; no assumed live facts. | A |
| Laptop closed | Scheduled checks continue; returning browser shows accurate results and ages. | A |
| Private network outage | Affected observations become unknown/stale; no claim of server power failure or false health. | A |
| Host-key change | Connection and execution block pending reverification. | A |
| No sudo access | Useful partial inspection; clear limits; no hidden elevation attempt. | A |
| Mixed-server update request | Explicit targets, serial changes, production approvals, and independent results. | A |
| Stale plan or changed package transaction | Old approval cannot authorize the changed transaction. | A |
| Package lock / low disk / held package | No competing operation or silent override; clear blocked or limited result. | A |
| Disconnect or executor restart mid-update | Reconcile before retry; preserve outcome-unknown if necessary; no duplicate mutation. | A |
| Service verification fails | Installed updates and service failure reported separately; no overall verified-success label. | A |
| Reboot does not return | Timeout becomes unresolved with recovery guidance; no repeated reboot attempts. | A |
| New server with existing directory contents | Show differences and conflicts; preserve content; verify only approved changes. | A |
| AI unavailable or malicious instructions in logs | Deterministic workflows continue; server data cannot authorize or generate executable work. | A |
| Double approval / concurrent requests | One operation starts; conflicting writes are prevented. | A |
| Access revoked during work | No new work starts; already-issued work is reported honestly. | A |
| Cross-customer access and tailnet routing | No data, credential, job, or network access crosses workspace boundaries. | B |
| Email fails / duplicate finding / quiet hours | Delivery state visible; deduplication and configured timing respected. | B |
| Restore the management service | Restore records, reconcile gaps and active work, and avoid replaying old approvals. | B |
| Export and delete account | Export contains no secrets; access revoked and deletion follows the disclosed policy. | B |
| Billing fails or subscription ends mid-job | Running work and outcome recording complete; no silent loss of records or access revocation controls. | C |

**Founder alpha exit:** All Stage A requirements and applicable scenarios pass, four weeks of actual use show material effort reduction, and there are no unresolved critical execution or credential defects.

**Pilot exit:** All Stage B requirements pass, at least five external owners have completed the intended trial, and onboarding, support, and cost evidence have been reviewed. An independent security review of credentials, authorization, execution isolation, and private-network access is required before a paid release; critical findings block launch.

**Paid release exit:** Stage C is complete, the founder elects to commercialize, real willingness to pay exists, costs are sustainable, and support/incident ownership is explicit. Meeting a feature checklist alone is insufficient.

## 15. Principal risks and responses

| Risk | Why it matters | Product response / decision trigger |
| --- | --- | --- |
| A simple UI hides a privileged remote administrator | One mistaken action can affect a live application. | Restrict executable operations, bind approvals, verify outcomes, and require an independent review before selling. |
| Private-network onboarding dominates the experience | The product may save maintenance effort but create a difficult setup burden. | Validate it first; measure total setup time; consider assisted onboarding or a narrower target if independence fails. |
| Users assume monitoring means uptime assurance | SSH checks cannot prove application health or diagnose every outage. | State observation coverage and vantage point; keep unknown separate from healthy. |
| Update interruption leaves uncertain state | Blind retry can worsen a partial transaction. | Durable job evidence, reconciliation, no conflicting writes, and honest unresolved status. |
| The product becomes a chat wrapper | Users can already ask an agent for commands. | Require durable schedules, fleet context, approvals, verification, and history to demonstrate saved effort. |
| Scope expands into general administration | Every supported mutation adds failure modes and support cost. | Add operations only after evidence of repeated demand and a defined verification/recovery contract. |
| AI or network costs exceed subscription value | A low-priced small fleet may be expensive to isolate and support. | Instrument costs early; limit inference; validate price before promising plans. |
| Founder fit is mistaken for market fit | Personal enthusiasm does not establish demand. | Test with independent owners and real payment decisions; preserve the personal-tool option. |
| Trust language overpromises | “Secure,” “fixed,” or “backed up” may imply unperformed checks. | Tie claims to evidence and explicit coverage; test comprehension. |

## 16. Decisions proposed for founder review

These recommendations allow the next specifications to proceed coherently once the PRD is accepted. They do not require answers before reviewing this draft.

| ID | Decision | Recommended default | When it must be settled |
| --- | --- | --- | --- |
| D-01 | Initial supported environment | Ubuntu 24.04 LTS x86-64; 2–20 servers; one owner. | PRD approval |
| D-02 | Degree of autonomy | Scheduled inspection, approved changes, no unattended remediation. | PRD approval |
| D-03 | First setup capability | Approved directory/package baseline; harness installers and user/security edits deferred. | PRD approval |
| D-04 | Product hosting | Independent cloud-accessible environment, AWS preferred; managed servers remain wherever they are. | PRD approval; implementation choice in Technical Spec |
| D-05 | Private networking | Prove existing Tailscale access early; preserve strict customer isolation. | Feasibility checkpoint |
| D-06 | Interaction model | Fleet view plus contextual conversation and structured actions; transcript instead of writable terminal. | UX specification and user testing |
| D-07 | Commercial commitment | Personal alpha first; charge only if pilot evidence supports it. | After pilot |
| D-08 | Product spelling | ServrSit in product copy; requested ServerSit spelling in document filenames. | Before public branding |

## 17. Questions the later specifications must resolve

### UX specification

- What is the smallest navigation structure that supports the full lifecycle without hiding important state?
- How do users distinguish fresh, stale, partial, unreachable, and service-specific results at a glance?
- How can approvals remain short while communicating scope and interruption risk accurately?
- How are chat requests converted into the same reviewable actions available by clicking?
- How do new users establish SSH identity, verify a host key, and understand access privileges?
- How should mobile review, failure recovery, notifications, and accessibility work?

### Technical specification

- Which minimal AWS architecture supports durable SSH work, scheduled checks, and independent operation?
- How are credentials, host trust, customer network routes, and execution privileges protected and revoked?
- How can supported operations remain bounded despite package-manager and remote-output behavior?
- How are approvals versioned, transaction scope checked, conflicting work prevented, and interrupted jobs reconciled?
- What evidence survives executor failure and management-service restoration?
- Which model and region meet privacy, quality, latency, and cost constraints?
- How are deterministic behavior, model behavior, tenant isolation, and failure scenarios verified?
- What measured costs and operational responsibilities accompany each architecture option?

The Technical Spec must flag infeasible product promises before implementation. It must not silently weaken an acceptance criterion or introduce additional product scope.

## 18. Handoff and change control

After founder approval, create the UX Spec, then the Technical Spec. Resolve contradictions between the three before generating Kiro implementation tasks. A requirement discovered to be unsafe, uneconomic, or infeasible returns to the PRD as an explicit decision.

Every implementation feature should trace to one or more `FR-*` requirements and corresponding acceptance scenarios. Separate the initial feasibility checkpoint from production-ready implementation. A connectivity demonstration does not satisfy credential protection, durable execution, or customer isolation.

The founder remains the product decision-maker. Implementation agents may propose improvements, but cannot expand supported operations, grant autonomy, change customer data policy, or launch paid access merely because those additions are technically convenient.

## 19. Source notes

The manifesto is the authoritative source for founder intent. External documentation grounds the narrow factual comparisons and platform considerations below; proposed scope, thresholds, price, targets, and commercial judgments are recommendations made in this PRD. No live inspection of the founder's servers was performed while preparing this document.

- **S0 — Founder source:** [01_ServerSit - Founders Vision and Manifesto.md](https://chatgpt.com/library?file_id=libfile_4616708d28b48191a67a93b50900a31f&account_id=personal), read in full on 15 November 2026.
- **S1 — Kiro specification workflow:** [Kiro Specs](https://kiro.dev/docs/specs/), accessed 15 November 2026.
- **S2 — Cockpit installation and browser access:** [Running Cockpit](https://cockpit-project.org/running), accessed 15 November 2026.
- **S3 — Semaphore automation concepts:** [Tasks and linked user guides](https://semaphoreui.com/docs/user-guide/tasks), accessed 15 November 2026.
- **S4 — AWS hybrid management:** [Managing nodes in hybrid and multicloud environments with Systems Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-hybrid-multicloud.html), accessed 15 November 2026.
- **S5 — Tailscale private server access:** [Setting up a server on your Tailscale network](https://tailscale.com/docs/how-to/set-up-servers), accessed 15 November 2026.
- **S6 — Ubuntu update/restart behavior:** [Automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/), accessed 15 November 2026.
- **S7 — AWS content protection responsibilities:** [Data protection — Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html), accessed 15 November 2026.

Platform features, pricing, and policies must be rechecked when writing the Technical Spec. This PRD does not select AWS services or establish a platform cost estimate.
