# ServrSit — Task Board

**Canonical task list.** All agents read this. Orchestrator controls status updates and integration.  
Last updated: 2026-11-15 | Milestone: M0 — Establish the project

---

## Milestone M0 — Establish the project

### T-001 — Read source documents and inspect repository
| Field | Value |
|---|---|
| **Owner** | Orchestrator |
| **Requirements** | PRD §18; Technical Spec §21 M0 |
| **Dependencies** | none |
| **Acceptance criteria** | All four source docs read in full; repo state captured; contradictions logged; working brief produced |
| **Status** | ✅ done |
| **Evidence** | `docs/decisions/contradictions.md`; working brief in `docs/team/working-brief.md` |

---

### T-002 — Create steering files
| Field | Value |
|---|---|
| **Owner** | Orchestrator |
| **Requirements** | Technical Spec §3.2; PRD §18 |
| **Dependencies** | T-001 |
| **Acceptance criteria** | Five steering files present in `.kiro/steering/`: product, technology, design, structure, execution-security. Each loads in Kiro without parse errors. |
| **Status** | ✅ done |
| **Evidence** | `.kiro/steering/product.md`, `technology.md`, `design.md`, `structure.md`, `execution-security.md` |

---

### T-003 — Create task board, decision log, contradiction log, risk register
| Field | Value |
|---|---|
| **Owner** | Orchestrator |
| **Requirements** | Technical Spec §21 M0; PRD §4 principle 1 |
| **Dependencies** | T-001 |
| **Acceptance criteria** | `docs/team/task-board.md`, `docs/team/working-brief.md`, `docs/decisions/decision-log.md`, `docs/decisions/contradictions.md`, `docs/decisions/risk-register.md` all present and populated |
| **Status** | ✅ done |
| **Evidence** | This file and siblings |

---

### T-004 — Initialise monorepo with package manager and lockfile
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §3.1–3.2 |
| **Dependencies** | T-002, T-003 |
| **Acceptance criteria** | pnpm workspace configured; `pnpm-lock.yaml` committed; all packages scaffolded with correct names; `node_modules` gitignored; `.gitignore` excludes secrets/env/dumps |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-005 — Resolve and pin exact dependency versions
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §3.1 "Resolve and pin exact application/package versions" |
| **Dependencies** | T-004 |
| **Acceptance criteria** | Node.js LTS version confirmed current; PostgreSQL 17 minor confirmed current; all app deps pinned in lockfile; planned upgrade dates recorded in `docs/decisions/decision-log.md` |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-006 — Initialise git repository and branch strategy
| Field | Value |
|---|---|
| **Owner** | Orchestrator |
| **Requirements** | Technical Spec §3.2; Structure steering |
| **Dependencies** | T-004 |
| **Acceptance criteria** | Git repo initialised; initial commit with structure and steering; `.gitignore` verified; branch naming convention documented |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-007 — Establish shared contracts skeleton
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §3.1 "Shared contracts"; FR-16 state model |
| **Dependencies** | T-005 |
| **Acceptance criteria** | `packages/contracts/` exports: operation state enum, server status types, observation freshness types, API error codes, plan/approval types — all with TypeScript types generated from runtime schemas. No implementation logic, only types and schemas. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-008 — Create typed fixture snapshots
| Field | Value |
|---|---|
| **Owner** | Coder (schema); Designer (fixture data content) |
| **Requirements** | Technical Spec §21 M2; UX Spec §18 |
| **Dependencies** | T-007 |
| **Acceptance criteria** | `tests/fixtures/` contains typed synthetic server snapshots for: 1-server fresh, 3-server mixed state, stale/partial/unreachable, running operation, outcome-unknown, malicious-output cases. All fixtures carry `[FIXTURE DATA]` marker in their metadata. Must include the adversarial fixture packages required by acceptance-matrix tests FI-020 and SA-013b (prompt-injection text in hostnames, package descriptions, log lines, filenames). |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-009 — Build acceptance test matrix
| Field | Value |
|---|---|
| **Owner** | Tester |
| **Requirements** | PRD §14; Technical Spec §20 |
| **Dependencies** | T-007 |
| **Acceptance criteria** | `docs/team/acceptance-matrix.md` maps every PRD Stage A scenario to: test ID, test type, pass criteria, evidence type (fixture/disposable/real). Zero unrun tests claimed as passing. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

