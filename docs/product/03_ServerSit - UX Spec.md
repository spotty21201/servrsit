# ServrSit — UX and Visual Design Specification

**Your servers have a sitter.**  
**Less babysitting. More building.**

| Document control | Detail |
| --- | --- |
| File | `03_ServerSit - UX Spec.md` |
| Version | 0.1 — design direction and implementation contract |
| Date | 15 November 2026 |
| Product owner | Spotty |
| Product baseline | `02_ServerSit - PRD.md`, version 0.1 |
| Founder direction | Attractive, fun, expressive typography, lively colors, and fresh composition. Visual quality is a requirement. |
| Status | Proposed UX specification for founder review and Kiro Designer implementation |
| Companion | `04_ServerSit - Technical Spec.md` |

> ServrSit should feel like a capable technical colleague with the taste of a creative studio. Its personality comes through composition, typography, color, and concise writing. Its credibility comes from precise information and dependable actions.

## 1. Design decision

Use a **warm, expressive, editorial visual language**: spacious off-white backgrounds, deep ink text, confident headlines, tangerine actions, and selective lilac and citron accents. Combine this with a compact, precise treatment of operational information.

The interface should have three recognizable signatures:

1. **A typographic daily briefing.** A short, large statement explains the fleet's current situation.
2. **Recognizable server identities.** Each machine has its name, role, a small geometric emblem, and an explicit status. Machines feel familiar without becoming cartoon characters.
3. **Clear action receipts.** Proposed and completed work appears as structured, readable records with evidence available on demand.

The desired feeling is lively, assured, and useful. Technical seriousness does not require a gray corporate interface. Fun does not require animation everywhere, jokes during failures, or a novelty terminal.

This specification selects one coherent direction. Designer should refine it, rather than introducing several unrelated visual systems or replacing it with a generic component-library theme.

## 2. Product and experience boundaries

The PRD remains authoritative for supported operations, permissions, and release scope. This document defines how users encounter them. It does not authorize additional capabilities.

| Stage | UX coverage |
| --- | --- |
| A — Founder alpha | Authentication, connect/verify, fleet overview, server detail, conversation, plans, approvals, execution, results, baselines, schedules, findings, history, export, access controls. |
| B — Invited pilot | Complete account recovery/deletion, private-network onboarding clarity, email alerts and delivery states, customer isolation messaging. |
| C — Paid release | Subscription, usage, renewal, downgrade, cancellation, and recovery/export period. |

Do not display disabled “coming soon” menus for future stages. Stage A should feel complete within its actual scope.

The product spelling is **ServrSit**. Requested document filenames retain **ServerSit**. All examples involving Sentani, Nabire, and Timika are illustrative design fixtures unless backed by a real observation in the running product. Never present mock data as live server information.

## 3. User experience principles

- **The next useful action is visible.** Users should not need to formulate a prompt to find pending updates or inspect a failure.
- **The summary and its limitations travel together.** “Checked 3 minutes ago” and “one check unavailable” belong beside the result.
- **Conversation is an entry point.** It leads to the same plans, approvals, and records as conventional controls.
- **Production context remains visible.** No approval surface hides the identity or production classification of the target.
- **Details unfold without disappearing.** Raw evidence can be expanded, but essential impact and unresolved state are never hidden in an accordion.
- **A completed command is not a verified outcome.** The interface separates execution from verification.
- **Returning is easy.** Refreshing, switching devices, or closing a conversation does not lose work or manufacture a new operation.
- **Beauty supports attention.** Color, size, spacing, and motion communicate hierarchy; they do not compete with every datum.

## 4. Visual language

### 4.1 Typography

| Role | Typeface | Treatment |
| --- | --- | --- |
| Brand and display headings | **Bricolage Grotesque** | Weight 650–700, normal width; expressive but restrained. Use optical sizing where supported. |
| Interface, body, forms, buttons | **Geist Sans** | Weight 400 for prose, 500–600 for labels and actions. Clear letterforms at practical sizes. |
| Addresses, package versions, timestamps in evidence, transcripts | **Geist Mono** | Weight 400–500; tabular figures for aligned numeric values. |

Bricolage gives the product a distinctive voice; Geist provides the quieter working layer. These are intentional design choices, not a claim that popularity alone makes a font appropriate. Both projects publish open font licensing; preserve the licenses and verify the exact distributed assets. [U1–U2]

Using Geist does not require Vercel hosting. Production should serve pinned font assets through the application's own delivery path. Load only the styles required. Provide usable system fallbacks and avoid blank text while fonts load.

