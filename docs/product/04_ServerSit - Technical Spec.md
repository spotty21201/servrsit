# ServrSit — Technical Specification

**Your servers have a sitter.**  
**Less babysitting. More building.**

| Document control | Detail |
| --- | --- |
| File | `04_ServerSit - Technical Spec.md` |
| Version | 0.1 — proposed implementation baseline |
| Date | 15 November 2026 |
| Product owner | Spotty |
| Product source | `02_ServerSit - PRD.md`, version 0.1 |
| Experience source | `03_ServerSit - UX Spec.md`, version 0.1 |
| Build environment | Kiro; Orchestrator, Designer, Coder, and Tester workstreams |
| Runtime direction | AWS-hosted service; existing managed servers remain in their present locations |
| Status | Design proposal. Feasibility gates must pass before live maintenance or external pilots. |

> Build a small, durable operations application. Use AI to interpret and explain; use reviewed code, explicit authorization, and machine evidence to change servers.

## 1. Engineering decisions

### 1.1 Recommended initial architecture

Use a **single-owner installation on one dedicated AWS EC2 instance**, independent of all managed servers. Run the web application, API, scheduler/worker, SSH executor, and PostgreSQL as separate local services with persistent encrypted storage. Use AWS managed services for identity, secrets, signing/encryption, off-instance records/backups, inference, and later email.

For the invited pilot, provision a separate installation for each owner using the same infrastructure definition. Each installation has its own execution/network identity, database, IAM permissions, secrets, and storage namespace. Do not put several customers' private networks or SSH credentials into one shared execution host.

This satisfies the PRD's isolated workspaces without requiring a shared multi-tenant execution platform in the first build. It is deliberately a small-pilot deployment model, not a claim that dedicated instances will support the illustrative US$29 subscription profitably.

**Commercial constraint:** Measure this architecture's actual cost. If it fails the PRD's cost envelope, adjust pricing or design and review a separate shared-service architecture before a paid release. Never silently pool private-network access to reduce costs.

### 1.2 Why this approach

- A conventional Linux host supports persistent Tailscale connectivity and long-lived SSH work directly.
- A relational database provides the operation record, scheduling state, and job queue without adding a separate queue service.
- A dedicated installation limits cross-customer exposure and keeps the first pilot understandable.
- Backup, restoration, deployment, and self-maintenance remain real responsibilities. A small architecture is not automatically an operations-free architecture.

Do not begin with Kubernetes, a microservice fleet, a continuous autonomous agent, or custom agent-to-agent infrastructure inside the product. Kiro's development agents build the application; they are not its production maintenance engine.

### 1.3 Alternatives and decision boundaries

| Option | Decision | Reason / reconsideration trigger |
| --- | --- | --- |
| One dedicated EC2 installation per owner | Selected for A and small B pilot. | Direct private networking and clear trust boundary; validate costs and recovery. |
| ECS/Fargate services and workers | Deferred. | Attractive managed execution, but network identities, task lifetimes, private egress, and isolation still need design. Fargate uses task-level networking and may require public egress or NAT/endpoints. [T4] |
| Lambda as SSH transaction executor | Not selected. | Do not couple multi-step remote maintenance to request/function lifetimes. Lambda may later serve short control operations. |
| AWS Systems Manager for managed targets | Optional future adapter. | Hybrid targets require SSM onboarding/agent installation; that changes the SSH-first contract. [T5] |
| Shared database and shared executor | Not allowed in A–B. | Requires a separately reviewed tenancy/execution design. |
| Owner's laptop or one managed server as coordinator | Rejected. | Violates independence and always-on requirements. |

## 2. Scope and support matrix

| Component | Initial support |
| --- | --- |
| Managed target | Ubuntu Server 24.04 LTS, x86-64, systemd, OpenSSH, standard APT/dpkg. |
| Server count | Up to 20 per installation. |
| Controller host | Ubuntu LTS on AWS; begin with x86-64 to reduce the first compatibility matrix. |
| Network | Standard OpenSSH over public routing or explicitly authorized Tailscale routing. |
| Management access | Key-based, pinned host identity; no SSH passwords stored by the product. |
| Inspection | Fixed collectors, bounded output, explicit missing-permission/tool states. |
| Maintenance | Approved package transactions, selected service restart, reboot, creation of approved missing directories, installation of approved Ubuntu packages. |
| Preparation | Selected baseline conventions, never full-server cloning. |
| Autonomous behavior | Scheduled inspections and explicitly consented package-metadata refresh only. |
| Unsupported | General shell execution, firewall/SSH reconfiguration, user administration, deletion/cleanup, OS release upgrades, application/database deployment and repair. |

Detect target facts rather than trusting submitted labels. Unsupported or unusual platforms may return a compatibility result but receive no executable maintenance plan.

The founder's server names and roles are context, not connection configuration. No live host addresses, keys, current OS facts, or credentials are embedded in this specification.

## 3. Software stack and repository

### 3.1 Stack

| Layer | Selection |
| --- | --- |
| Web | React with TypeScript, Vite, accessible headless primitives, CSS tokens matching the UX Spec. |
| API | Fastify with TypeScript; schema-validated HTTP endpoints; server-managed authentication sessions. |
| Worker/executor | Node.js TypeScript; OpenSSH subprocesses with fixed arguments; no model-generated shell. |
| Shared contracts | Runtime schemas plus generated TypeScript types and OpenAPI; choose one schema library consistently. |
| Database | PostgreSQL 17, current supported minor at implementation kickoff. |
| Durable jobs | pg-boss with a separate operation state machine and application-level idempotency. |
| Target-side helper | Small versioned Python 3.12 program using Ubuntu-packaged dependencies, including python3-apt for package transactions. No pip bootstrap from an unpinned internet script. |
| Runtime | Node.js 24 LTS initially; pin the current supported security patch. Record a planned upgrade before end of support. |
| Infrastructure | AWS CDK in TypeScript, producing reviewable CloudFormation changes. |
| Browser tests | Playwright; accessibility automation plus manual keyboard/screen-reader checks. |
| Unit/integration | A compatible TypeScript test runner and pytest for the target helper. |

Node.js and PostgreSQL publish support lifecycles; recheck the selected branches when initializing the repository. [T6–T7] Resolve and pin exact application/package versions in the lockfile and deployment manifest. Never use unpinned `latest` images or infer package compatibility from this document alone.

