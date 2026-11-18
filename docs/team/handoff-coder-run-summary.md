# Coder run summary (T-050 … T-083)

**Branch state at the end of this run:** `integration/next`, which includes the Designer's `feat/designer/t080` (care-client swap and review pack 002, `c2588c4`) and T-084 (helper fixes). `integration/live-v1`, the founder's running app, still has only the pre-login work (see "Where it is").

**The detailed record per task, with real output,** is in `docs/team/handoff-coder-live.md`. This file is the overview.

## Last checks (after T-084)

```
pnpm -r --workspace-concurrency=1 run test   exit 0
  api 242, web 215, ai 156, ssh 61, store 28, domain 22, worker 19, infra 9, target-helper 66 (unittest)
Tester's helper suite (tests/helper, run against this tree): 123 passed, 3 failed (H00 pin, H04b strict xfail now passing, H44 static pattern moved)
typecheck: all 9 TypeScript packages exit 0            web build: ok (vite)
Tester suites @1c9d5a7 (temporary copy, nothing of theirs committed):
  auth 37/37, auth-t066 12/12, auth-extra 21/21, routes-401 7/7, care-loop 41/42 (CL-09a: their binding lacks the T-059 kinds)
  zt01-real-hosts 13/13 with the 22 new mutating routes added to its reviewed list; 12/13 as committed (needs the Tester's review)
```

## What each task delivered

| Task | Delivered | Where it is |
|---|---|---|
| T-050 | Owner-context file for the assistant (secret-checked, size-bounded, reloaded on change). | live-v1, next |
| T-051 | Fact check of AI answers against the checks; a mismatch falls back to the checks. | live-v1, next |
| T-053 | Local owner login: password plus mandatory TOTP, server-side sessions, CSRF and Origin guard on every `/api` route (ADR-017). | next only (ADR-018) |
| T-061 | Target clock skew measured per check; APT stamp corrected for skew. | live-v1, next |
| T-062 | Updates from outside Ubuntu's archive (for example Docker) listed separately and left out of plans. | live-v1, next |
| T-063 | ServrSit checks its own clock (HTTPS Date plus target agreement). An untrusted clock blocks planning and approval. | live-v1, next |
| T-064 | Tester's AI findings F1–F5 and O1: secret detector, cut-off replies, fact-check precision and recall, tone check, guarded explainer. | live-v1, next |
| T-066 | Login defects D-A1..D-A4: per-source and account locks that survive a clock step, enrolment refused while the clock is untrusted. | next only |
| T-054–T-059 | Care-loop gaps: approval-time re-check, stop request and reconcile, canonical identity (host key plus machine id), two production acknowledgements, typed route errors and worker backoff, restart / reboot / prepare-directories kinds. | live-v1, next |
| ADR-019 | `integration/next` = live-v1 + owner-auth + server-registration, conflicts resolved once. | next |
| T-069 | Server registration: drafts, address policy (Tech Spec 6.2) with DNS rechecks, host-key scan with the owner confirming the fingerprint, one key per server (only its public line returned), first read-only check, activate, rename, disconnect (never claims the remote key is gone). Registry replaces hosts.json after a one-time import. | next |
| T-076 | Findings: one record per issue; acknowledge and snooze (never resolve); resolution only by a check that covered the issue; "not-rechecked" otherwise. Scheduler status, plus pause and resume that persist. | next |
| T-077 | Activity history (operations, findings, health checks) with filters and search. Exports built on the server, scrubbed, expiring after 7 days. | next |
| T-078 | Baselines from an on-demand read-only inventory: versioned, with comparison states, intentional exceptions with history, and setup plans for missing directories through the normal planner. | next |
| T-079 | Settings: schedule interval and time zone, pause, AI on/off (stops model calls at the next message), retention shown, server access, disconnect preview. | next |
| T-081 | Registration fixes: production yes / no / not sure (not sure is treated as production); the disclosed `sudo -n -l` privilege check in the first check only; timed sweep of abandoned drafts and their keys; duplicate shown first when re-registering; no path echo for long ids. | next |
| T-082 | Real care client in the web app: plans of every kind, revisions, approvals with CSRF and an idempotency key, operations, stop request, reconcile. | next |
| T-083 | Target helper (Python): gateway, root helper, transient runner, signed-manifest checks (ADR-020), atomic root-only ledger, adapters, bootstrap and uninstall with `visudo` checks. | next |
| T-084 | Tester's helper-001 defects fixed: atomic first claim and fail-closed unreadable records (D-H2); the key line written and removed only as the account, never by root inside its home (D-H3); clean refusal of huge integers (D-H1); sudoers template and key scripts inside the verified package (D-H4); uninstall stops on unfinished work (D-H7); duplicate JSON keys refused (D-H5); emptiness checked by listing (D-H6); 30-minute cap on the acceptance window (O-1). | next |

