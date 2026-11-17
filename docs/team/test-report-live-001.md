# Test Report — Live read-only inspection (T-037, T-038, T-039)

**Tester:** Kiro Tester  
**Date:** 2026-11-17 (UTC)  
**Branch / worktree:** `feat/tester/live-check` at `/projects/servrsit-tester`, based on `feat/coder/live-inspection` (`f83fdf5`)  
**Spec / authority reviewed:** `docs/team/acceptance-matrix.md`, `docs/team/handoff-coder-live.md`, ADR-012 and ADR-011 in `docs/decisions/decision-log.md`, `.kiro/steering/execution-security.md`  
**Method:** Handoff not trusted. Every claim below was reproduced or marked NOT RUN.

## Result: PARTIAL

The live read-only path behaves as the handoff describes and I found no safety violation. Two product defects and several gaps need attention. The most important are D1 (the test suites fail on a clean checkout) and D3 (`/api/fleet` returns live data with no authentication, a known stub). Several matrix items could not be run, and each is listed as NOT RUN with the reason.

### Safety record for this pass

| Rule from the brief | What happened |
|---|---|
| Never SSH to Sentani or Timika | **No SSH from me to any host.** Both are `collect:false` in `apps/api/config/hosts.json`. The API only read the pinned-file text for them. Logs for runs A, B, C show check events for Nabire/Merauke only (run D, fixture mode, has none). |
| Nabire contacts ≤ 3 (via the API collector only) | **2 used.** See the contact ledger below. |
| No sudo, no server writes | No sudo used. No write route exists on the API (see ZT-01). |
| Do not modify production source | `git status` shows only `tests/` is new. Nothing under `apps/`, `packages/`, `infra/` was edited. Build output (`dist/`) and the gitignored `.data/` were created, nothing tracked changed. |

**Contact ledger (Nabire, through the API collector)**

| # | Run | Time (UTC) | Outcome |
|---|---|---|---|
| 1 | A — normal pinned file | 09:51:05.997 | `ok`, 15/15 checks, 1325 ms |
| 2 | B — one base64 character altered in the worktree copy of the pin | 09:55:12.487 | `HOST_KEY_CHANGED`, `contacted:true`, `retryBlocked:true` |
| — | C (no pins, AI unavailable) and D (fixture mode) | — | 0 contacts, by design (not pinned / fixture) |

Caveat: Coder's own API instance was already listening on port 3001 (pid 520733). Its 15-minute timer can contact Nabire independently of my budget. I did not count or control that.

**Incident I caused, disclosed.** Two of my launches did not go to plan. (1) First launch failed at transform time (CJS vs top-level await), before any server code ran. The log showed 0 check events, so no host was contacted. (2) After run A, Ctrl+C killed my `tee`, and the API process stayed alive with a dead stdout pipe. Its 15-minute timer would have fired at about 10:06 and contacted Nabire outside my plan. I noticed at 09:54, closed the pane and force-killed the process with SIGKILL (idle local process, no remote effect). It never reached 10:06. Details under D4.

---

## 1. Unit and typecheck results (verbatim counts)

Environment: Node `v24.22.3`, pnpm `12.21.0` (found under `~/.local/node24/bin`, which is not on the default PATH).

### 1a. Clean checkout, as the handoff says to run it (`pnpm install`, then `pnpm test`)

```
packages/ssh:  ℹ tests 40  ℹ pass 40  ℹ fail 0
packages/ai:   ✖ src/kiro.test.ts            ℹ tests 1  ℹ pass 0  ℹ fail 1
apps/api:      ✖ findings / service / status / routes fleet.test.ts   ℹ tests 4  ℹ pass 0  ℹ fail 4
packages/contracts: no "test" script (pnpm test prints nothing)
typecheck: contracts exit 0, ssh exit 0, ai exit 2, api exit 2
```