pg-boss reduces infrastructure count by storing queue state in PostgreSQL. Its delivery guarantees do **not** establish exactly-once execution of an external SSH side effect. That guarantee requires the remote operation ledger and reconciliation described below. [T8]

### 3.2 Repository structure

| Path | Responsibility |
| --- | --- |
| `docs/product/` | Canonical manifesto, PRD, UX Spec, Technical Spec. |
| `docs/decisions/` | Architecture decision records and approved requirement changes. |
| `docs/team/` | Task board, agent handoffs, decisions, risks, test evidence. |
| `.kiro/steering/` | Product, technology, structure, UX constraints, security/execution rules. |
| `.kiro/specs/` | Feature requirements, design, and tasks traced to PRD IDs. |
| `.kiro/agents/` | Agent definitions supported by the installed Kiro version. |
| `apps/web/` | Screens, routes, view models, local UI state. |
| `apps/api/` | Authentication, authorization, API, plans, approvals, event streams. |
| `apps/worker/` | Scheduler, queue processing, execution, reconciliation, verification. |
| `packages/contracts/` | Shared schemas, state enums, API error codes. |
| `packages/domain/` | Deterministic policy, plan validation, finding rules. |
| `packages/ui/` | Tokens and accessible presentation components. |
| `packages/ssh/` | Transport, host identity, collectors, bounded parsing. |
| `packages/ai/` | Bedrock adapter, structured intent and grounded summaries. |
| `target-helper/` | Restricted gateway, operation adapter, signed manifests, remote ledger. |
| `infra/` | CDK, service configuration, deployment and recovery scripts. |
| `tests/fixtures/` | Clearly labeled synthetic server snapshots and malicious-output cases. |
| `tests/e2e/` | Browser and complete workflow tests. |

Use a workspace package manager with a committed lockfile. Generated credentials, environment files, database dumps, and raw server outputs must be excluded from Git. Commit example configuration with placeholders only.

## 4. AWS deployment and trust boundary

### 4.1 Components

| AWS capability | Initial use | Constraint |
| --- | --- | --- |
| EC2 + encrypted EBS | Dedicated installation and database volume. | One owner per host; no public database port; no public administrative SSH by default. |
| Cognito user pool | Identity, managed login, TOTP MFA. | Explicitly allow the owner's immutable subject ID for the installation. |
| Secrets Manager + KMS | SSH credentials and protected session secrets. | Installation-scoped permissions; no broad secret listing/read access. |
| KMS signing key | Sign bounded remote change manifests. | One installation signing identity; targets hold only the public verification key. |
| S3 | Backup repository, append-only-by-application audit objects, export artifacts. | Private, encrypted, scoped prefix/bucket, explicit lifecycle. |
| Bedrock | Intent interpretation and evidence-grounded explanation. | Exact model/region selected after evaluation; no unrestricted executor tools. |
| CloudWatch | Operational logs/metrics/alarms. | Redacted operational data, not full command output or prompts. |
| SES [B] | Verified-owner alerts and test messages. | Verify account/domain readiness, delivery feedback, and sending limits. |
| Route 53, if used | Product DNS. | No automated purchase or DNS changes without project authorization. |

Use AWS Systems Manager Session Manager for the **controller's operator access** where configured. This does not require SSM Agent on the customer's managed servers. Separate managing the AWS controller from the product's target adapter.

### 4.2 Process and network layout

Browser → HTTPS reverse proxy → web/API. API and worker share the local PostgreSQL database. The worker connects through OpenSSH to a registered target. Private targets use the controller's scoped Tailscale identity. AI and AWS access are outgoing service calls.

Deploy application services with systemd and reproducible versioned artifacts. PostgreSQL binds to a local Unix socket or loopback. Use separate OS users for the API, worker, and database; they remain within one installation trust boundary. Do not describe those processes as independent customer security boundaries.

Serve HTTPS through a maintained reverse proxy such as Caddy. Automated certificate issuance/renewal must be tested. If ACME certificate issuance is used, document that external dependency; an Amazon-only certificate path using ACM and a load balancer is an alternative with additional cost. Never ship a public plain-HTTP login for convenience.

Security groups expose only required web ports. Port 80, if needed, serves certificate validation/HTTPS redirects only. Administrative access uses a separately controlled channel. Installations cannot reach each other's application/database ports through permissive VPC rules.

Require IMDSv2 and constrain instance-role permissions. Metadata-hop settings must be tested for the actual process/container arrangement, not blindly copied from another architecture. [T9] All backend services on the host are assumed potentially able to affect that installation if the host is compromised; protect the host accordingly.

### 4.3 Failure domains

The single-host design has no high-availability guarantee. Controller failure stops new checks and decisions; already accepted remote work may continue. Existing applications on managed servers do not depend on the controller staying up.

Recovery uses infrastructure definitions, off-instance backups, secrets, and remote ledgers. Availability and recovery targets are measured against the PRD. Do not claim an SLA from an AWS service's individual availability figure.

### 4.4 Pilot separation

Every invited owner receives a separate controller identity, tailnet enrollment, signing key, database, and secret namespace. A shared Cognito pool may authenticate several owners, but each installation validates its configured subject allowlist. An authenticated user from another installation is still unauthorized.

An installation IAM role cannot read another installation's credentials, sign using its key, or read/write its storage. Test these denials with real scoped roles before external pilots. A shared AWS account is an operator-level failure domain; isolate environments/accounts further if the threat review requires it.

## 5. Authentication, authorization, and secrets

Use Cognito authorization-code flow with PKCE and TOTP MFA; managed login reduces custom authentication code. [T10–T11] Require MFA for all owner accounts initially, which satisfies the PRD's requirement before write access.

The API validates issuer, audience/client, token use, signature, expiry, and allowed subject. Exchange the login for an opaque, server-side session with Secure, HttpOnly, SameSite cookies. Store a hash of the session identifier. Protect state-changing requests with CSRF controls and origin validation. Tokens and private keys never go into browser local storage.

Use short-lived access tokens with bounded refresh/session lifetime. Proposed product session defaults: 60-minute inactivity expiry and 8-hour absolute lifetime; verify background job visibility and refresh behavior. Credentials, account deletion, and disruptive approval require recent authentication; implement a tested reauthentication flow rather than inventing an MFA claim the provider does not supply.

