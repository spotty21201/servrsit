# UX feedback 001 — Founder review of Overview mockup v1

Date: 2026-11-15 · Reviewer: Spotty (founder) · Interviewer: Orchestrator
Subject: Overview screen v1 (fixture data), viewed in browser. Device/viewport: not stated.

## Founder statements (verbatim intent)

1. Overall: "too bland." The warm colors do not help.
2. Headline "Two things need a look." — "ruins everything. Remove it."
3. Warm background is bad. "Try something better."
4. Title font is too bold. Use a thin, minimal font.
5. Server cards look good. Keep them. Curious about a pixelated server icon.
6. Layout: move chat box to the bottom; put server cards on top; chat box shorter and not too wide.

## Resulting decisions (see ADR-011)

| # | Change | Conflicts with | Handling |
|---|---|---|---|
| F1 | Remove the large briefing headline | UX Spec §1 signature 1, §8.1; PRD FR-06 (default view answers "what needs attention") | Founder decision wins. The attention answer must still be available: status badges on cards and the attention list carry it. No fake "all clear". |
| F2 | Replace warm Canvas `#F6F4EE` with a different background | UX Spec §4.2 | Designer proposes 3 variants, switchable for comparison. Contrast must still pass. |
| F3 | Thin/minimal title typeface weight | UX Spec §4.1 (Bricolage 650-700) | Display weight lightened. Floor is a light weight (300+), not hairline, to keep legibility. Body weights unchanged. |
| F4 | Pixel-art server icon in cards | UX Spec §4.4 (abstract geometric emblem) | Replace emblem with a pixel server icon. Still identity-only, never health color. |
| F5 | Server cards first, chat bar at bottom, shorter and narrower | UX Spec §5.2 order | Adopt. Chat bar must stay clearly labeled and scoped. |
| F6 | Keep server card design | none | Preserve layout and anatomy (article, heading link, separate action). |

## Open questions for the founder (ask next round)

- Which background direction felt closest: cool light, dark, or colored?
- Dark theme is now plausible. Is it wanted? (UX Spec deferred it.)
- Mobile: viewed or not?