Cause (from the actual error, not assumed):

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/projects/servrsit-tester/packages/ai/node_modules/@servrsit/ssh/dist/index.js' imported from .../packages/ai/src/input.ts
src/kiro.ts(20,52): error TS2307: Cannot find module '@servrsit/ssh' or its corresponding type declarations.
```

`@servrsit/ssh` and `@servrsit/contracts` resolve through `dist/`, which is gitignored and unbuilt in a fresh worktree. `packages/ai` and `apps/api` have no `pretest`/`pretypecheck` build step (`apps/api` only has `predev`/`prebuild`). → **D1**.

### 1b. After `pnpm --filter @servrsit/contracts --filter @servrsit/ssh run build`

```
packages/ssh:  ℹ tests 40  ℹ pass 40  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
packages/ai:   ℹ tests 21  ℹ pass 21  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
apps/api:      ℹ tests 38  ℹ pass 38  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
typecheck:     packages/ai exit 0, apps/api exit 0
```

These match the handoff's counts (40, 21, 38) once the dependencies are built. No tests are skipped. I checked beforehand that the suites use injected fake runners and never call real SSH or the real Kiro service (the hosts in `collect.test.ts` are only names). `local.test.ts` does run the real collector on the local machine.

| Check | Result |
|---|---|
| Handoff test counts reproduce | **PASS** (after build) |
| Tests pass on a clean checkout | **FAIL** (D1) |

---

## 2. API live run (port 3002, runs A, C, D)

`apps/api/src/index.ts:8` hardcodes `PORT = 3001` with no environment override (D2). I did not edit it. I wrote a test-only launcher, `tests/live/serve-3002.mts`, which calls the same `buildServer()` and listens on `127.0.0.1:3002`. Consequence: **`index.ts` itself was never executed by me**, so the handoff's claim about its shutdown path is unverified (see NOT RUN list).

### Commands and results (run A, pinned file intact)

```
$ curl -sS -i http://127.0.0.1:3002/health
HTTP/1.1 200 OK   {"status":"ok","timestamp":"2026-11-17T09:51:18.442Z"}

$ curl -sS http://127.0.0.1:3002/api/fleet     # 200, 5218 bytes, mode "live"
Timika   source=live status=collection-disabled  reason="No usable SSH key is configured for this host on the controller yet."  observedAt=null
Nabire   source=live status=fresh  observedAt=2026-11-17T09:51:05.997Z  freshUntil=10:21:05.997Z  coverage 15/15  attempt ok
Sentani  source=live status=collection-disabled  (same reason)  observedAt=null
Merauke  source=live status=fresh  observedAt=2026-11-17T09:51:06.687Z  coverage 15/15  attempt ok
generatedAt=09:51:18.455Z  nextCheckAt=10:06:06.688Z
```

| Requirement from the brief | Evidence | Result | Matrix |
|---|---|---|---|
| Nabire `source=live`, fresh `observedAt` | Age 12.5 s at response. `freshUntil − observedAt = 30 min` (two 15-min intervals). `durationMs 1325`. | **PASS** | FR-06, SA-001 (Nabire only) |
| Merauke `source=live`, dev host | `access:local`, `role:"Dev host"`. Facts match my own commands: hostname `merauke`, boot ID `fdd6f28c-…`, MemTotal `16168668 kB`, 4 CPUs, no reboot-required, held=1 / pending=0 (also `apt-get -s`: "1 not upgraded"). Uptime differs only by the 28 s between collection and my check. | **PASS** | SA-001, FR-05 |
| Sentani/Timika never "checked/healthy" | Both `collection-disabled`, `observedAt:null`, `coverage:null`, `observation:null`, explained reason. With an empty pin file (run C) all three SSH hosts became `unverified-host`: "The host was not contacted", no `ssh` process spawned, no check events. | **PASS** | FR-06, execution-security #13 |
| No `PRIVATE KEY`, `id_ed25519`, `/.ssh/` in any response | Literal greps on `/api/fleet` body: **0, 0, 0**. Wider scan (`tests/live/leak-scan.sh`: also `.ssh`, `identityFile`, `BEGIN OPENSSH`, `/home/spotty`, `SESSION_SECRET`, AWS key shape) on bodies and headers of runs A, B, C: **CLEAN**. No `Set-Cookie` header on `/health` or `/api/fleet`. | **PASS** | ZT-02 |
| Server logs free of secrets | Scan of the runs' logs: one hit, `SESSION_SECRET` on the startup warning line. I checked the line: it names the variable and says it is unset. The dev default literal never appears in any log (count 0). False positive. | **PASS** | ZT-02 |

**Latency (NF-005, indicative only):** 20 cached `GET /api/fleet` over loopback: min 1.0 ms, median 1.3 ms, p95 1.7 ms, max 2.0 ms. This is loopback, not the "typical broadband browser" the matrix specifies. The result is **PASS (indicative)**, not a closed NF-005. A single-sample inspection took 1.3 s (Nabire) and 0.67 s (Merauke): **NF-006 NOT RUN** (needs ≥100 runs at up to 350 ms RTT).

### Authentication, CORS, routes (run A)

| Check | Output | Result | Matrix |
|---|---|---|---|
| Unauthenticated `GET /api/fleet` | `HTTP 200` with full host data | **FAIL** (D3, known stub) | NF-001, FR-01 |
| Hostile `Origin: http://evil.example` | `access-control-allow-origin: http://localhost:5173` (not reflected) | **PASS** | FR-01 |
| `POST/PUT/DELETE /api/fleet`, `GET /api/plans`, `POST /api/plans/x/approvals` | all `404` | **PASS** (no write or approval surface exists yet) | ZT-01, FR-11 |