Server authorization derives from the authenticated installation context. Do not trust a submitted `workspace_id` or `owner_id`. Validate ownership for every referenced server, plan, job, observation, and export.

Credential input uses a dedicated protected endpoint. Redact request bodies at the logging boundary and disable analytics/session replay on this surface. Store the key only in Secrets Manager, retrieving it only for authorized execution. AWS encrypts stored secrets using KMS-backed mechanisms; access policy remains the application's responsibility. [T12]

Materialize a key only into a restricted memory-backed temporary file with owner-only permissions for the SSH process, then remove it on completion. Disable core dumps for processes handling secrets. Never place keys in command-line arguments, logs, exceptions, prompts, test snapshots, or exported reports.

Use a dedicated remote account/key. Existing broad owner keys may support a private read-only feasibility check only if the owner explicitly chooses that exposure; do not normalize them as the production onboarding method. Account recovery and key rotation require separate documented procedures and tests before B.

## 6. Private connectivity and SSH identity

### 6.1 Tailscale

Enroll the dedicated controller as a narrowly scoped device in the owner's network. Prefer a short-lived provisioning credential and an explicit device/tag policy allowing only the registered targets and necessary SSH ports. Do not retain a reusable enrollment key unnecessarily. Tailscale auth-key expiry and an already enrolled device's authorization are separate lifecycle concerns; verify both. [T13]

Do not enable exit-node routing, advertise customer subnets, bridge customer networks, or allow broad access to personal devices. Standard OpenSSH over Tailscale is the first transport. Tailscale SSH is a separate authentication mode and is not implicitly enabled.

For B, repeat onboarding and revocation using isolated owner installations. Verify current Tailscale service terms and technical limits for the intended commercial model before offering it as a supported paid dependency.

### 6.2 Target validation and network abuse

Register an address only within the authenticated owner's allowed network scope. Reject malformed addresses, command prefixes, URI schemes, embedded credentials, shell syntax, and unapproved ports. Resolve names using a controlled resolver; validate resolved addresses and bind the job to that validated endpoint and pinned host identity.

Block loopback, metadata endpoints, link-local infrastructure, the controller itself, and operator/control-plane addresses. Permit private/CGNAT addresses only through the explicitly enrolled customer route and registered destination. Revalidate DNS results before connection to prevent rebinding. A registered hostname is not permission to scan the network.

### 6.3 Host-key verification

First enrollment obtains a fingerprint and requires independent verification from the owner, such as the server/provider console or an already trusted SSH session. Store the host key, algorithm, verification evidence, actor, and time. Never use “accept any host key” in production.

A changed key blocks both inspection and changes until reverified. Reverification does not inherit old pending approvals. Combine host-key identity with observed machine identity to detect aliases and duplicates; cloned machine IDs are possible, so no single attribute is sufficient. Ambiguous identity blocks write enablement.

### 6.4 SSH invocation

Use the maintained OpenSSH client via a subprocess argument array, never a local shell. Disable inherited SSH configuration, agent forwarding, port forwarding, user-supplied proxy commands, local commands, and interactive prompts. Pin a per-installation known-hosts file and explicitly select the intended key.

Use strict host checking, batch mode, bounded connection timeout, no TTY, and bounded output capture. The remote executable string is fixed by the reviewed adapter; all variable inputs travel as structured data over stdin. They are never interpolated into an arbitrary remote shell command.

Connection timeout defaults to 10 seconds. A lightweight collector has a 30-second wall-clock budget. A timeout records missing evidence rather than fabricating a measurement. A package operation has a separate execution/observation policy; closing SSH does not kill or retry it.

## 7. Two target access modes

### 7.1 Inspect-only mode

Run fixed, reviewed, nonprivileged collectors over SSH. A collector may return partial results. No package refresh, installation, filesystem preparation, service restart, or elevation occurs without the corresponding authorization.

Inspect-only mode requires no persistent ServrSit agent. It may use temporary, bounded collector scripts, whose content/version is controlled by the product and disclosed where required. Capture exactly which commands/collectors ran. No user/model-authored script is accepted.

### 7.2 Approved-maintenance mode

Reliable privileged execution requires a small, explicitly installed **restricted helper**, an operation ledger, and constrained privilege configuration on the target. This is not a continuously running agent: it has no listening port, polling loop, or background model. It runs only for authenticated SSH requests and already accepted transient jobs.

This is a concrete interpretation of the PRD's allowed privilege configuration and execution artifacts. It is a material onboarding choice. Designer must disclose the files, permissions, dependencies, and removal process. If the founder rejects any persistent helper, the team must revisit the write/recovery design before claiming the same guarantees over bare SSH.

The owner runs a reviewable bootstrap using an existing trusted administration channel. It installs a versioned, checksum-verified package, a dedicated access account/key where explicitly authorized, and a narrow sudoers rule. Bootstrap is not silently executed by an AI request. It is an installation prerequisite, not a general user-management feature.

The helper executable, configuration, signing trust, and remote ledger are root-owned and not writable by the SSH account. Its interface accepts a fixed schema, bounded input, and an allowlisted operation ID—not a command string, executable path, arbitrary environment, or arbitrary systemd unit definition.

For maintenance access, restrict the SSH key to the fixed gateway and disable PTY/forwarding. The gateway ignores caller-supplied commands and passes validated structured requests to the helper. Sudoers permits only this fixed entry point; never grant passwordless general `bash`, `python`, `systemctl`, `apt`, or `systemd-run`.

The bootstrap validates the sudoers file before applying it, preserves existing independent owner access, and can be removed through that independent channel. No claim that the remote key was removed is made unless the removal is actually verified.

## 8. Operation catalog and remote manifest

### 8.1 Catalog