| Token | Desktop size / line height | Mobile size / line height | Use |
| --- | --- | --- | --- |
| Display | 52 / 56 px | 36 / 40 px | Fleet briefing; maximum two short lines. |
| Page title | 36 / 42 px | 28 / 34 px | Server name, activity, settings. |
| Section title | 24 / 30 px | 22 / 28 px | Main sections. |
| Card title | 22 / 28 px | 22 / 28 px | Server identity. |
| Body | 16 / 24 px | 16 / 24 px | Explanations and fields. |
| Compact interface | 14 / 20 px | 14 / 20 px | Metadata and dense lists. |
| Technical output | 13 / 20 px | 13 / 20 px | Expandable transcripts only. |

Use sentence case. Reserve uppercase for short eyebrow labels such as “YOUR FLEET”; never for paragraphs or warnings. Avoid ultra-light weights, tight body tracking, or tiny timestamps. Use relative units in implementation so browser font settings remain effective.

### 4.2 Color tokens

**Stage A ships a deliberately designed light theme.** The transcript has a dark surface. A full alternate dark theme is deferred until its states and contrast receive equivalent design attention; do not auto-invert the application based on OS preference.

| Token | Value | Purpose |
| --- | --- | --- |
| Canvas | `#F6F4EE` | Warm main background. |
| Surface | `#FFFFFF` | Forms, working cards, menus. |
| Ink | `#1D2532` | Primary text and dark surfaces. |
| Muted ink | `#56606C` | Secondary readable text. |
| Tangerine | `#FF7648` | Primary routine action fill, paired with Ink. |
| Lilac | `#C9B8FF` | Selected decorative identity accents and quiet feature emphasis. |
| Citron | `#D7EF52` | Small brand accents and occasional editorial highlights. |
| Soft line | `#DDDCD6` | Nonessential separators only. |
| Control boundary | `#7B8490` | Input boundaries and essential control distinctions. |
| Focus | `#5141C6` | Visible keyboard focus indicator. |

Do not put white button text on Tangerine. Use Ink. Lilac and Citron are brand accents, not health statuses. Approximately three quarters of a normal overview should remain neutral; accents should feel intentional rather than painted across every component.

| Semantic state | Foreground | Background | Icon and label |
| --- | --- | --- | --- |
| Checked / passed | `#185C44` | `#DDF5E7` | Check-circle + precise result. |
| Needs attention | `#794A00` | `#FFF0CE` | Triangle + specific issue. |
| Failed / critical | `#A32F2B` | `#FDE7E5` | Octagon or X-circle + failure. |
| Unknown / stale / unavailable | `#4D5663` | `#E7EBF0` | Question-circle or clock + explicit state. |
| In progress / information | `#344FA3` | `#E7ECFF` | Activity or information icon + step. |

These foreground/background pairs have calculated contrast ratios of approximately 5.9:1–6.9:1. Ink on Canvas is 14.0:1; Muted ink on Canvas is 5.8:1; Ink on Tangerine is 5.8:1. These calculations validate the specified opaque pairs, not the whole application. Designer and Tester must check rendered controls, focus, overlays, and every interactive state.

### 4.3 Shape, spacing, and depth

- Use an 8 px spacing rhythm, with 4 px for small internal relationships. Main section spacing is 32–48 px on desktop and 24–32 px on mobile.
- Server cards use approximately 20 px corners; forms and action panels 16 px; inputs and buttons 10–12 px. Pills are reserved for statuses and compact selections.
- Use borders and surface differences to establish structure. Use one subtle elevation treatment for overlays. Avoid large shadows on every card.
- Use one filled primary button per decision group. Secondary actions are outlined or text actions with sufficient contrast.
- Never rotate functional cards, fields, or text. Small decorative motifs may be playful; readable content stays aligned.
- Do not nest several card backgrounds to communicate a simple hierarchy. Use headings, dividers, and spacing inside a single panel.

### 4.4 Icons and server emblems

Use one consistent outline icon family, such as Lucide, with consistent stroke weight. Pair consequential icons with text. Status icons must have accessible names through their accompanying labels.

A server emblem is a small abstract arrangement of blocks or rounded geometric shapes. It is assigned when the machine is registered and remains stable through renaming and health changes. Its color represents identity, never current health. Status sits in a separate labeled badge.

There is no animated mascot in Stage A. A simple geometric sitter motif may appear in the empty state or brand mark. It should occupy less space than the task it introduces.

### 4.5 Motion

| Interaction | Target behavior |
| --- | --- |
| Hover, focus, pressed response | Immediate to 120 ms; no layout shift. |
| Disclosure or panel opening | 160–220 ms; short translation or fade. |
| State change | 150–200 ms; preserve the item's position. |
| Running operation | Small activity indicator plus actual step text; no invented completion percentage. |
| Verified completion | One quiet check transition; no confetti. |