## Milestone M1 — Prove risky mechanics

### T-010 — Provision disposable Ubuntu 24.04 target
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §20.1 "Real Ubuntu VM integration"; PRD §14 |
| **Dependencies** | T-005 |
| **Acceptance criteria** | Disposable VM running Ubuntu 24.04 LTS x86-64; accessible via SSH; not Sentani/Nabire/Timika; documented teardown procedure |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-011 — SSH transport and host-key pinning
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §6; FR-02 host-key; execution-security steering |
| **Dependencies** | T-010 |
| **Acceptance criteria** | `packages/ssh/` connects to disposable target; strict host-key checking enforced; changed key blocks connection; connection timeout 10 s; no SSH config inheritance; no shell string interpolation; bounded output capture |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-012 — Target helper bootstrap and manifest verification
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §7.2, §8; FR-03 |
| **Dependencies** | T-011 |
| **Acceptance criteria** | Helper installs on disposable target via reviewed bootstrap; manifest signature verified; invalid signature rejected; replayed manifest rejected; operation ID claimed atomically in remote ledger |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-013 — Disconnect/retry reconciliation proof
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §9.3–9.4; FR-17; execution-security invariant 7 |
| **Dependencies** | T-012 |
| **Acceptance criteria** | Simulated SSH disconnect at: pre-acceptance, post-acceptance, mid-operation. In each case: retry queries existing operation ID first; no second mutation created; outcome-unknown state set when result cannot be established |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-014 — APT transaction locking proof
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §10; FR-12; PRD §14 "Package lock / low disk / held package" |
| **Dependencies** | T-012 |
| **Acceptance criteria** | python3-apt on Ubuntu 24.04 tested under: normal lock, concurrent external apt, low disk, held package. Transaction matches approved manifest before commit or operation is blocked. No manual lock-file deletion, no kill of another package manager. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-015 — AWS feasibility and cost worksheet
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §19; PRD §11.2, §13.3 |
| **Dependencies** | T-005 |
| **Acceptance criteria** | `docs/decisions/aws-cost-worksheet.md` covers: EC2 (small dedicated instance), EBS, public IP, S3, KMS, Secrets Manager, Cognito, CloudWatch, Bedrock inference (at least 2 models evaluated), outbound transfer, DNS path options — both idle and active scenarios. Dated. Compared against US$7.25/workspace envelope. Contradictions flagged. **No resources purchased until Spotty reviews and authorizes.** |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-016 — Tailscale private-route feasibility
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §6.1; PRD §11.3 |
| **Dependencies** | T-015 |
| **Acceptance criteria** | Documents: Tailscale enrollment flow for a dedicated controller identity; scoped device/tag policy; auth-key expiry behavior; isolation approach for pilot B. No production tailnet touched. No reusable enrollment key retained. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

## Milestone M2 — Establish the experience