| Operation ID | Authority | Output / verification |
| --- | --- | --- |
| `inspect.host.v1` | Connection consent. | Platform, boot identity, uptime, sampled metrics, capability gaps. |
| `inspect.services.v1` | Connection consent, selected service set. | Exact selected units and normalized state. |
| `inspect.packages.v1` | Connection consent. | Existing package information and its age. |
| `refresh.package_metadata.v1` | Explicit bounded standing consent or per-plan approval. | Refresh outcome, errors, resulting observation time. |
| `plan.packages.v1` | Inspection/planning permission. | Exact proposed transaction and blocked changes; no commit. |
| `apply.packages.v1` | Fresh approval of exact transaction. | Installed versions, package state, service verification, reboot evidence. |
| `restart.service.v1` | Separate action approval. | Selected unit's observed post-state, with app-level coverage limitation. |
| `reboot.host.v1` | Separate reboot approval. | Old/new boot identity, restored SSH, selected services. |
| `prepare.directories.v1` | Exact baseline plan approval. | Newly created allowed paths/ownership/modes; conflicts untouched. |
| `query.operation.v1` | Authorized owner access. | Remote ledger state and bounded evidence. |

Package installation for setup uses the same transaction planner and executor as updates. Capability availability is checked by helper version and target platform. A newer UI cannot send operations an older helper does not support.

### 8.2 Signed manifest

Every mutation manifest contains: schema version, installation ID, server identity binding, unique operation ID, plan ID/version/digest, operation catalog version, requested exact scope, precondition digest, issue/expiry timestamps, and verification contract. It contains no free-form executable code.

Canonicalize the manifest with one tested serialization specification; sign its digest using a scoped KMS asymmetric signing key. Select a widely supported RSA-PSS/SHA-256 configuration after verifying KMS and target verification compatibility. The target stores only the public key and rejects unknown key IDs, invalid signatures, stale or misbound manifests, and unsupported schema versions.

Signing establishes that a manifest came from the authorized controller key. It does not make a compromised controller trustworthy. Application authorization, IAM restrictions, operation limits, and independent audit remain necessary.

The remote helper atomically claims the operation ID in a root-owned ledger. A repeated identical manifest returns the existing operation. The same ID with a different digest is rejected. Expired acceptance is rejected; a previously accepted job may finish after expiry. Target/controller clock skew beyond a small configured tolerance blocks new changes and produces a time-sync finding.

### 8.3 Path and service safety

Resolve service names against an observed, owner-selected set; do not accept globs, arbitrary systemd properties, or executable paths. Return unsupported for units whose semantics are outside the tested adapter.

Directory creation is limited to approved baseline roots, initially under `/srv` or the confirmed user's home. Validate every path component without following symlinks and use directory-file-descriptor operations to avoid check/use races. Existing contents are never overwritten or recursively reowned. Restrict owner/group and mode to explicitly approved values. Paths under system/security pseudo-filesystems and SSH credential directories are not eligible.

## 9. Plans, approval, and durable dispatch

### 9.1 Plan lifecycle

A plan is an immutable versioned record derived from observations and a deterministic operation policy. AI may request creation of a plan but cannot author its executable content or approve it.

Record target identities, observation IDs, exact changes/dependencies, privileges, risk/impact, preconditions, verification, recovery limitations, and a canonical digest. Default expiry is 15 minutes while unstarted. A plan may be blocked with typed reasons; blocked plans have no approval endpoint that can bypass those reasons.

### 9.2 Approval transaction

The approval endpoint requires authenticated owner context, recent authentication where required, CSRF protection, plan digest/version, and explicit production acknowledgements. It checks current policy, connectivity capability, expiry, and target state.

In one database transaction, record the approval, create the unique operation, and write a dispatch-outbox entry. Enforce a unique idempotency key scoped to owner and plan version. Repeated client requests return the same operation; they do not create a fresh execution attempt.

The dispatcher writes the immutable approval/intent object to private S3 using an operation-specific key and conditional creation, then marks the outbox dispatchable. S3 supports conditional writes to prevent accidental overwrite. [T14] A missing off-instance intent record blocks dispatch. A crash between these steps is reconciled using the same key/digest.

### 9.3 Execution boundary

Before sending a change, the worker checks revocation, plan expiry if not yet accepted remotely, server identity, active operation lock, preconditions, and intent-record durability. It signs the allowed manifest only after these checks.

The remote helper verifies the manifest, acquires its server-wide change lock, rechecks operation-specific conditions, writes its accepted record durably, and starts the reviewed operation as a transient systemd service. A service-start acknowledgement is not the operation result. Transient services are suitable for decoupling accepted work from an SSH session, but implementation must use the semantics present on Ubuntu 24.04. [T15]

An accepted operation is identified by its UUID, not by the worker's current queue attempt. All retries first query that operation ID. The controller must never regenerate an ID merely because an SSH response was lost.

### 9.4 Concurrency and fencing

Use a database uniqueness/locking policy for one unresolved mutation per canonical server identity, plus the remote helper's exclusive operation lock. These protect against aliasing, duplicated HTTP requests, queue retries, and a restarted controller.

A worker lease is only a coordination mechanism. Lease expiry does not prove remote work stopped and never authorizes another mutation. A replacement worker reconciles the existing operation. Outcome-unknown blocks conflicting writes until authoritative evidence resolves it or the owner/operator follows a documented recovery procedure.

Within one batch, changes run serially. Each production target has separate approval. On failed/unknown state, pause unstarted work. Read-only checks may run concurrently with a default maximum of four per installation and one bounded collector per target; skip collectors that conflict with an active transaction.

## 10. Safe package transactions

### 10.1 Feasibility gate

The first write-adapter spike must prove that the executed package transaction matches the approved manifest despite concurrent APT activity and repository changes. A preview followed by an unrestricted `apt upgrade -y` is not acceptable.

Use the target's Ubuntu-packaged python3-apt bindings to inspect and apply a transaction under APT's supported locking model. Upstream documentation exposes package-manager and locking APIs, but the team must test the version actually shipped on Ubuntu 24.04. [T16]

Do not manually hold APT locks and then launch a command that tries to acquire them again. Do not delete lock files, kill another package manager, override held packages, or bypass repository verification.

### 10.2 Algorithm contract

1. Obtain a current package observation, with explicitly consented metadata refresh where needed.
2. Select permitted Ubuntu origins already configured on the target. Detect third-party sources and unsupported package states; do not silently include them.
3. Resolve exact package names, architectures, installed/candidate versions, dependency additions, removals, holds, and disk requirements. Reject removals, downgrades, repository edits, and release upgrades in A.
4. Produce the reviewable manifest. Include approved dependency additions. Report blocked packages separately.
5. After approval, acquire the supported package-system lock, reconstruct the transaction, and compare its exact normalized change set and preconditions with the approved manifest. If different, perform no commit and require a new plan.
6. Fetch and verify packages using APT's repository/authenticity checks. Recheck the transaction before commit while preserving the correct lock boundary.
7. Commit with bounded, tested noninteractive behavior for supported transactions. Do not supply arbitrary answers to unexpected configuration prompts. Reject known interactive/unsupported cases during planning; if an unexpected prompt or incomplete configuration occurs, preserve the failure/partial result and require manual recovery rather than forcing continuation.
8. Record exit/progress evidence and independently inspect installed versions, dpkg consistency, selected service state, and reboot-required evidence.

