# Test report: web flows in a non-secure context (web-nonsecure-001)

**Author:** Kiro Tester · **For:** Kiro Orchestrator · **Date:** 2026-11-22 (08:30 to 09:05 UTC)
**Trigger:** the Orchestrator's standing checklist item: test web flows on the founder's real origin `http://100.104.220.8:5173` (plain HTTP, a non-secure context), not only on localhost. `crypto.randomUUID` broke approval there; fixed in `b615f67`.
**Code and origin checked:** the founder's checkout at `integration/live-v1` (read-only) and his Vite dev server on the real origin (GET only).

## Result: PARTIAL. The class check and the real-origin smoke are in place. They found one High and one Low defect. The authenticated approval flow in a non-secure context (NF-009 (d)) is not yet run.

| Check | Result |
|---|---|
| Static scan for secure-context-only browser APIs (`scan-secure-context.mjs`) | **PASS**, with one known Low defect (D-W1). Self-test passes. It **fails on the pre-fix source at `care/approval.ts:87`**, so it would have caught the original bug |
| The real origin is a non-secure context | **confirmed**: `isSecureContext: false`; `crypto.randomUUID`, `crypto.subtle` and `navigator.clipboard` are undefined; `getRandomValues` works |
| First load on the real origin | **PASS**: sign-in page, 0 page errors, 0 console errors, 0 failed requests, GET requests only (never signed in, never used the founder's account) |
| Code the real origin serves now | **PASS**: `/src/care/approval.ts` has no `crypto.randomUUID` call and uses `getRandomValues`; `/src/care/PlanScreen.tsx` has the browser-side error display added in `b615f67` |
| The dev server must not serve the API's data directory | **FAIL (D-W2, High)** |
| Authenticated plan → approve flow in a non-secure context | **not yet run** (NF-009 (d)) |

## 1. What `b615f67` changed

- `care/approval.ts`: `newIdempotencyKey` now builds its key from `crypto.getRandomValues`, which exists on plain HTTP, instead of `crypto.randomUUID`, which does not.
- `care/PlanScreen.tsx`: an exception in the browser during approval is now shown to the owner ("Nothing was started. Reload the page and try again.") and logged, instead of failing silently.
- `care/insecureContext.test.ts`: a unit test for the key.

## 2. The whole class, not only `randomUUID`

`tests/e2e/web-nonsecure/scan-secure-context.mjs` looks for 13 groups of APIs that exist only in a secure context: `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard`, service workers, share, credentials and `PublicKeyCredential`, media devices, geolocation, storage, locks, wake lock, USB and similar, notifications, file pickers, cache storage and `SharedArrayBuffer`.

- It ignores comments, strings and test files, takes a reviewed allowlist, and fails on any unreviewed use. Known defects are printed as a WARN on every run.
- **Limit:** it is lexical. It cannot tell a guarded use from an unguarded one, so every hit needs a person to review it.

| Hit in `apps/web/src` | Verdict |
|---|---|
| `auth/copy.ts:4-5` `navigator.clipboard` | **reviewed, fine.** It is optional-chained and falls back to a hidden textarea with `execCommand("copy")`. The code comment says it is written for plain-HTTP hosts. Used by Setup, Connect and Settings |
| `fixtures/activityFixture.ts:69` `crypto.randomUUID()` | **D-W1 (Low).** Used only by the Designer's `/fixtures/activity` review route (`ActivityScreen fixture`), not the live Activity page. On a plain-HTTP origin, "Create export" on that route throws. Nothing on the founder's real pages uses it |

Pre-fix proof: scanning the tree of `b615f67^` fails with `care/approval.ts:87 randomUUID`, exactly the bug.

## 3. Real-origin smoke (`tests/e2e/web-nonsecure/real-origin-smoke.mjs`)

Chromium (Playwright 1.65.1, headless) opens `http://100.104.220.8:5173/` and records everything. Raw result: `evidence/web-nonsecure-001/real-origin-smoke.json`; screenshot of the first load (sign-in page, no credentials): `real-origin-first-load.png`.

- **Page:** title "Sign in · ServrSit", `isSecureContext: false`, protocol `http:`.
- **Requests:** about 110 GETs, all Vite dev modules, fonts and one `GET /api/auth/session`. No POST. No sign-in.
- **Errors:** none (page, console, failed requests).
- **Served approval code:** as listed in the result table above.

Environment notes: Chromium needed 11 shared libraries that were not installed. I restored them as an ordinary user (`apt-get download` and `dpkg -x` into `/tmp/libs`, no root, no system change), and pinned `playwright-core` at 1.65.1 in `/tmp/pw`. Run with `LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu`.

## 4. Defects

| ID | Severity | Where | Description |
|---|---|---|---|
| **D-W2** | **High** (dev server; tailnet-only; no evidence of misuse) | `apps/web/vite.config.ts` (no `server.fs` settings) | The dev server is bound to the tailnet address only, which is deliberate. But Vite serves any file inside the **workspace root** through `/@fs/<absolute path>`, except names matching its default deny list, which in the installed Vite 6.3.5 is `.env`, `.env.*`, `*.{crt,pem}` and `**/.git/**`. The root contains `apps/api/.data`. **Measured with non-secret files only:** `/@fs/etc/hostname` returns **403** (outside the root, so the allow-list works); `/@fs/…/apps/api/config/hosts.json` returns **200**; the Sentani maintenance **public** key file in `/@fs/…/apps/api/.data/helper/sentani/` returns **200** (110 bytes); `/@fs/…/apps/api/.data/helper/manifest-signing-ed25519.pem` returns **403**, but only because of its `.pem` extension. **I did not request any private key or database.** From the deny patterns, the Sentani **maintenance private key** (a file with no extension, next to that public key), the **inspect private keys under `.data/server-keys/`**, and the databases (`auth.db` with the owner's password hash and TOTP secret, `care.db`, `servers.db`) are **not** protected. Anyone who can reach `http://100.104.220.8:5173`, or any page running on that origin, could fetch them. The Sentani inspect key is still a full shell, because the T-091 forced-command line is not applied there. Any real server the founder later adds through the app would put its inspect key into this same directory. **Fix (Coder):** set `server.fs.allow` to the web app and the few package directories it needs (not the workspace root), and add `server.fs.deny` for `**/.data/**`, `**/id_*` (SSH key files), `**/*.db*`. Better still, keep runtime secrets outside the workspace root. The smoke's `dataDirNotServed` check turns green when this is fixed. Whether a key was ever fetched cannot be told: Vite keeps no access log. **Rotating the Sentani maintenance and inspect keys after the fix is cheap, and the founder may want it** |
| **D-W1** | Low | `apps/web/src/fixtures/activityFixture.ts:69` | The fixture activity client uses `crypto.randomUUID()`, which throws on a plain-HTTP origin. It affects only the `/fixtures/activity` review route. Fix: use the same `getRandomValues` helper |

## 5. Not covered yet, and what I propose

**NF-009 (d): an authenticated plan → approve flow in a non-secure context.** The checks above prove the failing API is absent from the shipped code and that the real origin is non-secure. They do not click through the approval.

Proposed method (no contact with the founder's services):
1. Open the page with the origin **set to the real origin string** (`http://100.104.220.8:5173`) in Chromium, which keeps it a non-secure context.
2. Intercept every request in Playwright. Serve the web code from a build of the current head that I make in my own worktree, and forward `/api/*` to **my own API instance** (the browser still sends `Origin: http://100.104.220.8:5173`, which the API allows). Nothing reaches the founder's Vite or API.
3. Sign in as my own owner, open a Sentani plan, press Approve, and check that an operation is created, and that a forced browser-side exception shows the error text instead of failing silently.

An approval click on a real plan writes to Sentani, so the step needs a pending package. **The one pending package after R3 belongs to the founder's own first in-app update, so I will not use it.** I will run the click-through with the next downgrade round, or against canned `/api/plans` replies for the approval step. I will say which in the report.

**NF-009 (e), the standing rule:** any web change that touches crypto, clipboard, storage, notifications, service workers or file pickers gets the scan, and a non-secure-context check, before I sign it off. The matrix now says so.

## 6. How to run

```
node tests/e2e/web-nonsecure/scan-secure-context.mjs --self-test
node tests/e2e/web-nonsecure/scan-secure-context.mjs              # exits 1 on any unreviewed use
LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu node tests/e2e/web-nonsecure/real-origin-smoke.mjs   # exits 1 if any check fails; today D-W2
```

## 7. State and commits

- Nothing was changed in the founder's checkout or on any server. The only requests to the real origin were GETs (page load, two source modules, four file probes, one public canary).
- I started no process that is still running.
- The acceptance matrix has two new entries: NF-009 (in progress) and NF-010 (failed, D-W2).