Each task also has a web client in `apps/web/src/api/` matching the Designer's stub (T-069, T-076 to T-079, T-082), and each new API is guarded by the login (T-053).

## Build-only (exists and is tested, never used on a real server)

- **The target helper** (T-083, T-084). It is not copied to, installed on or run on any server. The tests use a fake system: no APT, no systemd, no reboot, no sudo. So nothing yet proves APT, systemd or reboot behaviour.
- **Every write path in the care loop** (T-048, T-054 to T-059, T-078 setup plans). Approvals and dispatch run only against in-process `[SIMULATED]` targets.
- **The manifest signer.** The key lives in memory; there is no persistent controller key yet (ADR-020).

## Gated (hard limits that hold now)

- **Writes on real servers:** `writesEnabled` can only be false. Configuration, the registry database (CHECK constraint) and the API all refuse true. Every real-server plan is blocked with `WRITES_DISABLED`, and the SSH write target refuses every write.
- **Helper installation:** waits for the founder's acceptance (D-HELPER-01) and the disposable-target gate (T-012). The four real servers stay off-limits for fault injection and live maintenance.
- **Login on the founder's running app:** T-053 and T-066 merge into `integration/live-v1` only after ADR-018's conditions (Merauke's clock fixed).
- **AWS, KMS, domain and DNS:** not authorised (D-AWS-01, D-DOMAIN-01). Keys are local files, signing is local Ed25519.
- **Contact with real servers:** registration's TCP probe and key scan, the first check, the baseline inventory, and the `sudo -n -l` check are all read-only, and all run only when the owner asks. None of them has been run against the founder's servers in this run.

## Known gaps and open items

- **Package installation from a baseline** has no operation (`install.packages.v1` is missing). Setup plans list missing packages as not included. Adding it is a new write capability and needs its own task.
- **`plan.packages.v1` (the package preview on the target) is not built.** Its precondition digest must equal the helper's `digest_of({"installed": …})`.
- **The controller side of the helper protocol is missing:** no persistent signing key, no SSH write target that speaks submit and query.
- **T-012 must also prove** `runuser` for the key step, and the D-H3 planted-link case run as root.
- **No separate daily deeper check.** The daily time in settings is stored but not used (`dailyTimeInEffect: false`).
- **Registration:**
  - R-5: disconnect is still refused while work is unresolved; the preview lists that work.
  - Machine-id identity (T-056) applies to care, but registration duplicates use address+port and host key only.
- **`ssh` resolves names itself** after the address policy. The pinned host key is the backstop.
- **Founder configuration:**
  - To register the Tailscale servers, `hosts.json` needs `registration.enrolledRoutes` (for example `100.64.0.0/10`) and `registration.controllerAddress`.
  - A schedule saved in Settings takes priority over `hosts.json`.
- **Tester follow-ups:**
  - Helper suite: re-pin H00 to the T-084 commit, turn H04b into a plain test, and point H44's removal check at `account-remove-key.sh`.
  - Add the 22 reviewed mutating routes to ZT-01.
  - Their `feat/tester/server-registration` care-loop and auth files predate T-057 and T-066 (6/41 and 36/37 on any recent tree).
  - Registration bindings must inject `servers.privilegeProbe`, or the default runs real `ssh`.
- **Designer follow-ups:**
  - Offer "Not sure" with `productionStatus`.
  - Show `PRIVILEGE_CHECK.disclosure` before the first check, and the privilege summary after it.
- **Process note (T-081):** one local test run, before the privilege-probe hook existed, started `ssh` toward the synthetic test addresses `100.101.102.103` and `100.101.102.104` with throwaway keys that no server knows. No real server was involved. Every test injects the probe now.
- **Environment:**
  - pytest is not installed on Merauke and pip from the internet is not allowed, so the helper tests use unittest (pytest can collect them).
  - No container runtime is available without sudo.