Package maintainer scripts can perform privileged changes and restart services. This product cannot guarantee arbitrary application availability or package rollback. No unattended reboot is enabled by this adapter; existing automatic-update/reboot policies are inspected and disclosed rather than silently changed.

Observation timeouts are not kill timers for active dpkg work. After an expected-duration threshold, show “Taking longer than expected” and continue safe observation. A safe-stop request prevents subsequent steps and targets; it does not force-terminate an active package transaction.

### 10.3 Restart and reboot

Service restart accepts only a selected supported unit and verifies its post-state. An active unit is not proof of end-user application correctness. Reboot records pre-boot identity, accepts a separate approval, schedules/starts the reboot through the reviewed helper, and reconnects with bounded backoff.

Initial return-verification window: 10 minutes, configurable by the operation policy. At expiry, mark outcome unknown/unresolved, retain evidence, and continue permitted later observation without issuing another reboot. Success requires changed boot identity, restored authorized SSH, and the selected verification results. If only some checks pass, report partial verification.

## 11. Operation state model

Keep plan state separate from operation state. Operation transitions are recorded as append-only events, with a materialized current state for efficient queries.

| State | Meaning | Allowed next behavior |
| --- | --- | --- |
| `queued` | Approved record exists; remote acceptance not established. | Dispatch, cancel-before-start, expire/block, or reconcile uncertain dispatch. |
| `running` | Remote ledger confirms acceptance/execution. | Observe; request stop at safe boundary; never duplicate. |
| `verifying` | Execution finished sufficiently to perform independent checks. | Record checks and derive final state. |
| `succeeded` | All required execution and verification criteria passed. | Read/export; any follow-up is a new plan. |
| `partially_succeeded` | Some intended work completed; other steps/checks did not. | Review evidence and create a separately approved recovery plan if supported. |
| `failed` | Failure is established, with known effects recorded. | Explain/review; no blind replay. |
| `cancelled_before_start` | No remote work was accepted. | Preserve evidence; new intent requires a new plan. |
| `outcome_unknown` | Acceptance, execution, or outcome cannot be established. | Reconcile; block conflicting writes. |

`stop_requested` is an orthogonal request flag, not proof of cancellation. `blocked` and `expired` are primarily plan/dispatch conditions with no implied execution. If a supposedly queued job may already have reached the remote machine, query it before calling it cancelled.

Terminal records cannot be edited into success. Later evidence is appended as a reconciliation/verification event with its actor and time; the user can see both the earlier uncertainty and its resolution.

## 12. Persistence model

All records carry installation/workspace scope even in a single-owner deployment. Enforce scope in foreign keys and service queries; this prepares data portability without pretending shared tenancy is already supported.

| Entity | Core fields / invariants |
| --- | --- |
| `owners`, `sessions` | Cognito subject, configured owner mapping, session hash, expiry, authentication time. |
| `servers` | UUID, name, address/port/user, role, production classification, canonical identity, status/capabilities, disconnect state. |
| `host_trust` | Fingerprint/key, verified actor/time/evidence, retired trust versions. |
| `credential_refs` | Secret ARN/version metadata only; no private key bytes. |
| `observations` | Server/check type, collector version, start/end, freshness deadline, success/partial/failure, typed values, evidence reference. |
| `service_expectations` | Approved exact unit names, expected state, source, version. |
| `baselines`, `baseline_versions`, `exceptions` | Selected directory/package conventions, reference observation, owner decisions. |
| `plans` | Immutable version, canonical digest, scope, preconditions, risk, verification, expiry. |
| `approvals` | Plan version/digest, authenticated actor, acknowledgements, timestamp, idempotency key. |
| `operations`, `operation_steps` | Stable operation ID, remote ID, state, stop flag, target lock, result details. |
| `operation_events` | Monotonic per-operation sequence, event type/time, actor/source, payload digest and evidence. |
| `dispatch_outbox` | Approval intent object key/digest, dispatch state, reconciliation metadata. |
| `findings` | Stable deduplication key, rule version, severity, first/last evidence, acknowledgment/snooze/resolution. |
| `schedules` | Timezone, interval/time, next due, paused state, last scheduled/completed run. |
| `notification_deliveries` [B] | Finding/event, verified destination reference, provider ID, delivery state, attempts. |
| `usage` | Inference tokens/cost estimate, check/job counts, quotas, cost version. |
| `exports`, `deletion_requests` | Scoped artifact reference, expiry, deletion lifecycle and exceptions. |

Use explicit schema migrations. Database roles prohibit ordinary application updates/deletes to audit events; privileged retention workflows are separate and recorded. Hashes and append-only behavior provide useful evidence but are not a claim of tamper-proof storage against a fully privileged operator.

## 13. API and event contracts

Use JSON REST endpoints with shared validation and OpenAPI. Cookie authentication is same-origin. Server-sent events provide job updates; reconnect using the last event sequence, with polling fallback. A stream disconnect does not change operation state.

| Endpoint family | Contract |
| --- | --- |
| `GET /api/fleet` | Summary, server states, coverage, observation times, next checks. |
| `POST /api/server-drafts` | Nonsensitive onboarding data; returns draft ID. |
| `POST /api/server-drafts/:id/credential` | Protected credential submission; no body logging or echo. |
| `POST /api/server-drafts/:id/verify-host` | Independent trust confirmation tied to observed key. |
| `POST /api/servers/:id/inspections` | Queue a bounded check; return check/job ID. |
| `POST /api/plans` | Typed supported intent and explicit targets; creates a plan or typed blockers. |
| `POST /api/plans/:id/approvals` | Exact version/digest, idempotency key, required acknowledgements. |
| `GET /api/operations/:id` | Authoritative state, steps, evidence, verification, next allowed actions. |
| `GET /api/operations/:id/events` | Ordered, resumable event stream. |
| `POST /api/operations/:id/stop-request` | Request safe stop; does not claim an active transaction stopped. |
| `POST /api/operations/:id/reconcile` | Read existing remote state; never implicitly start a new mutation. |
| `/api/baselines`, `/api/schedules`, `/api/findings` | Versioned owner preferences and findings actions. |
| `POST /api/servers/:id/disconnect` | Disable future dispatch and schedules; report already accepted work. |
| `POST /api/exports` | Create redacted scoped export with expiry. |
| `POST /api/assistant/messages` | Structured, bounded conversation; may return a plan reference, never execution authorization. |

