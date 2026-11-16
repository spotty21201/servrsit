---
inclusion: always
---

# ServrSit — Design steering

## Visual identity (from UX Spec §4)

### Typography

| Role | Typeface | Weight |
|---|---|---|
| Brand / display headings | **Bricolage Grotesque** | 650–700, normal width |
| Interface, body, forms, buttons | **Geist Sans** | 400 prose, 500–600 labels/actions |
| Addresses, versions, timestamps, transcripts | **Geist Mono** | 400–500, tabular figures |

Both fonts are open-licensed. Serve pinned assets through the application's own delivery path — do not rely on Vercel CDN. Provide system fallbacks. Load only required styles.

### Color tokens

| Token | Value | Purpose |
|---|---|---|
| Canvas | `#F6F4EE` | Warm main background |
| Surface | `#FFFFFF` | Forms, working cards, menus |
| Ink | `#1D2532` | Primary text and dark surfaces |
| Muted ink | `#56606C` | Secondary readable text |
| Tangerine | `#FF7648` | Primary routine action fill — pair with Ink text, NOT white |
| Lilac | `#C9B8FF` | Identity accents, quiet feature emphasis |
| Citron | `#D7EF52` | Small brand accents, editorial highlights |
| Soft line | `#DDDCD6` | Non-essential separators only |
| Control boundary | `#7B8490` | Input boundaries, essential control distinctions |
| Focus | `#5141C6` | Visible keyboard focus indicator |

**Semantic states:**

| Condition | Foreground | Background |
|---|---|---|
| Checked / passed | `#185C44` | `#DDF5E7` |
| Needs attention | `#794A00` | `#FFF0CE` |
| Failed / critical | `#A32F2B` | `#FDE7E5` |
| Unknown / stale | `#4D5663` | `#E7EBF0` |
| In progress | `#344FA3` | `#E7ECFF` |

**Rules:** Lilac and Citron are identity/brand accents — not health status colors. ~75% of a normal overview stays neutral. Stage A ships light theme only; no auto-invert from OS preference.

### Spacing and shape

- 8 px rhythm; 4 px for small internal relationships; 32–48 px section spacing desktop; 24–32 px mobile.
- Server cards ~20 px corners; forms/panels 16 px; inputs/buttons 10–12 px.
- One filled primary button per decision group.

### Motion

- Hover/focus response: immediate–120 ms.
- Panel open: 160–220 ms.
- State change: 150–200 ms, preserve item position.
- Respect `prefers-reduced-motion`. Never animate a status to success before authoritative verification.

## Three visual signatures (non-negotiable)

1. **Typographic daily briefing** — large expressive fleet-state headline.
2. **Recognizable server identities** — name, role, stable geometric emblem (identity color, never health color), explicit status badge.
3. **Clear action receipts** — structured, readable records with expandable evidence.

## What the design must never do

- Resemble a default admin dashboard or a wall of equal metric cards.
- Use Tangerine with white text.
- Use Lilac or Citron as health status indicators.
- Hide unknown/stale/partial state to make a mockup look cleaner.
- Use an oversized empty chatbot as the primary interface.
- Auto-invert colors based on OS dark mode preference (Stage A is light theme only).
- Rotate functional cards, fields, or text.
- Animate status to success before verification is confirmed.
- Use generic component-library default styling as the product's visual identity.

## Designer's ownership

- `packages/ui/` — tokens, accessible presentation components.
- Presentation portion of `apps/web/` — screens, layout, composition, states.
- High-fidelity core screens before the UI spreads: overview, server detail, plan review, operation result/unknown, connection flow, mobile approval.
- All loading, stale, partial, blocked, failed, and outcome-unknown states — not just the success path.

## Designer's boundary

- Do not change shared domain contracts in `packages/contracts/` or `packages/domain/` independently.
- Agree API/state adapter boundary with Coder before touching shared interfaces.
- Design changes that affect operations, approval scope, or permission model return to the Orchestrator.

## Founder overrides (ADR-011, 2026-11-15) — these supersede conflicting text above

- No large briefing headline on the Overview. Retired signature 1.
- Canvas is no longer `#F6F4EE`. Background is under redesign; follow the latest approved mockup.
- Display/title weight is light (300 minimum). Do not use hairline weights.
- Server emblem is a pixel-art server icon (identity color only, never health).
- Overview order: server cards first, attention list, then a short, narrow chat bar at the bottom.
- Unknown/stale/failed states must still be visible and never shown as healthy.
- (Round 2) Background is white. Titles and server names use an open-licensed pixel font (self-hosted, license committed); body, controls, data stay in a readable sans/mono. Pixel icons for servers. Mobile must be anchored: no horizontal scroll or drift.