### Fixture mode (run D, `SERVRSIT_FLEET_MODE=fixture`, no contact)

`mode:"fixture"`, 4 servers, every `source:"fixture"`, 0 live sources, literal `[FIXTURE DATA]` in the body, 0 check events, no `ssh` process. **PASS** for ZT-06 at the API. One hazard: fixture and live responses reuse the **same UUIDs** for the same names while asserting different states (fixture Sentani `unreachable`, Timika `fresh`; live both `collection-disabled`). → **D5**.

---

## 3. Negative / freshness checks

### 3a. Host-key change (run B) — counts as Nabire contact #2

Setup: in my worktree copy of `known_hosts` only, changed one base64 character at index 40 of the Nabire key (length unchanged). `ssh-keygen -l` still parsed it as a valid ED25519 key with a different fingerprint, so this is a genuine mismatch rather than a parse error. Original and copy matched by SHA-256 before the change (`f8eb5647…`).

```
{"host":"Nabire","code":"HOST_KEY_CHANGED","contacted":true,"retryBlocked":true,"msg":"check failed"}
Nabire status=host-key-changed  observedAt=null  coverage=null  observation=null
reason="The host key no longer matches the pinned key. Inspection is blocked until it is reverified."
attempt: succeeded=false, consecutiveFailures=1
Merauke unaffected: status=fresh
```

- Connection refused with the specific code, no data shown as fresh, no observation retained. **PASS** (SA-004, FR-02, FR-06).
- No fingerprint, expected/offered key or `known_hosts` text appears in the response or log (0 matches). **PASS** (ZT-02).
- Restored afterwards. SHA-256 of the restored file again equals Coder's copy (`f8eb5647…`, 2 identical hashes).
- Why I believe no login attempt reached Nabire: `StrictHostKeyChecking=yes` aborts at host-key verification before user authentication. That is OpenSSH behaviour I expect, not something I observed on the server. I have no Nabire-side log.
- **Limits of this evidence:** (i) The tamper was on the controller's pin, so no fault was injected on any server. The matrix's evidence type for SA-004 is `disposable-vm`, so this is **indicative, not a closed SA-004**. (ii) The process had no earlier successful observation, so the "failed attempt shown alongside last good, labelled historical" path was not exercised live. Unit tests cover the logic (9 pass, including "failed latest attempt wins over older success", "fresh within two intervals; stale just after", "fresh but incomplete coverage is partial"). Live stale transition: **NOT RUN** (needs >30 min and further Nabire contacts).
- Observation: a changed host key produces `findings: []`. The status carries the message, but no finding is raised.

### 3b. APT/dpkg untouched by the local collector (ZT-01 support)