Return machine-readable errors including `HOST_UNTRUSTED`, `HOST_KEY_CHANGED`, `ROUTE_UNAVAILABLE`, `READ_ONLY_ACCESS`, `PLAN_EXPIRED`, `PLAN_CHANGED`, `PACKAGE_LOCKED`, `TARGET_BUSY`, `OUTCOME_UNKNOWN`, `AUDIT_UNAVAILABLE`, and `AI_UNAVAILABLE`. Include safe display guidance and a correlation ID, never raw secrets or arbitrary remote strings as trusted HTML.

Use optimistic version checks for settings/baselines and idempotency for mutations. Limit request sizes, result sizes, rate, and concurrent inspection requests. Return 404-style unavailable results for unauthorized record IDs without confirming existence.

## 14. Inspection, findings, and scheduling

Collectors emit structured JSON with a schema version and bounded fields. Use deterministic parsers; do not ask a model to extract basic machine facts from an unbounded transcript. Strip terminal control sequences and treat all names/output as untrusted text.

Initial measurements: OS/architecture, boot ID/uptime, load and bounded CPU sample, available/total memory, configured filesystem storage/inodes, selected service state, package metadata age/update status, and readable security observations. Label unavailable capability separately from a passed check.

Health checks default to 15 minutes; deeper inventory/package inspection daily. A single scheduler leader is coordinated through PostgreSQL; jobs have unique `(schedule, due-slot)` keys. Coalesce overlaps and missed runs into one current check. Use stored timezone-aware schedule calculations and show the next run, including daylight-saving behavior where relevant.

Apply PRD freshness rules: health information expires after two configured health intervals; inventory after two inventory intervals. A failed latest attempt is immediately visible alongside historical successful data. Scheduler unavailability is a control-plane condition, not a healthy target result.

Finding rules are deterministic and versioned. Deduplicate by server, rule, and resource identity. Acknowledge and snooze are separate from resolution. Unknown coverage cannot resolve a finding.

Initial disk/inode thresholds are 85% warning and 95% critical across two successful health observations, as proposed in the PRD. Two consecutive scheduled connection failures create an unreachable finding. For CPU/memory, implement advisory thresholds only after documenting the actual sampling method and sustained-sample rule; do not interpret a single instantaneous measurement as a fault.

Alert production [B] uses an outbox and stable notification IDs. Retry transient delivery failures with bounded backoff; suppress duplicates, respect quiet hours/digests, and keep delivery state visible. A service acceptance receipt is not equivalent to inbox delivery.

## 15. AI boundaries and evaluation

Use an adapter around Amazon Bedrock so the model can change without changing operation policy. Begin with one model selected by a documented evaluation of available regional models; do not assume a brand/model choice solely from the development agent used in Kiro.

The model receives only sanitized, relevant observations, selected preferences, supported-operation descriptions, and bounded conversation context. It returns a validated intent or grounded explanation with evidence IDs. The application resolves targets and compiles plans deterministically.

The model cannot access SSH keys, raw private files, the operation signer, credential endpoints, approval endpoints, or arbitrary network/shell tools. Server output is untrusted data even when presented inside a system-generated observation. Prompt-injection detection is supplemental; the permission boundary must hold if detection fails.

Validate every referenced server/observation ID and every proposed operation against the current authenticated scope. Reject invented evidence and unsupported actions. If target resolution is ambiguous, ask a clarification. If inference fails, offer deterministic text and controls.

Evaluate at least: correct target selection, ambiguity handling, current-versus-stale claims, partial results, supported/unsupported intent, prompt injection in host/log/package text, no invented completion, and concise useful explanations. A persuasive answer is not sufficient if its evidence is wrong.

Track model/version, prompt-template version, usage, latency, and outcome without logging sensitive prompts by default. Enforce token/request budgets and per-owner allowances. Core inspections, operation recording, and already-authorized work continue when inference is unavailable or capped.

Verify model/region data retention, invocation logging, and cross-region processing settings before using customer data. AWS shared-responsibility guidance does not remove this obligation. [T17] Disable unintended prompt logging and cross-region routing unless explicitly reviewed and disclosed.

## 16. Security threat model and controls

| Threat | Control and verification |
| --- | --- |
| Prompt injection from server output | No executable model output; validated catalog and authorization boundary; adversarial fixtures. |
| Shell/path/service injection | Fixed executable, argument arrays, signed typed input, allowlisted operations, no-follow path handling. |
| Compromised browser/session | MFA, secure sessions, CSRF/origin checks, recent authentication, bounded authorization. |
| Host impersonation / DNS rebinding | Independent host-key verification, pinned identity, validated route/address. |
| Duplicate or replayed remote work | Unique operation ledger, plan digest, expiry, remote lock, query-before-retry. |
| Lost controller/database | Off-instance intent records, backups, restore mode, reconciliation before writes. |
| Cross-customer access | Dedicated installations and IAM/network/identity scopes; real negative tests before B. |
| Credential leakage | Secrets Manager, no logging, protected entry, temporary restricted materialization, redacted outputs. |
| Malicious target tries to reach control plane | No credentials returned to target; bounded output/protocol; no model/shell interpretation; controller egress/input validation. |
| Compromised controller host | Scope blast radius to one owner; patched host, limited IAM, restricted target operations, revocation and incident runbook. This risk is not eliminated. |
| Supply-chain compromise | Pin dependencies/artifacts, review helper releases, verify build provenance/checksums, scan dependencies and secrets. |
| Operator misuse | Separate deployment/retention permissions, recorded access, no casual support impersonation, independent review before paid release. |