Respect reduced-motion preferences. Disable decorative movement and replace animated activity with a static icon and text. Never animate a status into success before authoritative verification. Do not reorder a fleet card while the user is interacting with it.

## 5. Composition and information architecture

### 5.1 Application structure

Keep primary navigation small:

| Destination | Purpose | Contents |
| --- | --- | --- |
| **Overview** | Understand and act on the fleet. | Briefing, server roster, findings, current activity, connect server. |
| **Activity** | Recover what happened. | Operations, approvals, inspections, failures, filters, export. |
| **Settings** | Change owner-level preferences. | Account/access, schedules, baselines, AI/data, notifications where available. |

Server detail, operation detail, and plan review are addressable views under this shell. Conversation is a contextual panel, not a fourth permanent destination. No separate “Dashboard,” “Monitoring,” and “Health” menus with overlapping content.

Proposed routes communicate relationships; they do not dictate the frontend framework:

- `/overview`
- `/servers/new`
- `/servers/:serverId`, with Status, Care, and Settings sections.
- `/plans/:planId`
- `/operations/:operationId`
- `/activity`
- `/settings/:section`

Every route enforces authentication. Links from messages and notifications open the same canonical record. Unavailable or unauthorized records use a neutral “This item isn't available” response without disclosing another owner's resources.

### 5.2 Desktop overview

At 1440 px, use a compact 88 px navigation rail with visible labels, approximately 40 px content margins, and a content maximum around 1320 px. Use a 12-column grid with 24 px gutters.

Composition, from top to bottom:

1. **Compact top line:** workspace name, meaningful service availability indicator, account control. Avoid a decorative global search bar.
2. **Briefing:** approximately eight columns of large expressive text, with a short factual subtitle and observation coverage. The adjacent four columns can show next scheduled check and one useful contextual action. Keep this area concise.
3. **Ask bar:** a clearly labeled “Ask ServrSit” input with a scope chip and up to three contextual suggestions. This is a task entry surface, not an empty chat occupying half the screen.
4. **Working area:** an eight-column server roster and four-column “Needs attention” list. The roster uses two cards per row at this width; the third machine begins the next row. At wider content sizes, three cards may fit if their minimum width of 280 px is maintained.
5. **Recent activity:** a compact list below the roster, not another wall of metrics.

The attention column uses open rows and separators, giving the composition contrast against the server cards. Avoid filling every available gap. With no findings, it becomes a small quiet note and the roster can expand; do not manufacture content to preserve symmetry.

At 2–5 servers, emphasize names and context. At 6–20, offer a compact list view with the same information, sortable by attention, name, or last check. Preserve the user's view preference. The initial attention sort happens on entry; later status changes update in place until the user refreshes the ordering.

### 5.3 Responsive rules

| Width | Layout |
| --- | --- |
| 1200 px and above | Navigation rail; main/attention columns; contextual panel may dock only if the main content remains at least 720 px wide. |
| 768–1199 px | Compact top navigation; single main column; attention items above the roster; conversation overlays or opens as a dedicated view. |
| 320–767 px | Single-column cards, 16 px side padding, text-labeled mobile navigation, full-screen plans and conversation. |

On mobile, show urgent findings immediately after the briefing, before the ask bar. Avoid horizontal card carousels. Convert comparison tables into labeled per-server groups where possible. Long package tables may scroll within an explicitly labeled region, but target identity and approval controls must remain outside that region.

At 200% zoom and equivalent 320 CSS px reflow, primary workflows must remain usable. Sticky action footers reserve space in the document and must not obscure content, focused elements, or the on-screen keyboard. A sticky footer is not required where it creates those problems.

## 6. Screen inventory and contracts

| ID | Surface | Required content | Main actions |
| --- | --- | --- | --- |
| UX-01 | Sign-in and account protection | Clear ownership, session state, MFA setup/recovery path. | Sign in, set up MFA, recover access. |
| UX-02 | Empty overview | One concise explanation, support prerequisites, no pretend fleet. | Connect a server. |
| UX-03 | Connect server | Identity, access, host verification, permissions, first check. | Test connection, verify, connect. |
| UX-04 | Overview | Briefing, coverage, server roster, findings, recent work. | Check now, ask, inspect a server, connect another. |
| UX-05 | Server detail | Role, production classification, freshness, checks, findings, care actions. | Inspect, review updates, compare, edit settings. |
| UX-06 | Conversation | Explicit scope, grounded answers, linked evidence and action cards. | Ask, refine scope, open plan. |
| UX-07 | Plan review | Target, scope, impact, preconditions, verification, expiry. | Approve named action, revise, decline. |
| UX-08 | Operation detail | Durable step state, changes, verification, remaining work. | Inspect evidence, safe stop request, recheck outcome. |
| UX-09 | Baseline and setup | Approved conventions, reference source, differences, exclusions. | Save baseline, review setup plan. |
| UX-10 | Activity and export | Searchable operation/history records and filters. | Open record, export. |
| UX-11 | Settings and disconnect | Schedules, credentials, AI/data, exceptions, access lifecycle. | Save, pause checks, rotate access, disconnect. |
| UX-12 | Notifications [B] | Verified destination, quiet hours, digest, delivery state. | Verify, test, configure, snooze. |
| UX-13 | Subscription [C] | Price, allowance, usage, renewal/cancellation effects. | Subscribe, manage, cancel, export. |