Marker file, then three real `collectLocal()` runs, then `find /var/lib/apt /var/lib/dpkg /var/cache/apt -newer marker`: **0 files**. Control (`find -newer` in `/tmp`) detected its change. Result: `{"ok":true,"pending":0,"held":1}` each time. **PASS with a limit:** I run as an unprivileged user and could not have written to those paths anyway, so this shows "no observable change", not proof by design.

---

## 4. AI

| Check | Command / evidence | Result | Matrix |
|---|---|---|---|
| Coder's injection tests | `tsx --test --test-name-pattern=… src/kiro.test.ts` → 8 selected, **8 pass, 0 fail** | **PASS** | FI-020 |
| My independent probe (`tests/live/ai-probe.test.mts`) | 7 tests, **7 pass**. Payloads written by me, applied to every free-text field of a real Merauke snapshot: no marker rises above the fixed template's own count; `PWNED-T1…T10` never reach the prompt; no credential/path strings in the prompt; `kiro-cli` argv is a fixed array with `--trust-tools` and the prompt as a single argument; three command-style replies (`APPROVED. Run: sudo…`, a fenced `sudo reboot`, `$ rm -rf /`) are all refused and replaced by deterministic text. | **PASS** | FI-020, ZT-02, ZT-05 |
| AI unavailable, real spawn path | `KiroExplainer({kiroBinary:"/nonexistent/path/kiro-cli"})` → `status:"ai_unavailable"`, `source:"deterministic"`, reason set, no throw | **PASS** | SA-013(a), FR-08 |
| Hostile server data → real findings generator → fallback | Hostile hostname/OS/mount/unit names through `evaluateFindings`, then the fallback: none of `rm -rf`, `curl `, `\| sh`, `$(`, backtick, `NEW INSTRUCTIONS`, `APPROVED`, `PWNED-T7/8/9` appear | **PASS** | SA-013(b), FI-020 |
| `/api/fleet` unaffected when `kiro-cli` is unavailable | Run C with `KIRO_CLI_PATH=/nonexistent/kiro-cli` and a minimal PATH: `/api/fleet` 200, `/health` 200 | **PASS, but trivially** | FR-08 |
| One AI call through the API | **No endpoint exists.** `grep` shows nothing in `apps/` imports `@servrsit/ai`. | **NOT RUN** | NF-007, SA-013 |

Notes:

- **The run-C result proves nothing about coupling.** The API has no AI code path today, so AI failure cannot affect it. It becomes a real test only once an explain route exists.
- **The "make kiro-cli unavailable via PATH" approach would not have worked.** The adapter defaults to an absolute path (`~/.local/bin/kiro-cli`, `kiro.ts:27`), so PATH is irrelevant. Only `KIRO_CLI_PATH` or the `kiroBinary` option disables it. I used those.
- **My first probe run failed once, and the fault was in my test.** It put `curl` into a finding summary I had fabricated, which the product cannot generate from server data. The generators only interpolate names that pass `isSafeMountPath` / `isSafeUnitName` + `nameValid`. I rewrote the test to use the real generator. The deliberately allowed pass-through is a syntactically valid hostile-looking unit name (as a name only), as the handoff documents.
- **No real Kiro call was made by me** (metered service untouched).

---

## 5. Web mockup (`http://100.104.220.8:5173/`, Designer)