### T-017 — Design token system and component library foundation
| Field | Value |
|---|---|
| **Owner** | Designer |
| **Requirements** | UX Spec §4; design steering |
| **Dependencies** | T-007, T-008 |
| **Acceptance criteria** | `packages/ui/` exports CSS tokens matching all UX Spec §4 values exactly (Canvas, Surface, Ink, Muted ink, Tangerine, Lilac, Citron, Soft line, Control boundary, Focus, all semantic states). Typography scale implemented with Bricolage Grotesque + Geist, served from application path with system fallbacks. All tokens verifiable against spec values. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-018 — High-fidelity overview screen (fixture)
| Field | Value |
|---|---|
| **Owner** | Designer |
| **Requirements** | UX Spec §5.2, §8, UX-04; FR-06 |
| **Dependencies** | T-017, T-008 |
| **Acceptance criteria** | Overview screen renders at 1440×900 and 390×844 with fixture data. Briefing headline, server roster (2-card and 3-card rows), attention column, ask bar, freshness indicators all present. No fake live data — `[FIXTURE DATA]` label visible. Stale and unreachable states visually distinct from fresh/clear. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-019 — High-fidelity server detail screen (fixture)
| Field | Value |
|---|---|
| **Owner** | Designer |
| **Requirements** | UX Spec §8.4, UX-05; FR-05, FR-06 |
| **Dependencies** | T-017, T-008 |
| **Acceptance criteria** | Server detail screen at desktop and mobile. Status/Care/Settings sections. Partial check, stale, unreachable, and outcome-unknown states all represented in fixtures. Production label visible. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-020 — High-fidelity plan review screen (fixture)
| Field | Value |
|---|---|
| **Owner** | Designer |
| **Requirements** | UX Spec §10, UX-07; FR-10, FR-11 |
| **Dependencies** | T-017, T-008 |
| **Acceptance criteria** | Plan review renders target identity, production label, scope, impact, preconditions, verification, expiry. Approve button uses specific label ("Approve update on Nabire"). Expired and blocked plan states rendered. Mobile layout: scope and risk readable at 390 px and 320 px; target and approval controls never clipped. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-021 — High-fidelity operation result screens (fixture)
| Field | Value |
|---|---|
| **Owner** | Designer |
| **Requirements** | UX Spec §11, UX-08; FR-16 |
| **Dependencies** | T-017, T-008 |
| **Acceptance criteria** | Operation detail renders all nine states from UX Spec §11 table. Succeeded, partially-succeeded, outcome-unknown, and failed all visually distinct. Expandable transcript on dark Ink surface. Completion receipt separates changed/verified/remaining/unverifiable. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-022 — Connection flow screens (fixture)
| Field | Value |
|---|---|
| **Owner** | Designer |
| **Requirements** | UX Spec §7.3, UX-03; FR-02, FR-03 |
| **Dependencies** | T-017 |
| **Acceptance criteria** | Four-step connection flow renders at desktop and mobile. Host fingerprint verification step present and not skippable. Credential input surface has no analytics/session replay markers. Access scope distinction (inspect-only vs. maintenance) visible. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-023 — Authenticated read-only API scaffolding
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §13; FR-01 authentication |
| **Dependencies** | T-007, T-011 |
| **Acceptance criteria** | Fastify API serves `GET /api/fleet` returning typed fixture data with observation times and freshness. Cognito auth flow (PKCE) validates tokens. Unauthenticated request returns 401. Session cookie is HttpOnly, Secure, SameSite. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-024 — Browser review at all required sizes
| Field | Value |
|---|---|
| **Owner** | Tester |
| **Requirements** | UX Spec §18; Technical Spec §20.1 "UI/accessibility" |
| **Dependencies** | T-018, T-019, T-020, T-021, T-022 |
| **Acceptance criteria** | Playwright screenshots captured at: 1440×900, 1024×768, 768×1024, 390×844, 320 px width. Token/font values verified against spec. Keyboard navigation tested on connection flow and plan review. Contrast ratios checked for all semantic state pairs. Reduced motion tested. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

## Milestone M3 — Complete the care loop

### T-025 — Plan creation and approval API
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §9; FR-10, FR-11 |
| **Dependencies** | T-023, T-013 |
| **Acceptance criteria** | `POST /api/plans` creates immutable versioned plan with digest. `POST /api/plans/:id/approvals` requires auth + CSRF + digest match + production acknowledgements. Idempotent: repeated approval returns same operation. Plan expiry enforced at 15 minutes. Changed digest invalidates approval. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-026 — Durable dispatch outbox and operation state machine
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §9.2–9.3, §11; FR-16, FR-17 |
| **Dependencies** | T-025, T-013 |
| **Acceptance criteria** | Approval atomically writes dispatch-outbox entry. Worker dispatches only after intent object written to S3. All nine operation states transition correctly. Terminal states append-only. Controller restart mid-dispatch reconciles correctly — no duplicate mutation. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-027 — Package update end-to-end on disposable target
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §10; FR-12; PRD §14 scenarios |
| **Dependencies** | T-026, T-014 |
| **Acceptance criteria** | Full flow on disposable target: inspect → plan → approve → execute → verify. Transaction matches manifest. Installed versions confirmed independently. Selected service state reported. Reboot-required evidence reported separately. Exit code zero alone does not mark success. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-028 — Serial batch execution and production per-server approval
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §9.4; FR-14 |
| **Dependencies** | T-027 |
| **Acceptance criteria** | Multi-server batch runs one machine at a time. Production server requires separate per-server approval. Failed/unknown result pauses remaining machines with explicit "Not started — waiting for review" state. Two concurrent change requests on same server are blocked. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-029 — History, operation detail, and export API
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §13, §17; FR-18 |
| **Dependencies** | T-026 |
| **Acceptance criteria** | `GET /api/operations/:id` returns authoritative state surviving browser refresh and device switch. Export produces redacted readable + machine-readable artifact. No credentials in export. Failed and cancelled operations included. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-030 — Failure injection test suite
| Field | Value |
|---|---|
| **Owner** | Tester |
| **Requirements** | Technical Spec §20.2; PRD §14 |
| **Dependencies** | T-027, T-028 |
| **Acceptance criteria** | Tests on disposable targets cover: network loss pre-acceptance, post-acceptance, mid-package-work, mid-verification. Controller restart at each boundary. No second mutation created on retry. Stale plan cannot authorize changed transaction. Package lock / low disk / held package all block correctly. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

