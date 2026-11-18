# Handoff: Designer T-067 and T-068 (branch feat/designer/t067)

## T-067 Server detail (UX-05, `/servers/:id`), live `/api/fleet` data
**Files:** `apps/web/src/servers/` (`ServerDetailScreen.tsx`, `serverDetailViewModel.ts` + test, `servers.module.css`), `lib/router.ts` (+test: `/servers/:id`, `/servers/:id/settings|verify`, `/servers/new`), `App.tsx`, `components/overview/fleetViewModel.ts` (exports `toServerCard` so card and detail agree). Commit `0f10168`.

**What it shows**
- Name row: pixel icon (identity colour), pixel name, role, Production label, access chip ("Read-only · SSH"), status badge, freshness, coverage ("16 of 16 checks ran"), plus "ServrSit can look at this server. It cannot change anything on it yet." Latest-failure, historical-data, refresh-failed and host-key notices appear when relevant.
- **Status:** findings first (sorted critical, needs attention, advisory); "No findings from the 16 of 16 checks that ran" (never a bare all-clear); checks passed with each unavailable check and its reason; resources with units and the sample time (CPU load on N CPUs, memory used/total/available, swap, per-mount space and inodes with a text figure and a bar); system (platform, architecture, uptime, boot id first 8, server clock skew note, failed services, important services each "No failure reported" or "Failed").
- **Care:** pending updates; package-information age with a caveat when the server's clock was corrected or unverified; Ubuntu and "from other sources" counted separately with the outside packages listed (named, with origin) and a note they're left out of plans by default; held back; reboot (flag value or reason); baseline and recent operations as em dashes with a reason; **Review updates disabled** with "Changes are switched off for this server until testing on a disposable server is complete."
- **Settings (read-only):** name, role, classification, address, key in use, access, important services. Address and key show an em dash with "The API does not send/say … yet". The key line will only ever read "dedicated ServrSit key" or "owner key" once the API provides it; no path is shown and a test asserts none appears.
- Empty data is "—" plus the reason, never zero. When there is no observation, Status/Care collapse to one explanation instead of repeating it per row. ServrSit's untrusted clock marks ages with ≈.
- Links: cards already link to `/servers/:id` (name and action buttons); status actions `/verify` and `/settings` land on the same page.

## T-068 Connect a server (UX-03, `/servers/new`)
**Files:** `apps/web/src/connect/` (`ConnectScreen.tsx`, `connectLogic.ts` + test), `apps/web/src/api/stubs/servers.ts` ([FIXTURE] stub, **Coder please replace**; proposed endpoints are listed at the top of the file), `OverviewScreen` ("Connect a server" link).
1. **Meet the server:** name, address, port (default 22), SSH user, purpose, Production / Non-production / Not sure. Not sure is treated as production with a stated reason; the name never decides it. Validation refuses schemes, `user@`, shell characters, leading dashes, paths, loopback, unspecified, link-local (incl. 169.254.169.254), multicast and localhost names; allows private/CGNAT; ports 22 or 1024–65535. A duplicate address+port opens the existing record. An unreachable private address says "ServrSit cannot reach this private address yet" with route guidance and "Check again".
2. **Set up access:** Inspect only (default). "Enable approved maintenance" and "Allow package-list refresh" are shown as not available yet. Server-console steps and the `restrict,from="…" ssh-ed25519 …` line with Copy. Network path and SSH authentication are explained as separate. **No private key or password field exists** (checked: 0 password/file inputs).
3. **Verify identity:** the owner enters the fingerprint from the server's own console first (`ssh-keygen -lf …`); only then ServrSit fetches and shows what it sees and compares. Mismatch blocks with "Do not continue". Match still needs the "I got this from an independent source" checkbox. There is deliberately no Copy button on the displayed fingerprint.
4. **First check:** explicit "Run the first check", step list with text states (Done / In progress / Not available), no percentages, partial result ("Partly checked: 4 of 5 checks ran", usable results kept), schedule choice, and a "[FIXTURE] Nothing was saved" notice. The whole flow shows [FIXTURE DATA].
Back works on every step and clears later-step state (entered fingerprint, trust, check). Draft: whitelist of non-secret fields in localStorage; never resumes past step 2; never restores maintenance.

## Checks run (real output)
- `pnpm --filter @servrsit/web test`: **121 pass, 0 fail** (was 101). `typecheck` clean, `build` ok.
- Browser (Playwright) against my own API on 127.0.0.1:3005 and preview on 127.0.0.1:5174, signed in through the real setup flow. Detail pages used synthetic servers injected into the `/api/fleet` response (labelled fixture in the files). Both panes closed; ports refuse connections now. Never used :3001 for tests (one read-only GET of its response shape before building).
- Detail: 3 servers x desktop/390px, no horizontal overflow, Review updates disabled on all, unknown id → "Server not found".
- Connect flow x desktop/390px: errors shown for empty form; 169.254.169.254 refused; unreachable and duplicate paths; draft saved with only whitelisted fields; no secret inputs; mismatch and unticked ack keep Trust disabled; fingerprint cleared after Back; first check runs to "Partly checked"; no `%` text; Overview shows the Connect link. No overflow on any screen.
- Screenshots: `docs/team/evidence/t067/` (22 PNGs).

## Gaps and requests
- **API fields missing for Settings:** address and which key is in use (as "dedicated ServrSit key" / "owner key"). Detail shows em dashes meanwhile.
- **Needed from Coder for T-068:** the endpoints sketched in `api/stubs/servers.ts` (precheck incl. duplicate and reachability, access info, host-key fetch, create, first-check). Real clients must refuse the first check unless the fingerprint was confirmed.
- No operation history or baseline data from the API, so those rows are em dashes.
- Ports: the UI accepts 22 or 1024–65535 (my reading of "unapproved ports"); confirm the approved set.
- Statuses that link to `/servers/:id/verify` have no real verification yet (only inside the new-server flow).
- Last screenshot of the no-data page was regenerated after the final change but my image viewer showed a cached copy; the file size dropped (171 KB → 107 KB) as expected. Re-check it if it matters.
- Fixture banner "Clock not checked" appears in my fixture-mode API; in live mode it follows the real clock state.

## Next
Orchestrator: merge `feat/designer/t067`. Coder: address/key fields in `/api/fleet`, the servers endpoints, then swap the stub.