Each screen must include loading, empty, partial, permission-limited, unavailable, and recovery states where relevant. Designing only the successful state is incomplete.

## 7. Onboarding and access

### 7.1 Entry and account protection

Use the brand typography and warm canvas around a focused sign-in surface. Managed identity screens may have provider layout limits; do not build insecure custom authentication to achieve visual consistency. Carry the logo, colors, and clear return navigation through supported theming.

Require MFA before enabling changes. Read-only connection may precede that step if supported by the authentication design. No skip path may silently grant write access. Authentication errors must not disclose whether another person's account exists.

### 7.2 Empty overview

Headline: **“Let's meet your first server.”**

Supporting sentence: “Connect a supported Ubuntu server to check its condition and review care tasks.” Show the initial support boundary and the need for existing SSH/network access. Offer one primary action: **Connect a server**. Do not include a marketing hero, pricing pitch, or fake green checks inside the signed-in product.

### 7.3 Four-step connection flow

| Step | Fields and behavior | Validation |
| --- | --- | --- |
| 1. Meet the server | Name, address, port default 22, SSH username, purpose, production/non-production/not sure. | Validate format; not-sure receives production precautions. Do not infer classification from the name. |
| 2. Set up access | Public/private route guidance, protected credential input, dedicated-key recommendation, access scope. | Distinguish network path from SSH authentication. Never ask for secrets in chat. |
| 3. Verify identity | Host fingerprint, readable verification instructions, permissions/capability result. | Require comparison with an independently obtained fingerprint. Observing a fingerprint on the first connection is not independent proof. |
| 4. First check | Inspection progress, supported/unsupported platform, partial results, check schedule choice. | Connect only after identity verification; show missing capabilities without hiding usable read-only results. |

The stepper is navigable backward. Save nonsensitive fields as a draft; clear secret inputs when leaving the access flow or expiring the session. Do not persist private keys in browser storage or analytics. A duplicate host opens the existing server record or asks the owner to resolve identity; it does not silently create another execution target.

Access choices must distinguish **Inspect only** and **Enable approved maintenance**. Explain any bootstrap changes before presenting installation instructions. A permission summary lists what the granted credential can actually do, rather than claiming that a powerful account has been made harmless by the interface.

The bounded **Allow package-list refresh** permission is separate from package installation. Default it off until explicitly selected. Explain: “Refreshes available-package information on this machine. It does not install updates.” Without it, show the age and limitations of existing package information.

If no private route exists, say “ServrSit cannot reach this private address yet,” with setup instructions and retry. Do not imply that installing the app on the user's laptop resolves always-on access.

### 7.4 First useful result

Show the server name, role, platform, latest inspection coverage, and one next step. Offer selection of important services from discovered candidates; none becomes an expectation solely because it was discovered. Confirm default health checks every 15 minutes and deeper inventory daily, including the timezone and next run. The owner can pause checks.

## 8. Overview and server detail

### 8.1 Fleet briefing rules

The large heading communicates attention, not a generated essay. Suitable patterns:

- “Everyone's behaving.” Only when all expected supported checks are fresh and clear. Follow with “3 servers checked · updated 2 minutes ago.”
- “Two things need a look.” Follow with the machines and actual issues.
- “One server is out of reach.” Follow with the observation location and last successful check.
- “I need a fresh look.” When observations are stale or incomplete enough that reassurance would mislead.

Do not use the playful healthy headline if even one machine has unknown coverage. Exact facts and times always accompany the voice.

### 8.2 Server card anatomy

In reading order: identity emblem; server name link; purpose and production label; primary status label; one most useful finding or checked result; last successful health check; selected routine action.

A server card is an article with a heading link and separate action controls. Do not implement the entire card as a button containing other buttons. With a running operation, show its label and link without hiding older unresolved findings.

Default actions are **View server**, **Review updates**, or **Check connection**, selected from actual state. Never use an ambiguous **Fix everything** button. Routine package availability is not automatically a critical red condition.

### 8.3 Status is not one color

Represent three related dimensions: observation coverage, findings, and operation state. For example, a machine may be unreachable now, have an older disk warning, and contain an operation whose outcome is unknown.