Before B, complete a written threat-model review and test the isolation/revocation controls. Before C, commission the independent security review required by the PRD and close critical findings. Do not describe an alpha as penetration-tested or certified without actual evidence.

## 17. Audit, retention, backup, and restoration

### 17.1 Records and redaction

Persist intent, approval, accepted remote operation ID, execution events, and verification. Sanitize at collection boundaries before model use and durable log storage. Prefer structured whitelisted facts over trying to redact every possible secret from arbitrary logs. Bound optional transcripts, strip escape sequences, and avoid unrestricted `journalctl`/filesystem output.

Operational application logs contain correlation IDs, timings, error codes, and safe metadata. Audit evidence is a separate protected resource. Export never includes credentials or signing material.

### 17.2 Retention

Follow the PRD: 30 days for observations/chat and 90 days for operation records by default. Implement explicit lifecycle for database rows, export files, audit objects, and noncurrent object versions. A normal backup policy must not silently retain deleted customer data forever.

For account deletion [B], revoke future execution immediately, delete active data within 30 days, and expire remaining backup copies within a further 30 days as disclosed. Keep only justified, disclosed exceptions. Do not use immutable object retention that makes this policy impossible without first changing the product policy.

Remote job evidence defaults to 90 days, with cleanup performed through a documented maintenance/bootstrap process rather than an unrestricted file-cleanup feature. Disconnection must explain any remaining helper/ledger and how the owner removes it. Uninstalling the helper never deletes application data.

### 17.3 Backups

Use pgBackRest or an equivalently reviewed PostgreSQL-aware backup tool to private S3, with daily backups and WAL archiving. PostgreSQL's backup consistency and WAL requirements must be respected; copying a live data directory is not a backup strategy. [T18]

Initial target: meet or improve the PRD's 24-hour non-operational-history RPO and 4-hour restoration target. Test the actual restore duration and backup freshness. Encryption keys, infrastructure manifests, and credentials must also be recoverable through controlled procedures.

### 17.4 Restore mode

Every restoration starts with mutation dispatch disabled. Recover the database, compare off-instance approval/intent records, and query remote ledgers for any operation whose acceptance/outcome is uncertain. Old queue entries are not permission to replay approved work.

If audit/operation evidence is missing, keep the affected servers write-blocked. Allow clearly labeled read-only inspection where identity and access remain trustworthy. Explicit reconciliation records lift the block only after the actual state is established. A recovered old backup never resets a used operation ID into an unused one.

## 18. Observability and self-maintenance

Monitor: HTTP availability/latency, authentication errors, queue age, scheduler lag, missed checks, SSH failures, operation durations, unresolved outcomes, disk capacity, database/WAL/archive state, certificate expiry, inference errors/cost, and notification failure [B].

The controller is not one of its own ordinary managed targets. Do not let an agent perform an in-place self-upgrade that can destroy its active operation record. Controller deployment/patching uses a separate runbook: stop new dispatch, reconcile/drain accepted work safely, back up, deploy a versioned release, verify, then resume.

Before a production controller update, prove rollback of application code and compatibility with database migrations. Use expand/contract migrations where needed. Never restore an older database merely to undo UI code while remote operations may have continued.

For B, an independent external check must detect the management service being down; a failed controller cannot reliably send its own outage alert. Define who receives operator alerts and who owns incident response before inviting users.

## 19. Performance, costs, and operating limits

Carry forward the PRD targets: cached fleet view within 2 seconds at p95, lightweight inspection within 30 seconds for 95% of supported responsive hosts at up to 350 ms RTT, and 99% of eligible schedules starting within 2 minutes while the scheduler/executor service is available. Measure failures and missed runs separately rather than excluding them silently.

Start load testing with 20 servers, four concurrent inspections, one fleet mutation at a time, realistic failure delays, and bounded transcript sizes. Default structured observation payload cap: 256 KiB; individual collector output cap: 1 MiB with truncation flagged; remote manifest cap: 64 KiB. Revisit values based on tested workloads, not unlimited buffering.

Initial compute sizing is a **benchmark hypothesis** of approximately 2 vCPU and 4 GiB RAM, not a fixed instance SKU or a cost quote. Measure memory/CPU/database growth on a disposable installation and choose the current regional instance/storage option accordingly.

Before provisioning, produce a dated AWS cost worksheet covering compute, public IP, EBS, snapshots/backups, S3 requests/storage, KMS, Secrets Manager, Cognito, CloudWatch, inference, outbound transfer, DNS/certification path, email, and any Tailscale cost. Include idle and active usage scenarios plus recurring support labor. Do not assume free-tier eligibility.

Use the PRD's illustrative US$7.25 direct infrastructure/AI envelope for a US$29 subscription as a **test**, not a forecast. A dedicated always-on installation may exceed it. Report the conflict openly and stop short of a paid launch until pricing or architecture is revised.

Proposed first-region candidate: Singapore for evaluation from Indonesia, subject to service/model availability, measured routing to all targets, data requirements, and cost. This is not a latency guarantee. The founder approves the spend/region after reviewing a concrete estimate.

## 20. Test strategy and release gates

### 20.1 Test layers

| Layer | Required evidence |
| --- | --- |
| Domain unit tests | Freshness, finding deduplication, state transitions, scope/digest checks, approval expiry, target resolution. |
| Contract tests | API validation, safe errors, observation/manifest versions, unsupported helper behavior. |
| Helper security tests | Invalid signatures, replay/digest mismatch, injection strings, symlink/path races, invalid service names, privilege escape attempts. |
| Database/queue integration | Outbox crash recovery, idempotent approval, duplicate delivery, leader restart, active-lock preservation. |
| Real Ubuntu VM integration | Native APT locks, installed-state verification, transient jobs surviving SSH disconnect, reboot identity, helper bootstrap/removal. Containers alone cannot prove these behaviors. |
| Browser end-to-end | Connect, inspect, plan/approve, expired plans, outcome unknown, baseline, export, disconnect, AI unavailable. |
| UI/accessibility | UX viewports, long content, tokens/fonts, keyboard, screen reader, zoom, reduced motion, contrast. |
| AWS deployment/recovery | Scoped roles, secrets, HTTPS, network routing, restore mode, backup restoration, cost measurements. |

### 20.2 Required fault injection

Use disposable hosts only. Simulate network loss before remote acceptance, after acceptance but before acknowledgement, during package work, and during verification. Restart the controller/worker at each boundary. Confirm that repeated jobs never create a second mutation.