| Check | Evidence | Result | Matrix |
|---|---|---|---|
| HTTP 200 | `GET / → 200 (763 bytes)`, `text/html` | **PASS** | — |
| All served modules load | Crawled the module graph from `/src/main.tsx`: **24 `/src` modules, all 200**, none 500 | **PASS** | — |
| No Vite errors in pane `w1:p5` | 274 lines of scrollback: two `Internal server error` entries at 5:51 (JSX syntax errors in `AttentionColumn.tsx`, `RecentActivity.tsx`), both followed by successful HMR updates of the same files (5:51:31, 5:59, 6:00). No current error. | **PASS** (two transient mid-edit errors, recovered) | — |
| Fonts served as `font/ttf` | `Silkscreen-Regular.ttf` 32,220 B and `Silkscreen-Bold.ttf` 30,632 B: `200`, `Content-Type: font/ttf`, `file` reports TrueType | **PASS** | UX-010 (partial) |
| `[FIXTURE DATA]` in served source | Literal in `FixtureBanner.tsx`; rendered by `OverviewScreen` (`jsxDEV(FixtureBanner…)`, first child), `role="status"`, no `aria-hidden`. Its description text is `display:none` only at ≤767 px, replaced by an `sr-only` sentence. The `[FIXTURE DATA]` label stays visible. | **PASS** (page-level) | UX-017, ZT-06 |
| Per-card fixture/live badge | `ServerCard` contains no `FIXTURE`/`LIVE` text (counts 0/0). Matches the handoff's note that T-040 will add it. | **GAP** (pending T-040) | UX-017 |
| Spec fonts Bricolage Grotesque, Geist Sans, Geist Mono | Named 5/15 times in the served `tokens.css` font stacks, but no `@font-face` or font files exist (the one `@font-face` hit in `tokens.css` is a comment). Only Silkscreen is declared, in `fonts.css`. Pixel titles and server names are founder-directed (`ux-feedback-001.md` lines 35–36). The body and data fonts remain system fallbacks. | **FAIL** against UX Spec §4.1 / T-017 (D6) | UX-010 |
| Screenshots at 1440×900 and 390×844 | `pnpm dlx playwright install chromium` **succeeded** (Chrome Headless Shell 159.0.8154.6). **Launch fails:** 9 shared libraries missing (`libatk-1.0`, `libatk-bridge-2.0`, `libatspi`, `libXcomposite`, `libXdamage`, `libXfixes`, `libXrandr`, `libgbm`, `libasound`), exit 127. Installing them needs `sudo apt`, which I may not use. | **NOT RUN** | UX-010…UX-016 |

No screenshots exist, so **no claim about visual correctness, contrast, focus, zoom, reduced motion or layout at any viewport is made.** The checks above are source-level and HTTP-level only. Playwright's browser cache is at `~/.cache/ms-playwright` (outside the repo). A person with sudo can run `playwright install-deps chromium` and the screenshot step can then proceed.

---

## 6. Matrix mapping (summary)

| Matrix ID | Status after this pass | Basis |
|---|---|---|
| SA-001 Connect fleet | **PARTIAL** | Nabire + Merauke live and independently checked. Sentani/Timika not collected (no key). Roles still null. Not run on all three. |
| SA-002 Laptop closed | NOT RUN | |
| SA-003 Private network outage | NOT RUN | Would need a fault on a real route; prohibited. |
| SA-004 Host-key change | **PASS (indicative)** | Controller-side tamper only. Disposable-VM evidence still required. |
| SA-005 No sudo | NOT RUN | Collectors never use sudo, but a no-sudo host case was not exercised. |
| SA-013 AI unavailable / malicious text | **PASS (a); PASS at the prompt+fallback boundary (b)** | Synthetic payloads. Disposable-VM package-description path not run. |
| FI-020 Malicious output | **PASS** | Coder's 8 + my 7 tests (fixture evidence). |
| FR-06 Freshness | **PASS (indicative)** | Live fresh window and `nextCheckAt` correct. Stale transition live: NOT RUN (unit tests only). |
| ZT-01 Unapproved write | **No violation observed** (not closed) | No mutation route exists. Collector does not alter APT/dpkg state. |
| ZT-02 Exposed credentials | **No violation observed** | Scans on all bodies, headers, logs and the model prompt. |
| ZT-03 False verified-success | NOT RUN | No operations exist yet. |
| ZT-04 Concurrent mutation | NOT RUN | No mutation path. |
| ZT-05 Model text executed | **No violation observed** | Fixed argv, replies refused, no execute-from-AI path. |
| ZT-06 Unlabelled fixture data | **No violation observed** | API labels in both modes. Page banner present. Per-card badge pending (T-040). Same-ID hazard (D5). |
| NF-001 Unauthenticated 401 | **FAIL** | D3. |
| NF-002 Cookie attributes | NOT RUN | No session is ever issued (`saveUninitialized:false`, no `Set-Cookie` seen). Config reads `secure: !isDev`. |
| NF-005 Fleet load p95 | **PASS (indicative, loopback)** | |
| NF-006 Inspection ≤30 s | NOT RUN (1 sample: 1.3 s) | |
| NF-007 Chat assent | NOT RUN | No endpoint. |
| UX-010…UX-016, UX-018, UX-019 | NOT RUN | No browser. |
| UX-017 | **PARTIAL** | Page banner present, per-card badge absent. |