| Condition | Primary presentation | Retained secondary information |
| --- | --- | --- |
| All expected checks fresh and passed | Checked / no issues found in selected checks. | Check time and coverage. |
| Fresh issue detected | Needs attention + issue. | Other checks and evidence. |
| Latest connection attempt failed | Unreachable from ServrSit. | Last successful result, labeled historical. |
| Checks partially available | Partially checked. | Which checks passed, failed, or lack permission. |
| Information expired | Check overdue / stale. | Historical values visibly labeled. |
| Operation unresolved | Outcome unknown. | Known changed steps and current connection coverage. |

A historic critical finding remains visible when connectivity fails; unknown coverage does not erase it. Filters can combine these dimensions. The underlying freshness rules remain those in the PRD.

### 8.4 Server detail

Use a strong name/title row, small emblem, role, production status, and explicit access capability. Below it, provide:

- **Status:** prioritized findings, coverage, selected services, compact CPU/memory/storage facts, platform, uptime, latest checks.
- **Care:** pending updates, reboot evidence, baseline comparison, supported actions and recent operations.
- **Settings:** editable identity/context, important services, thresholds/exceptions, access, schedule override if implemented, and disconnect.

Metrics include units and sample time. Empty data is an em dash plus a reason, never zero. Do not draw invented historical charts from one sample. Small sparklines may appear only when retained observations support them and their time range is labeled.

## 9. Conversation and structured actions

The ask bar opens a contextual panel or full-screen mobile view. Its scope chip says **All servers**, **Nabire**, or the selected group. Changing page context must not silently retarget an existing draft request or proposal.

Suggested prompts are specific and state-dependent: “What needs attention?”, “Explain these updates”, “Compare directory conventions.” A suggestion submits an ordinary request; it never approves a change.

An answer contains a short explanation, visible scope, evidence links, and—when appropriate—a structured **Review plan** card. Technical details may expand below. Do not stream tentative commands into an executable terminal. Do not expose hidden model reasoning; show concise evidence and decision rationale.

| Situation | Response behavior |
| --- | --- |
| Ambiguous machine or action | Ask one targeted clarification with named choices. |
| User says “yes” after a proposal | Open or focus the authenticated approval surface; chat assent alone does not execute. |
| User pastes a key or apparent secret | Do not echo it; stop sending that content to the model, show protected-access guidance, and advise replacement if exposure may have occurred. Do not promise perfect secret detection. |
| AI timeout | Preserve the request, show the limitation, and offer deterministic checks/actions. |
| AI usage limit | Explain the limit; keep core checks, approvals, history, and verification available. |
| Unsupported task | Say what cannot be executed and offer supported inspection or an evidence export. |

The conversation can be closed without cancelling an operation. Deleting or clearing a conversation does not delete the operation audit trail; explain that distinction in the relevant control.

## 10. Plan review and approvals

### 10.1 Canonical review surface

Use a dedicated page for changes. A wide desktop page may put the action summary beside the expanded transaction detail. Mobile stacks them. All entry points—chat, update list, baseline setup, and history—open the same plan record.

Always-visible information:

1. **Action and target:** “Update packages on Nabire”; address/identity available; production label visible.
2. **Scope:** number and names of requested changes, dependency effects, exclusions, and plan version.
3. **Impact:** possible service interruption, known restart effects, uncertainty, and whether reboot is excluded.
4. **Preconditions:** freshness, permissions, package state, and production recovery confirmation.
5. **Verification:** what will be checked afterward and what it cannot establish.
6. **Approval validity:** expiry time and invalidation when material conditions change.

Expandable details include package versions, directory changes, the reviewed operation description, and technical evidence. Impact, missing prerequisites, and unresolved risk never live exclusively in the expansion.

### 10.2 Approval interaction

Use a specific label: **Approve update on Nabire**, **Restart nginx on Timika**, or **Reboot Sentani**. Do not use **OK**, **Continue**, or **Run** for consequential approval.

Required production acknowledgements are specific and unselected: the owner confirms a suitable recovery route and understands interruption risk. This is recorded as owner confirmation, not “backup verified.” Do not add routine “Are you sure?” dialogs after a complete review; the review itself is the deliberate checkpoint.

Routine approval uses Tangerine with Ink. Reboot and disruptive actions use the critical treatment with sufficient contrast and explicit labels. Destructive product-account actions use a separate danger section. Never make a critical action the automatic default focus after entering a page.

On submission, disable duplicate submission and show **Submitting approval**. If the response is lost, show **Checking whether this started** and retrieve the existing record. Do not offer a fresh execution button until identity and outcome are reconciled.

### 10.3 Expiry and changed conditions