Test external APT activity, stale repository information, a changed dependency set, insufficient disk, unavailable repository, held packages, unexpected configuration behavior, failed selected service, reboot that does not return, changed host key, revoked credential, stale controller backup, and malicious output instructions.

Zero unapproved writes, exposed secrets, or false verified-success states is a release gate. Failure in these categories blocks expansion regardless of how polished the interface is.

### 20.3 Traceability

| PRD IDs | Technical sections |
| --- | --- |
| FR-01–FR-04 | 4–7, 12–13. |
| FR-05–FR-09 | 8, 12–15. |
| FR-10–FR-11 | 8–9, 11–13. |
| FR-12–FR-15 | 7–11. |
| FR-16–FR-18 | 9, 11–13, 17. |
| FR-19–FR-20 | 14, 18. |
| FR-21–FR-22 | 4–6, 15–17. |
| FR-23 | Stage C only; Section 22 defines the boundary. |

## 21. Implementation sequence for the Kiro team

| Milestone | Work | Verification / exit |
| --- | --- | --- |
| M0 — Establish the project | Read sources; inspect existing repository; create steering, agent roles, contracts, decision log, fixtures, and task graph. | Requirement traceability and scope contradictions resolved or explicitly logged. |
| M1 — Prove risky mechanics | Disposable Ubuntu target; pinned SSH identity; helper bootstrap; manifest/ledger; disconnect/retry; APT transaction locking; initial AWS/private route feasibility and cost worksheet. | Evidence that state survives interruption and approved scope controls execution. No live maintenance until this passes. |
| M2 — Establish the experience | Designer builds the selected visual system and high-fidelity core screens against shared typed fixtures; Coder connects authenticated read-only APIs. | Browser review at required sizes; truthful stale/partial/unknown states; no fake live data. |
| M3 — Complete the care loop | Plan, approval, intent outbox, execution, verification, serial batches, history. | End-to-end disposable-target tests including failure injection. |
| M4 — Continuing care | Scheduler, findings, comparison, basic setup, exports, disconnect, AI fallback. | All Stage A requirements pass with measured performance and recovery tests. |
| M5 — Founder use | Authorized onboarding of real servers, carefully approved maintenance, four-week measurement. | Founder outcome and PRD alpha exit criteria reviewed. |
| M6 — Invited pilot | Separate owner installations, external alerts, recovery/deletion, security/isolation review, economics. | Stage B gates; no automatic progression to paid launch. |

Designer can work on fixtures while Coder investigates M1. Tester writes independent acceptance/failure tests as contracts stabilize. These workstreams should run concurrently where dependencies permit; foundational execution proof and authentic live writes remain gated.

Do not interpret “parallel” as editing the same files simultaneously. Assign ownership and use separate branches/worktrees when tools permit. Orchestrator owns integration and one canonical task board.

## 22. Deferred technical decisions and change control

The following must be resolved by the named checkpoint; they are bounded decisions rather than permission to invent unsupported behavior:

| Decision | Owner / deadline | Default direction |
| --- | --- | --- |
| Exact AWS SKU, region, cost cap, DNS | Orchestrator + founder, before paid resource creation. | Small dedicated installation; dated cost worksheet. |
| Helper acceptance and bootstrap UX | Founder + Designer, before write enablement. | Explicit, small non-daemon helper with narrow privileges. |
| Exact APT library/locking procedure | Coder + Tester, M1. | Tested Ubuntu-packaged APIs; block execution if proof fails. |
| Bedrock model and retention configuration | Coder + Tester, before real customer inference. | One evaluated regional model, sanitized evidence only. |
| Exact library and image versions | Coder, M0–M1. | Supported branches, lockfile, compatible security patches. |
| Paid-service architecture and price | Founder, after M6. | Do not assume the dedicated model fits US$29. |
| Payment collection and billing provider | Founder, Stage C specification. | Manual paid-pilot arrangements may precede integration; no provider selected here. |

Stage C is not implemented by this technical baseline. Before it begins, extend this specification to cover subscription entitlements, payment event idempotency, tax/merchant responsibilities, cancellation and data access. Do not invent an Amazon-native payment system merely to keep the vendor list uniform.

Product scope changes return to the PRD. Interaction changes update the UX Spec. Technical decisions use an ADR and remain consistent with both. Kiro-generated feature specs must preserve requirement IDs rather than replacing the source documents with a different product.

## 23. Sources and evidence status

This is an engineering design, not an implementation report. No infrastructure was provisioned, no live credentials were used, no target helper was installed, and no real-server maintenance was performed while preparing it. Algorithms and recovery behavior must be demonstrated in the specified tests.

Official sources accessed 15 November 2026:

- **T1:** [Kiro Specs](https://kiro.dev/docs/specs/).
- **T2:** [Kiro Steering](https://kiro.dev/docs/steering/).
- **T3:** [Kiro Custom agents](https://kiro.dev/docs/custom-agents/). Verify the installed surface/version before generating agent configuration.
- **T4:** [ECS/Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html).
- **T5:** [Systems Manager hybrid management](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-hybrid-multicloud.html).
- **T6:** [Node.js release schedule](https://github.com/nodejs/Release).
- **T7:** [PostgreSQL version policy](https://www.postgresql.org/support/versioning/).
- **T8:** [pg-boss](https://github.com/timgit/pg-boss/blob/master/README.md).
- **T9:** [EC2 instance metadata options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html).
- **T10:** [Cognito authorization-code PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html).
- **T11:** [Cognito TOTP MFA](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-mfa-totp.html).
- **T12:** [Secrets Manager encryption](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html).
- **T13:** [Tailscale auth keys](https://tailscale.com/docs/features/access-control/auth-keys).
- **T14:** [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).
- **T15:** [systemd-run](https://www.freedesktop.org/software/systemd/man/255/systemd-run.html).
- **T16:** [python-apt package-manager and locking APIs](https://apt-team.pages.debian.net/python-apt/library/apt_pkg.html).
- **T17:** [Amazon Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html).
- **T18:** [pgBackRest Ubuntu guide](https://pgbackrest.org/user-guide.html).

Recheck platform capabilities, regional availability, licensing, security updates, and pricing during implementation. Exact cost and performance claims require measurement.