Zero-tolerance blockers: **none triggered in the runs I performed.** That is not the same as closed. ZT-01, ZT-03 and ZT-04 are only meaningful once mutation exists.

---

## 7. Defects

| ID | Severity | File:Line | Description | Repro |
|----|----------|-----------|-------------|-------|
| D1 | **Medium** | `packages/ai/package.json` and `apps/api/package.json` (`test` scripts); `packages/ssh/package.json` (`main: ./dist/index.js`) | Tests and typecheck fail on a clean checkout. Workspace deps resolve to gitignored `dist/`. `apps/api` has `predev`/`prebuild` but no `pretest`/`pretypecheck`; `packages/ai` has none. The handoff reports "all passing" and says plain `pnpm install` works, which is true only if `dist/` already exists. | Fresh worktree: `pnpm install && (cd packages/ai && pnpm test)` → `ERR_MODULE_NOT_FOUND`; `(cd apps/api && pnpm test)` → 4 of 4 files fail; `pnpm typecheck` → TS2307. Passes after `pnpm --filter @servrsit/contracts --filter @servrsit/ssh run build`. |
| D2 | **Low** | `apps/api/src/index.ts:8` | Port is hardcoded `const PORT = 3001;`, with no environment override. Two instances cannot coexist (Coder's was already listening on 3001). I used a test launcher to run on 3002. | Read `index.ts:8`; `ss -ltn` showed pid 520733 on 127.0.0.1:3001. I did **not** execute `index.ts` to observe the bind failure, so the failure mode is inferred from the code (`listen` error → `Failed to start server`, exit 1). |
| D3 | **High (known stub, mitigated by loopback bind)** | `apps/api/src/auth/stub.ts`; `apps/api/src/server.ts:108` | `GET /api/fleet` returns full live observations (boot IDs, mounts, uptime, package counts, failure reasons) to any unauthenticated caller. Handoff says "do not expose beyond localhost". Currently bound to `127.0.0.1` only. It must not be reachable from the tailnet or the web mockup's host until T-023 lands. | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/api/fleet` → `200`. Matrix NF-001 expects 401. |
| D4 | **Low (observed, not isolated)** | `apps/api/src/index.ts:14-27` (shutdown path); my launcher mirrors it, and `index.ts` itself was not run | A process whose stdout/stderr pipe lost its reader (`tee` killed by Ctrl+C) did not exit on SIGINT or SIGTERM; it sat idle (state `S`, no CPU) with a live timer. With output redirected to a file, SIGTERM exits cleanly in about 1 s (runs B, C, D: `closed cleanly`). I could not tell whether the product's handler or the dead pipe caused the hang. | Run launcher as `… 2>&1 \| tee f`, then Ctrl+C in that terminal: port closes but the process survives SIGTERM. Needs a controlled repro against `index.ts` itself. |
| D5 | **Low–Medium** | `apps/api/src/fleet/fixture.ts:29` (`id: host.id`) | Fixture mode reuses the **live host UUIDs** and real host names, while asserting invented states (fixture: Sentani `unreachable`, Timika `fresh`, Nabire `partial`; live: Sentani/Timika `collection-disabled`, Nabire `fresh`). Anything keyed by `id` can blend the two. The `source:"fixture"` label mitigates it. | Compare `id` for each name in `/api/fleet` between fixture and live modes: all four equal. |
| D6 | **Medium (UX-010 will fail)** | `apps/web/src/tokens.css` (font stacks), `apps/web/src/fonts.css` | Bricolage Grotesque, Geist Sans, Geist Mono are named in stacks but never shipped: no `@font-face`, no files under `public/fonts/`. UX Spec §4.1 and T-017 require pinned assets served by the app. Body, data and display text render in system fallbacks. Silkscreen (founder-directed for titles and names) is served correctly. | `curl http://100.104.220.8:5173/src/tokens.css?direct \| grep -c '@font-face'` → the one hit is a comment; `ls apps/web/public/fonts` → `silkscreen` only. |

### Observations (not defects)

- **O1.** Every live card carries `source:"live"`, including cards with no data (`collection-disabled`, `unverified-host`). Coder's decision #7 already flags this. The status field keeps them non-healthy, but a UI that badges on `source` alone would say "LIVE" for an unchecked host.
- **O2.** `HOST_KEY_CHANGED` shows as a status but raises no finding (`findings: []`).
- **O3.** The deterministic fallback echoes `statusReason` and finding summaries. This is safe today because the generators interpolate only validated names. The safety depends on those validators staying in place.
- **O4.** Coder's handoff says the Kiro timeout (20 s) is shorter than two observed latencies (21.7 s, 11.4 s). I did not test this (no real call).
- **O5.** Two transient Vite syntax errors occurred in the Designer's pane during edits and recovered. They are not a defect now.

---

## 8. NOT RUN, with reasons

| Item | Reason |
|---|---|
| `apps/api/src/index.ts` as the entry point (including its own SIGTERM path) | Port 3001 is occupied and hardcoded. I ran a launcher instead (D2). |
| Live stale transition (30 min), live failed-after-success path | Needs >30 min and more Nabire contacts than the budget leaves. Unit tests cover the logic. |
| Sentani, Timika live collection | Forbidden for this pass, and no key exists. |
| API AI endpoint call | No such endpoint. |
| Screenshots, contrast, keyboard, zoom, reduced-motion, layout | No launchable browser without sudo (9 libraries). |
| NF-002, NF-006, NF-007, NF-008, SA-002, SA-003, SA-005, ZT-03, ZT-04 | No applicable surface yet, or requires a disposable VM or faults on real hosts. |

## 9. Regressions

None detected. After building the two dependency packages, the three suites reproduce Coder's counts exactly (40, 21, 38). No pre-existing test failed.

## 10. Recommendations for Orchestrator

1. **Send D1 to Coder.** Add `pretest`/`pretypecheck` builds (or point workspace `exports` at `src` in dev). Until then a Tester or CI run on a clean tree fails. Re-verify with a fresh worktree.
2. **Keep D3 on the T-023 critical path and the API loopback-only.** Do not point the web app at it from the tailnet address before authentication exists.
3. **Ask Coder for an environment override for the port (D2)** and a controlled repro of D4 against `index.ts` (SIGTERM with stdout piped to a process that exits).
4. **Ask Designer to ship or formally drop Geist and Bricolage (D6)** before UX-010 is scheduled, and to add the per-card FIXTURE/LIVE badge (T-040). Also ask Coder to give fixture mode its own IDs (D5).
5. **Someone with sudo should run `playwright install-deps chromium`** (9 libraries) on this host so the T-024 browser checks and screenshots can proceed.
6. **Do not count this pass toward SA-004/SA-001 closure.** Disposable-VM and all-three-host evidence is still required.

## Files changed on this branch

| File | Purpose |
|---|---|
| `tests/live/serve-3002.mts` | Test-only launcher: same `buildServer()` on `127.0.0.1:3002` |
| `tests/live/leak-scan.sh` | Credential/path pattern scanner (prints pattern names, never match text) |
| `tests/live/ai-probe.test.mts` | Independent AI-boundary probe (7 tests). Needs `TEST_FLEET_JSON`. The snapshot is not committed. |
| `tests/live/collect-local-once.mts` | Runs the real local collector once and prints a summary |
| `docs/team/test-report-live-001.md` | This report |

Raw `/api/fleet` captures were **not** committed (they derive from real hosts). They are in `/tmp/tester-live/` and the summaries above are what I'm standing behind.