Default unstarted-plan expiry is 15 minutes. Show the absolute expiry in the user's timezone with a simple relative label; do not announce every countdown second to assistive technology.

If a plan changes or expires, disable its approval, explain the specific reason, and offer **Refresh plan**. Display added/removed scope in the new version; previous acknowledgements and approval do not transfer automatically.

### 10.4 Multiple machines

Show the explicitly selected machines and the serial execution order. Each production machine requires its own approval. A stopped or unknown result pauses remaining machines, shown as **Not started — waiting for review**. “Approve all future production work” is never offered.

## 11. Execution, verification, and recovery

Use a compact vertical step list. Display named steps, real start/end times, and the current stage. Progress percentages are allowed only where real measurable work supports them; a sequence of steps is sufficient otherwise.

| Product state | User-facing label | Controls and explanation |
| --- | --- | --- |
| Proposed / awaiting approval | Ready to review | Review, revise, decline. |
| Queued | Waiting to start | Reason; cancel before start. |
| Running | Working on Nabire | Current step; request safe stop where supported. |
| Verifying | Checking the result | What is being checked; no success banner yet. |
| Succeeded | Completed and verified | What changed, what passed, any separate follow-up. |
| Partially succeeded | Some work completed | Changed/skipped/failed/unverified steps clearly separated. |
| Failed | Could not complete | Last confirmed result, failure, supported next step. |
| Cancelled before start | Cancelled — no work started | Preserve record. |
| Outcome unknown | Result not yet confirmed | Recheck outcome; conflicting changes unavailable. |

“Stop after this safe step” explains that an active package transaction may need to finish. Do not label it **Undo** or imply instantaneous cancellation. Never expose force-kill of a package manager as a casual recovery action.

The expandable transcript uses the dark Ink surface, readable monospaced text, timestamps, and redacted output. It is read-only. Auto-follow applies only while the user is already at the end; scrolling up pauses following and shows **Jump to latest**. New log lines do not repeatedly interrupt screen readers.

The completion receipt separates:

- What changed.
- What was verified.
- What remains necessary, such as a reboot.
- What could not be verified.
- Links to evidence and export.

An update may be verified as installed while a reboot remains necessary. The title and follow-up must state both. If selected-service verification fails, the operation cannot appear as wholly verified success.

## 12. Baselines and preparing another server

Use a guided flow: **Choose reference → select conventions → compare target → review plan**.

The reference selector includes role and observation age. Display candidate directories/packages with checkboxes; nothing sensitive or machine-specific is eligible. Saving the selected conventions creates a named baseline with a version and source observation. It does not authorize changes.

Comparison rows use these labels: **Matches**, **Missing**, **Different by design**, **Conflict**, **Not checked**. Ownership conflicts or existing contents remain explicit blockers to unsupported changes. Do not show every version difference as a warning.

The setup proposal says exactly which new directories and supported packages will be created/installed. Include a concise exclusion statement: credentials, application data, existing contents, and network settings are not copied. This is relevant scope information, not boilerplate.

Offer **Mark intentional** with an optional reason. That action changes the baseline exception record only; it does not change the server. Scope the exception to the actual machine and convention. Subsequent edits remain visible in history.

## 13. Findings, schedules, and notifications

### 13.1 Findings

A finding contains server, issue, severity, first/last observed times, evidence, and supported next action. Acknowledgement records that the user has seen it. Snooze changes notification timing; neither resolves the finding.

A resolved finding states the observation that established recovery. For repeated checks, update one finding rather than creating duplicate cards. A historical finding with no current evidence says **Previously detected — not rechecked**, not **Resolved**.

### 13.2 Schedules

Expose a simple health-check interval, daily deeper-check time, timezone, pause control, and next run. Show default values before saving. Explain the distinction between automatic inspection and approved changes. No schedule form in A–B includes an install-update or reboot option.

Show **Checks paused**, **Check delayed**, or **Scheduler unavailable** explicitly. Paused monitoring is not an all-clear condition. After service recovery, a current check replaces a backlog of missed checks.

Use the owner's chosen timezone; default from account/browser with confirmation. Show timezone abbreviations with full zone in details, including `Asia/Jakarta` where appropriate. Exports include unambiguous timestamps.

### 13.3 Pilot alerts [B]

Email setup requires destination verification, a test alert, quiet hours, and optional digest. No checked-by-default marketing subscription. The owner explicitly chooses whether critical alerts bypass quiet hours. Email contains a short issue summary and an authenticated link; it never approves an operation or includes credentials/transcripts.

Delivery states: awaiting verification, enabled, paused, delivery failed, and destination rejected. A test-send success means accepted by the email service, not proof that the message reached the inbox; label it accurately. Delivery failures remain visible inside the app.

