# Handoff — Kiro Tester — Milestone M0

**Task:** T-009 — Build the acceptance test matrix  
**Branch:** `feat/tester/acceptance-matrix`  
**Date:** 2026-11-15  
**From:** Kiro Tester  
**To:** Kiro Orchestrator

---

## 1. Changed files

| File | What changed | Why |
|---|---|---|
| `docs/team/acceptance-matrix.md` | Created from scratch | Delivers T-009 acceptance criteria: maps every Stage A PRD §14 scenario, all Technical Spec §20.2 fault-injection scenarios, and all UX Spec §18 accessibility/usability checks to test entries with observable pass criteria |
| `docs/team/handoff-tester-m0.md` | Created from scratch | This handoff document |

---

## 2. Decisions made

**Zero-tolerance blockers defined (ZT-01 through ZT-06).** The PRD §12.2 "trust" measure names three conditions (unapproved writes, exposed credentials, false verified-success) that block all stage expansion. I added three additional blockers derived from the execution-security steering and Technical Spec §9.4 that have the same unconditional character: a second concurrent mutation without new approval, a model-generated string executing as a shell command, and fixture data shown without a `[FIXTURE DATA]` label. These are not new requirements — they restate existing invariants as explicit pass/fail gates. Any disagreement with these additions should be logged in `docs/decisions/decision-log.md` before the matrix is used in test runs.

**Evidence type "authorized-real-server" is restricted.** Only SA-001 (connecting the founder's real fleet) uses this evidence type. All other tests use fixture or disposable-vm. This matches the Technical Spec §20 and execution-security steering requirement that no fault injection or live maintenance occurs on Sentani, Nabire, or Timika until disposable-target gates pass.

**FI-016 and FI-017 duplicate SA-011 and SA-004 intentionally.** The fault injection suite is intended to be run as a standalone regression suite (T-030) in addition to the scenario suite (T-036). Duplicating the overlapping scenarios ensures neither suite has gaps.

---

## 3. Checks run

| Check | Result |
|---|---|
| All 15 PRD §14 Stage A scenario rows present and mapped | Confirmed: SA-001 through SA-015 cover every row in the PRD §14 table (Gate A column) |
| All UX Spec §18 usability tests covered | Confirmed: UX-001 through UX-006 map the named tests; UX-007 through UX-019 cover the remaining §18 required visual review, viewport, keyboard, accessibility, and label checks |
| All Technical Spec §20.2 fault-injection cases covered | Confirmed: FI-001 through FI-020 cover the named fault scenarios; each maps to a specific spec section |
| Zero-tolerance blockers present | Confirmed: ZT-01 through ZT-06 in the dedicated section |
| No test claimed as passing | Confirmed: all 68 tests show `not-started`; status summary table reflects this |
| `[FIXTURE DATA]` invariant captured as ZT-06 and UX-017 | Confirmed |
| No real-server evidence type used except SA-001 | Confirmed |
| Matrix does not reference any implementation — derived from specs only | Confirmed: matrix was written from PRD, Technical Spec, and UX Spec source documents |

**Matrix was not run against any implementation.** No implementation exists yet for most of these areas. The matrix is a planning artifact, not a test-run report.

---

## 4. Unresolved limitations and known gaps

**UX manual tests (UX-001 through UX-006) require real human participants.** These cannot be automated. They block the Stage A exit gate. Orchestrator should schedule usability recruitment when T-018 through T-022 (high-fidelity screens) are complete. Five participants minimum, including the founder.

**SA-001 (connect the founder's real fleet) cannot run until T-010 through T-014 pass.** This is the only test using `authorized-real-server` evidence. Its execution requires explicit founder authorization per the execution-security steering.

**FI-019 (stale backup restore) requires a second disposable test installation.** The test simulates restoring an older controller backup. This requires a full disposable controller environment, not just a disposable target VM. The test framework for this is not yet specified.

**NF-005 (perceived load time, p95 < 2 s) requires a live API and representative network.** This cannot be measured against fixtures. It becomes testable after T-023 (authenticated read-only API) completes.

**FI-014 (unexpected configuration behavior) requires a fixture .deb package.** This needs a crafted Debian package whose maintainer script produces an interactive prompt in a noninteractive environment. Coder should prepare this fixture as part of T-030.

**AI boundary tests (SA-013b, FI-020) require adversarial fixture packages.** These fixtures should be placed in `tests/fixtures/` with clear `[FIXTURE DATA]` labels. Coder or Tester should create them when T-008 (typed fixture snapshots) proceeds.

**Contrast ratio automation tool not yet selected.** UX-012 names "axe-core or equivalent." The final tool should be chosen and documented when T-024 (browser review) is set up. Playwright's axe integration is the recommended candidate.

---

## 5. Next dependent task

**T-036 — Stage A acceptance test run** depends on this matrix being complete (it is) and on T-030, T-031, T-032, T-033, T-034, and T-035 all completing first.

**T-024 — Browser review at all required sizes** (Tester task, M2) uses the UX tests in Section 3 of this matrix directly. It can begin after T-018 through T-022 complete.

**T-030 — Failure injection test suite** (Tester task, M3) uses Section 2 (FI tests) directly. It requires T-027 and T-028 to complete first.

**Immediate next step for Orchestrator:** Merge this branch when satisfied and update T-009 status to `done` in `docs/team/task-board.md` with evidence pointing to `docs/team/acceptance-matrix.md`.

---

## Test Report

**Feature / Change:** T-009 — Build acceptance test matrix  
**Spec reviewed:** PRD §14, Technical Spec §20.1–20.2, UX Spec §18  
**Implementation reviewed:** None — this task produces a planning artifact, not tests against an implementation

### Result: PASS (planning deliverable complete)

### Tests written
- `docs/team/acceptance-matrix.md` — 68 test entries covering all Stage A scenarios, fault injection, UX/accessibility, and non-functional checks

### Spec conformance
- [PASS] All Stage A PRD §14 scenarios mapped — 15 entries (SA-001 through SA-015)
- [PASS] All Technical Spec §20.2 fault injection scenarios covered — 20 entries (FI-001 through FI-020)
- [PASS] All UX Spec §18 usability and visual acceptance checks covered — 19 entries (UX-001 through UX-019)
- [PASS] Zero-tolerance blockers section present — 6 entries (ZT-01 through ZT-06)
- [PASS] Non-functional checks included — 8 entries (NF-001 through NF-008)
- [PASS] All entries show `not-started`; none claimed as passing
- [PASS] Evidence type `authorized-real-server` restricted to SA-001 only
- [PASS] Traceability index maps all tests back to FR-*, Tech Spec §§, and UX Spec §§

### Defects found
None — this is a planning deliverable with no implementation to test against.

### Regressions
Not applicable — no test suite existed before this task.

### Recommendations
1. Merge `feat/tester/acceptance-matrix` to `main` (Orchestrator action).
2. Update T-009 status to `done` in `docs/team/task-board.md`.
3. When T-017 through T-022 complete, begin UX-010 through UX-019 immediately — these provide early design feedback without infrastructure.
4. Schedule five usability participants (UX-001 through UX-006) for when high-fidelity screens are ready.
5. Confirm with Coder that adversarial fixture packages for FI-020 and SA-013b will be created as part of T-008.
6. Confirm with Orchestrator whether ZT-04 through ZT-06 (additional zero-tolerance blockers beyond the PRD's three) are accepted — if any need narrowing, update the matrix before T-036.