## Milestone M4 — Continuing care

### T-031 — Scheduler and check coalescing
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §14; FR-19 |
| **Dependencies** | T-023 |
| **Acceptance criteria** | Health checks run every 15 min; deeper inventory daily. Single PostgreSQL leader. Overlapping runs coalesce. Missed runs produce one current check, not a backlog replay. Scheduler unavailability visible — not a healthy-target result. Next run displayed with correct timezone. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-032 — Findings rules and deduplication
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §14; FR-20; PRD thresholds |
| **Dependencies** | T-031 |
| **Acceptance criteria** | Disk/inode warning at 85%, critical at 95% across two successful health observations. Unreachable finding after two consecutive failed scheduled checks. CPU/memory advisory only. Repeated detection updates same finding — no duplicate cards. Acknowledge and snooze are distinct from resolution. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-033 — Baseline comparison and basic server preparation
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §8 `prepare.directories.v1`; FR-09, FR-15 |
| **Dependencies** | T-027 |
| **Acceptance criteria** | Baseline covers approved directory paths and selected package presence. Each difference labeled: Matches/Missing/Different by design/Conflict/Not checked. No automatic copy. Existing conflicting contents flagged, not altered. Credentials/app data/SSH keys excluded. Repeating completed plan produces no changes. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-034 — AI fallback and deterministic mode
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §15; FR-07, FR-08 |
| **Dependencies** | T-023 |
| **Acceptance criteria** | With Bedrock unavailable: fleet view, inspection, plan review, approval, history all fully functional. No invented natural-language results. No task marked failed solely because AI summary failed. AI-unavailable state is visible but does not block deterministic workflows. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-035 — Disconnect, access revocation, and export
| Field | Value |
|---|---|
| **Owner** | Coder |
| **Requirements** | Technical Spec §13 `/api/servers/:id/disconnect`; FR-03, FR-18, FR-21 |
| **Dependencies** | T-029 |
| **Acceptance criteria** | Disconnect stops new jobs/schedules; queued operations cancelled; active work reported honestly. Product explains how to revoke remote key — does not claim it was revoked unless verified. Export contains no secrets. Retention policy (30d observations, 90d operations) implemented and matches disclosed policy. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

### T-036 — Stage A acceptance test run
| Field | Value |
|---|---|
| **Owner** | Tester |
| **Requirements** | PRD §14 all Stage A scenarios; Technical Spec §20 |
| **Dependencies** | T-030, T-031, T-032, T-033, T-034, T-035 |
| **Acceptance criteria** | Every Stage A PRD scenario in `docs/team/acceptance-matrix.md` has a test result. Zero unapproved writes, exposed credentials, or false verified-success states. Failed and unrun tests reported accurately — not passed because code looks correct. |
| **Status** | 🔲 todo |
| **Evidence** | — |

---

## Status key

| Symbol | Meaning |
|---|---|
| 🔲 todo | Not started |
| 🔄 in-progress | Active work |
| 🚫 blocked | Waiting on dependency or decision |
| ✅ done | Acceptance criteria met with evidence |