## 14. History, export, privacy, and disconnection

Activity defaults to meaningful operations and findings. Filters include server, result, time period, and record type. Technical inspection events remain available without overwhelming the default list. Search matches names, operation titles, and identifiers; do not use secret contents.

Export offers a readable report and machine-readable history/inventory. State date range, time zone, and secret redaction. Export completion uses a persistent downloadable result; do not rely on a fleeting toast.

Settings clearly distinguishes AI processing, data retention, server access, and deletion. Turning off AI stops new inference requests while core operations remain available. The current retention policy must match the PRD and implementation, including backup expiry and any exceptions.

Disconnect confirmation names the server, explains that future checks/work stop, lists queued and active work, and provides remote credential revocation instructions. Disconnecting does not delete or shut down the server. If remote revocation cannot be performed by the supported product, say so; never imply that deleting a saved credential removed the remote key.

Account deletion [B] summarizes active work, export, credential revocation, active-data deletion, and backup expiry. Billing cancellation [C] is distinct from deleting the account. No coercive confirmation copy or hidden cancellation path.

## 15. Component behavior contract

| Component | Required variants | Interaction rule |
| --- | --- | --- |
| Button | Primary, secondary, text, critical; idle/loading/disabled/focus. | Label describes consequence; duplicate submission blocked; disabled reason available nearby. |
| Status badge | Passed, attention, critical, unknown, progress. | Icon + text; never interactive unless rendered as an actual control. |
| Server card | Fresh, partial, stale, unreachable, working. | Stable identity; no nested clickable controls; status dimensions preserved. |
| Finding row | New, acknowledged, snoozed, resolved, historical. | Acknowledgement is not resolution. |
| Evidence link | Available, unavailable, expired. | Opens the actual observation or explains absence. |
| Plan card | Draft, ready, blocked, expired, superseded, approved. | Opens the canonical plan; cannot execute directly from generated prose. |
| Operation step | Pending, running, passed, failed, skipped, unknown. | Real evidence drives state. |
| Disclosure | Closed/open, loading/error where needed. | Keyboard-operable; important risk stays visible when closed. |
| Form field | Empty, valid, invalid, protected, disabled. | Persistent label, associated error, no placeholder-only labels. |
| Toast | Routine acknowledgement only. | No sole presentation of failure, approval, or outcome. |
| Modal | Small focused confirmation only. | Focus contained and restored; Escape cancels dismissal-safe actions; never traps an unfinished server job. |

Prefer native controls and tested accessible primitives. A component library may provide behavior, but its default styling must not define the product's visual identity.

## 16. Accessibility and input

Target WCAG 2.2 AA. This is an implementation and testing target, not a certification claim. Relevant standards include text contrast, non-text contrast, target size, and unobscured focus. [U3–U6]

- Normal text contrast at least 4.5:1; large text at least 3:1. Essential graphical/control distinctions meet 3:1 where required.
- Use a visible 2 px focus ring with offset; test it on actual adjacent backgrounds. Focus must not disappear under overlays or sticky controls.
- Product target: interactive controls have at least 44 × 44 CSS px effective touch areas wherever practical. This is intentionally more generous than WCAG 2.2's 24 px minimum criterion and its exceptions.
- Support complete keyboard use; visible labels, logical headings, landmarks, skip navigation, and descriptive page titles.
- Dialogs restore focus to the invoking control; route changes announce the new page title. Do not move focus unexpectedly when background checks finish.
- Announce meaningful state transitions politely; assertive alerts are reserved for immediate errors requiring attention. Do not read every timer tick or transcript line.
- Color is never the only indication of state. Tooltips supplement visible information rather than conceal the only explanation.
- Preserve browser zoom, text selection, password-manager use, and paste. Never require dragging, hover, or a keyboard shortcut to complete a task.
- Provide textual summaries of charts and exact values on demand. Respect reduced motion and forced-colors/high-contrast modes.

Optional keyboard conveniences: Escape closes dismissible panels; Ctrl/Cmd+K opens Ask only when it does not conflict with an active text field. Every shortcut has a visible equivalent. Enter in the ask field sends the request; Shift+Enter inserts a newline when multiline entry is used. Enter must not become a global approval shortcut.

## 17. Voice and microcopy

The voice is concise, capable, and occasionally cheeky. Use “I” for explanation sparingly; factual results need no anthropomorphic preamble. Avoid dramatic language, guilt, and exaggerated confidence.