---

## Current milestone: M0 → M1

**Next actions (can start in parallel):**
- **Coder:** T-004 monorepo init, T-005 version pinning, T-010 disposable VM
- **Designer:** T-017 token system (depends on T-007 contracts skeleton from Coder)
- **Tester:** T-009 acceptance matrix (depends on T-007)
- **Orchestrator:** T-006 git init, T-015 AWS cost worksheet research


---

## Live wiring (post-M2, founder-authorized read-only; see ADR-012)

| ID | Owner | Task | Depends | Status |
|---|---|---|---|---|
| T-037 | Coder | Read-only collectors (`inspect.host.v1`, `inspect.services.v1`-lite, `inspect.packages.v1` without refresh) in `packages/ssh`; pinned known_hosts; bounded output; unit tests against recorded fixtures | T-007 | todo |
| T-038 | Coder | API `GET /api/fleet` live mode with per-server `source: live|fixture`, freshness, partial/failed states; fixture fallback clearly labeled | T-037 | todo |
| T-039 | Coder | Kiro AI adapter (`packages/ai`): no-tools agent, sanitized input, prompt-injection fixtures, failure fallback | T-038 | todo |
| T-040 | Designer | Merauke card (Dev host) + per-card data-source badge (FIXTURE/LIVE) | T-018 | todo |
| T-041 | Orchestrator | Founder fingerprint verification, then add pinned known_hosts entries | founder | blocked on founder |

## Care-loop gaps from test-report-care-loop-001 (Orchestrator decisions, ADR-016 run)