| Context | Suitable copy | Avoid |
| --- | --- | --- |
| Fresh clear fleet | “Everyone's behaving.” + coverage/time. | “Your infrastructure is perfectly secure.” |
| Connection success | “Nabire is connected. Let's see what's running.” | “Welcome to the ultimate AI DevOps experience.” |
| Pending updates | “Three packages can be updated.” | “Critical danger!” for ordinary pending packages. |
| Production impact | “This may interrupt Timika's applications.” | “Don't worry, this is safe.” |
| Unknown result | “The connection dropped. The result is not confirmed.” | “Failed—try again” without reconciliation. |
| Reboot follow-up | “Updates installed. A reboot is still needed.” | “All done!” |
| Unsupported request | “I can inspect this, but I can't make that change yet.” | Pretending to perform the request. |

Use consistent verbs: **Check**, **Review**, **Approve**, **Verify**, **Disconnect**, **Export**. Use **Update packages** for OS packages and **Reboot server** for the machine. Avoid using “restart” for both services and entire servers.

## 18. Usability tests and visual acceptance

Recruit at least five people resembling the target owner, including the founder, and separate observed task completion from aesthetic preference. Use fixture data and disposable machines for uncertain or failure scenarios.

| Test | Pass evidence |
| --- | --- |
| First impression | User identifies product purpose and next action within 30 seconds; describes the interface as approachable without mistaking it for a toy. |
| Fleet comprehension | At least 4 of 5 distinguish fresh health, stale information, and an unreachable server. |
| Maintenance review | At least 4 of 5 correctly identify target, scope, interruption risk, and what approval permits. |
| Interrupted update | At least 4 of 5 understand that connection loss does not prove failure and avoid blindly retrying. |
| Baseline setup | User can explain what will be copied/applied and what will remain untouched. |
| Mobile approval | Full scope and risk remain readable at 390 px and 320 px; no clipped target or inaccessible action. |
| Keyboard and screen reader | Core connection, review, result, and disconnect tasks work without a mouse; state announcements remain comprehensible. |
| Visual consistency | Fonts, tokens, hierarchy, spacing, semantic state colors, and action emphasis match this specification across all states. |

Required visual review sizes: 1440 × 900, 1024 × 768, 768 × 1024, 390 × 844, and 320 px width. Test long server names, long package versions, 1/3/20 servers, no findings, many findings, partial inspection, expired approval, and outcome unknown. Test 200% zoom and reduced motion.

Designer delivers a small reviewed set of high-fidelity screens before the UI spreads across the app: overview, server detail, plan review, operation result/unknown result, connection flow, and mobile approval. These are implementation artifacts, not an additional product feature. Tester checks them in the browser; screenshots alone do not establish functionality or accessibility.

## 19. PRD traceability

| PRD requirement | UX coverage |
| --- | --- |
| FR-01 | UX-01; Sections 7, 16. |
| FR-02–FR-04 | UX-03, UX-05, UX-11; Sections 7–8, 14. |
| FR-05–FR-06 | UX-04–UX-05; Section 8. |
| FR-07–FR-08 | UX-06; Section 9. |
| FR-09 | UX-09; Section 12. |
| FR-10–FR-11 | UX-07; Section 10. |
| FR-12–FR-14 | UX-07–UX-08; Sections 10–11. |
| FR-15 | UX-09; Section 12. |
| FR-16–FR-18 | UX-08, UX-10; Sections 11, 14. |
| FR-19–FR-20 | UX-04, UX-11–UX-12; Section 13. |
| FR-21–FR-22 | UX-01, UX-03, UX-11; Sections 7, 14. |
| FR-23 | UX-13; Sections 2, 14. |

## 20. Handoff instructions and sources

Kiro Designer owns the visual tokens, component presentation, screen composition, responsive behavior, and UX acceptance evidence. Kiro Coder implements the authoritative states and interactions with those components. Kiro Tester validates both meaning and behavior, including failure states. The Orchestrator resolves cross-document contradictions before implementation.

Do not replace the selected fonts and palette with defaults for convenience. Do not sacrifice visible uncertainty or approval scope to make a mockup cleaner. If a design choice harms comprehension, propose a specific adjustment and validate it.

This document is a specification, not a completed prototype or evidence of user testing. No server inspection or product deployment was performed to create it.

- **U0 — Product baseline:** [02_ServerSit - PRD.md](https://chatgpt.com/library?file_id=libfile_f5450690f36c8191961e7a13d945ac3a&account_id=personal).
- **U1 — Display font:** [Bricolage Grotesque project](https://github.com/ateliertriay/bricolage).
- **U2 — Interface fonts:** [Geist font project](https://github.com/vercel/geist-font).
- **U3 — Accessibility baseline:** [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
- **U4 — Text contrast:** [Understanding Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- **U5 — Non-text contrast:** [Understanding Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast).
- **U6 — Target size:** [Understanding Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum).

External references accessed 15 November 2026. Exact dimensions and color choices are design recommendations; they are not claims of usability validation.