| ID | Owner | Task | Decision basis | Status |
|---|---|---|---|---|
| T-054 | Coder | F2: approval endpoint re-checks target state/preconditions before recording approval (typed PLAN_CHANGED) | Tech Spec 9.2 | todo |
| T-055 | Coder | F3/F6: `POST /api/operations/:id/stop-request` (flag only, safe boundary, never kill) and `POST /api/operations/:id/reconcile` (read remote ledger, never start a mutation) | Tech Spec 13, FR-16/17 | todo |
| T-056 | Coder | F5: canonical server identity (host key + observed machine identity); duplicate/alias detection blocks write enablement; lock on canonical identity | Tech Spec 6.3, 9.4, FR-02 | todo |
| T-057 | Coder | O1: production approval requires the two specific acknowledgements (recovery route, interruption risk) | UX Spec 10.2 | todo |
| T-058 | Coder | O2/O3: typed ROUTE_UNAVAILABLE on planning; worker-loop backoff | Tech Spec 13 | todo |
| T-059 | Coder | F4: restart.service.v1, reboot.host.v1, prepare.directories.v1 (build only, simulated target, writes gated) | FR-13, FR-15 | todo |
| T-061 | Coder | Clock-skew check: record controller time vs target time at collection; skew > 2 min raises a time-sync finding; ages derived from target timestamps are corrected or marked uncertain; skew beyond tolerance will block writes (Tech Spec 8.2). CORRECTION: the controller (Merauke) is ~7 h FAST and unsynchronized (timesyncd to 123.235.232.172 times out; Google/Cloudflare Date headers 20:34Z vs Merauke 03:34Z next day). Sentani, Nabire and Timika are correct. | Tech Spec 8.2 | todo |
| T-062 | Coder | Third-party package origins: pending updates from non-Ubuntu origins (e.g. Sentani docker-ce*) are listed separately and excluded from Stage A update plans by default (Tech Spec 10.2 step 2) | Tech Spec 10.2 | todo |
| T-063 | Coder | Controller clock self-check: read `timedatectl show` (NTPSynchronized) and compare with HTTPS Date headers from 2 trusted sources; if unsynchronized or skewed > 2 min, raise a control-plane finding "ServrSit's own clock is wrong", attribute skew to the controller (not targets) when most targets agree with each other, mark all ages/expiries as uncertain, and block plan approval. | Tech Spec 8.2, PRD FR-06 | todo |
| T-064 | Coder | Tester F1 (High): secret detector blind spots; F5 cut-off replies; F2/F3 fact-check precision and recall; O1 fact-check the per-server explainer; F4 tone check for failure states. | test-report-ai-auth-001 | todo |
| T-066 | Coder | Auth defects from test-report-ai-auth-001 §9.3: D-A1 rate limit counted after body parse and per source address, owner's own session/address keeps its allowance; D-A2 lockout cannot be driven indefinitely by an anonymous caller (per-address backoff, account lock only on sustained failures, no unbounded doubling at cap); D-A3/D-A3b use monotonic time for locks and idle timers, refuse enrolment while controller clock is untrusted (T-063); D-A4 setup token restartable until enrolment is confirmed. Convert Tester's 5 `todo` tests to guards. | Tech Spec 5 | todo |
| T-067 | Designer | Server detail screen (UX-05) on live data | UX 8.4, FR-05/06 | in-progress |
| T-068 | Designer | Connect-a-server flow (UX-03) against typed stub | UX 7.3, FR-02/03 | in-progress |
| T-069 | Coder | Server registration API (FR-02/03): drafts (no secrets), address validation (Tech Spec 6.2), host-key fetch + owner fingerprint confirmation, per-server dedicated key generation on the controller (public key returned with restrict,from=... line; private key never leaves the controller), first read-only check, rename/describe, disconnect (stop schedules, report remote revocation steps; never claim the remote key was removed). Hosts move from hosts.json to the store; hosts.json becomes a one-time import. Auth required. | FR-02/03/04 | todo |
| T-073 | Designer | Baseline compare + prepare-a-server UI (UX-09, UX 12): choose reference -> select conventions -> compare target -> review plan; Matches/Missing/Different by design/Conflict/Not checked; Mark intentional; exclusions statement | FR-09, FR-15 | in-progress |
| T-074 | Designer | Settings (UX-11, UX 13.2, 14): schedules (interval, daily time, timezone, pause, next run), AI & data (AI on/off, provider shown, retention), server access lifecycle and disconnect confirmation (names server, lists queued/active work, remote key revocation steps, never claims removal) | FR-19, FR-21, FR-03 | in-progress |
| T-075 | Designer | Empty overview (UX-02), compact list view for 6-20 servers with sort (UX 5.2) and saved preference, long-name/long-version/20-server stress fixtures, loading and API-down states audit across all screens | UX 5.2, 7.2, 18 | in-progress |
| T-076 | Coder | Findings API (FR-20): acknowledge, snooze (1 h/1 d/1 w), resolution evidence, dedup key, persisted in store; scheduler status (paused/delayed/unavailable) + pause/resume per installation | FR-19/20 | todo |
| T-077 | Coder | Activity/history API + export (FR-18): inspections and operations, filters, search; export readable report + JSON without secrets; persistent artifact with expiry | FR-18, FR-21 | todo |
| T-078 | Coder | Baseline API (FR-09/15): baselines from a reference observation (directories under /srv or home, selected packages), versioned; comparison states; exceptions ('mark intentional'); setup plan uses prepare.directories.v1 + package install planner; writes gated | FR-09/15 | todo |
| T-079 | Coder | Settings API (FR-19/21): schedule interval/daily time/timezone/pause, AI on/off (provider none), retention values shown from config | FR-19/21 | todo |
| T-080 | Designer | Swap each stub in apps/web/src/api/stubs/ for Coder's real client as T-069, T-076..T-079 land | — | todo |
| T-081 | Coder | Registration defects (test-report-registration-001): R-1 production tri-state yes/no/not_sure, not_sure treated as production everywhere; R-2 report privilege level using only 'sudo -n -l' (lists rules, runs nothing, never prompts), disclosed to the owner as a check in the connect flow; never 'sudo -n true' or any command as root (PRD: no hidden elevation attempt); report 'no sudo rules / passwordless sudo present / unknown' and warn when access is broad; D-R3 expire abandoned drafts on a timer and delete their private keys; plus the 2 Low items | FR-02/03 | todo |
| T-083 | Coder | Target helper BUILD ONLY (Tech Spec 7.2, 8): Python 3.12 restricted gateway + helper using only Ubuntu-packaged deps (python3-apt), fixed schema input over stdin, allowlisted operation IDs, signed manifest verification (local Ed25519 or RSA-PSS key on the controller in place of KMS until AWS; ADR), root-owned atomic operation ledger, transient systemd unit launch, query.operation.v1; reviewable bootstrap + uninstall scripts with sudoers validated by visudo -c; pytest suite incl. invalid signature, replay, digest mismatch, injection strings, symlink races. NOT installed on any real server. Container use allowed for unit tests only; results labelled as not proving APT/systemd behaviour. | Tech Spec 7.2, 8, M1 | todo |
| T-084 | Coder | Helper defects from test-report-helper-001: D-H1/D-H2 (crash on hostile or torn input -> typed rejection), D-H3 (bootstrap.sh root follows symlink -> no-follow, validate every path component), plus the 3 Low items. Still build-only. | Tech Spec 7.2, 8.3 | todo |
| T-085 | Coder + Designer | Found in founder's first real connect: registration scope was unset, so every Tailscale address failed with a vague "cannot be registered" error and no access key could be issued. Show a specific reason ("Tailscale/private network not enabled for ServrSit") and add the registration scope (controller address, enrolled routes) to Settings with a clear explanation; first-run setup should ask for it. | FR-02/03, UX 7.3 | todo |
| T-086 | Coder | Found in founder's first real connect: Sentani had Tailscale SSH enabled, which intercepts tailnet port 22 and asks for a browser check; the first check hung and reported a generic COLLECTION_FAILED. Detect the Tailscale SSH banner ("Tailscale SSH requires an additional check") and other interactive auth, fail fast with code TAILSCALE_SSH_ACTIVE and the fix ("sudo tailscale set --ssh=false" on the server), never follow the link. Also map plain publickey denial to AUTH_FAILED with "add the key line" guidance. | FR-02, Tech Spec 6.1 | todo |
| T-087 | Coder | Sentani test bench prep (ADR-021): (1) persistent Ed25519 manifest signing key on the controller (apps/api/.data, 0600, gitignored; ADR-020 step 2) and export of its public trust.json; (2) dedicated maintenance key for Sentani (separate from the inspect key) and a fixed installation id; (3) build the helper package + SHA-256 (packaging/build.sh) into a gitignored dist dir; (4) bootstrap.sh gains `--from <address>` so the forced-command key line is `restrict,from="100.104.220.8",command=...` (defense in depth, same as inspect keys); (5) one founder-facing script `scripts/sentani-helper-install.sh` that copies package + trust.json + bootstrap to Sentani with scp as the founder and prints the exact sudo command with --dry-run first; (6) a test-only CLI for Tester (tests/live/helper-cli) that signs a manifest with the controller key and sends it to Sentani's gateway. No change to writesEnabled; SshWriteTarget stays refusing. | Tech Spec 7.2, 8, M1 | todo |
| T-088 | Tester | Disposable-target gates on Sentani after the founder installs the helper: helper verification (bad signature, replay, digest mismatch, expired, wrong installation, unknown op), real APT transaction vs manifest under external apt activity, lock contention, held package, low disk; SSH cut pre/post acceptance and mid-dpkg with query-before-retry; reboot that returns and one that is delayed; uninstall. Sentani only (ADR-021). | FR-12/13/16/17, Tech Spec 20.2 | blocked on T-087 + founder |
| T-089 | Coder | Real SshWriteTarget behind a per-server writesEnabled flag settable only in controller config (never via API/UI); Sentani only, after T-088 passes; end-to-end FI suite through the app | Tech Spec 9.3 | blocked on T-088 |
| T-090 | Coder | Helper fixes from test-report-sentani-001: D-S5 arch matching (`:all` packages; compare by apt's own fullname rules), D-S6 needrestart must never restart services during apply.packages (set NEEDRESTART_SUSPEND=1 and/or NEEDRESTART_MODE=l for the commit; report "services that would need a restart" as a finding for a separate restart plan; test on Sentani), D-S7 noninteractive dpkg/debconf policy (DEBIAN_FRONTEND=noninteractive, keep the owner's modified conffiles with --force-confold and --force-confdef, and refuse at planning any transaction that would prompt or replace a modified conffile), plus D-S2 (f1.sh exit status). Bump helper version, rebuild package, update the install script; founder reinstalls. | Invariant 5, Tech Spec 10.2 | todo |
