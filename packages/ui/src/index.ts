/**
 * ServrSit — @servrsit/ui
 *
 * TypeScript token constants mirroring every CSS custom property defined in
 * src/tokens/. These let components reference token values programmatically
 * (e.g. for canvas drawing, SVG, Playwright assertions) without reading the
 * DOM.
 *
 * Rules:
 *   - Values here MUST stay in sync with the corresponding CSS files.
 *   - If a CSS token value changes, update this file in the same commit.
 *   - Do not introduce values here that have no CSS counterpart.
 *   - CSS custom property names are recorded in the `cssVar` field of each
 *     token object for tooling that generates CSS from TypeScript.
 */

// ─── Re-exports ──────────────────────────────────────────────────────────────

export * from "./fixtures.js";


// ─── Color tokens ────────────────────────────────────────────────────────────
// Source: src/tokens/colors.css — UX Spec §4.2

/** Base palette — hex values exactly as specified. */
export const colors = {
  /** Warm main background */
  canvas: "#F6F4EE",
  /** Forms, working cards, menus */
  surface: "#FFFFFF",
  /** Primary text and dark surfaces (e.g. transcript background) */
  ink: "#1D2532",
  /** Secondary readable text */
  mutedInk: "#56606C",
  /**
   * Primary routine action fill.
   * MUST be paired with `colors.ink` text. Never pair with white.
   */
  tangerine: "#FF7648",
  /** Identity accents and quiet feature emphasis. Not a health status. */
  lilac: "#C9B8FF",
  /** Small brand accents and editorial highlights. Not a health status. */
  citron: "#D7EF52",
  /** Non-essential separators only */
  softLine: "#DDDCD6",
  /** Input boundaries and essential control distinctions */
  controlBoundary: "#7B8490",
  /** Visible keyboard focus indicator */
  focus: "#5141C6",
} as const;

export type ColorToken = keyof typeof colors;

/** CSS custom property names for base palette tokens. */
export const colorCssVars = {
  canvas: "--color-canvas",
  surface: "--color-surface",
  ink: "--color-ink",
  mutedInk: "--color-muted-ink",
  tangerine: "--color-tangerine",
  lilac: "--color-lilac",
  citron: "--color-citron",
  softLine: "--color-soft-line",
  controlBoundary: "--color-control-boundary",
  focus: "--color-focus",
} as const satisfies Record<ColorToken, string>;


// ─── Semantic state tokens ────────────────────────────────────────────────────
// Source: src/tokens/colors.css — UX Spec §4.2 semantic states table

/**
 * Each state has a foreground (text/icon) and background.
 *
 * Usage: apply `stateColors[state].fg` to text/icon color,
 *        `stateColors[state].bg` to the container background.
 *
 * Do NOT use Lilac or Citron as substitutes for any of these states.
 */
export const stateColors = {
  /** Checked / passed — check-circle icon + precise result text */
  passed: {
    fg: "#185C44",
    bg: "#DDF5E7",
    cssVarFg: "--color-state-passed-fg",
    cssVarBg: "--color-state-passed-bg",
  },
  /** Needs attention — triangle icon + specific issue text */
  attention: {
    fg: "#794A00",
    bg: "#FFF0CE",
    cssVarFg: "--color-state-attention-fg",
    cssVarBg: "--color-state-attention-bg",
  },
  /** Failed / critical — octagon or X-circle icon + failure text */
  failed: {
    fg: "#A32F2B",
    bg: "#FDE7E5",
    cssVarFg: "--color-state-failed-fg",
    cssVarBg: "--color-state-failed-bg",
  },
  /** Unknown / stale / unavailable — question-circle or clock icon + explicit state text */
  unknown: {
    fg: "#4D5663",
    bg: "#E7EBF0",
    cssVarFg: "--color-state-unknown-fg",
    cssVarBg: "--color-state-unknown-bg",
  },
  /** In progress / informational — activity or info icon + step text */
  progress: {
    fg: "#344FA3",
    bg: "#E7ECFF",
    cssVarFg: "--color-state-progress-fg",
    cssVarBg: "--color-state-progress-bg",
  },
} as const;

export type StateColorKey = keyof typeof stateColors;


// ─── Typography tokens ────────────────────────────────────────────────────────
// Source: src/tokens/typography.css — UX Spec §4.1

export const fontFamilies = {
  /** Bricolage Grotesque — brand/display (weight 650–700) */
  display: '"Bricolage Grotesque", "Arial Black", system-ui, sans-serif',
  /** Geist Sans — interface/body/forms (weight 400–600) */
  sans: '"Geist", "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  /** Geist Mono — addresses/versions/timestamps/transcripts (weight 400–500) */
  mono: '"Geist Mono", "Fira Code", ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Monaco, Consolas, "Courier New", monospace',
} as const;

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/**
 * Type scale — desktop sizes.
 * Values: UX Spec §4.1 type scale table, desktop column.
 * All px values are stored as numbers; rem values are in the CSS.
 */
export const typeScaleDesktop = {
  display: {
    sizePx: 52,
    lineHeightPx: 56,
    weight: fontWeights.bold,
    family: fontFamilies.display,
    cssVarSize: "--text-display-size",
    cssVarLineHeight: "--text-display-line-height",
  },
  pageTitle: {
    sizePx: 36,
    lineHeightPx: 42,
    weight: fontWeights.bold,
    family: fontFamilies.display,
    cssVarSize: "--text-page-title-size",
    cssVarLineHeight: "--text-page-title-line-height",
  },
  sectionTitle: {
    sizePx: 24,
    lineHeightPx: 30,
    weight: fontWeights.semibold,
    family: fontFamilies.sans,
    cssVarSize: "--text-section-title-size",
    cssVarLineHeight: "--text-section-title-line-height",
  },
  cardTitle: {
    sizePx: 22,
    lineHeightPx: 28,
    weight: fontWeights.semibold,
    family: fontFamilies.sans,
    cssVarSize: "--text-card-title-size",
    cssVarLineHeight: "--text-card-title-line-height",
  },
  body: {
    sizePx: 16,
    lineHeightPx: 24,
    weight: fontWeights.regular,
    family: fontFamilies.sans,
    cssVarSize: "--text-body-size",
    cssVarLineHeight: "--text-body-line-height",
  },
  compact: {
    sizePx: 14,
    lineHeightPx: 20,
    weight: fontWeights.regular,
    family: fontFamilies.sans,
    cssVarSize: "--text-compact-size",
    cssVarLineHeight: "--text-compact-line-height",
  },
  technical: {
    sizePx: 13,
    lineHeightPx: 20,
    weight: fontWeights.regular,
    family: fontFamilies.mono,
    cssVarSize: "--text-technical-size",
    cssVarLineHeight: "--text-technical-line-height",
  },
} as const;

export type TypeScaleKey = keyof typeof typeScaleDesktop;

/**
 * Type scale — mobile overrides.
 * Only the roles that differ from desktop are listed.
 * Card title, body, compact, and technical are identical at both breakpoints.
 */
export const typeScaleMobile = {
  display: { sizePx: 36, lineHeightPx: 40 },
  pageTitle: { sizePx: 28, lineHeightPx: 34 },
  sectionTitle: { sizePx: 22, lineHeightPx: 28 },
} as const satisfies Partial<Record<TypeScaleKey, { sizePx: number; lineHeightPx: number }>>;


// ─── Spacing tokens ───────────────────────────────────────────────────────────
// Source: src/tokens/spacing.css — UX Spec §4.3

/** Spacing scale in px. Base unit: 8 px. */
export const spacingPx = {
  half: 4,
  1: 8,
  "1-half": 12,
  2: 16,
  3: 24,
  4: 32,
  5: 40,
  6: 48,
  8: 64,
} as const;

export const spacingCssVars = {
  half: "--space-half",
  1: "--space-1",
  "1-half": "--space-1-half",
  2: "--space-2",
  3: "--space-3",
  4: "--space-4",
  5: "--space-5",
  6: "--space-6",
  8: "--space-8",
} as const;


// ─── Corner radii ─────────────────────────────────────────────────────────────

export const radii = {
  /** Server identity cards (~20 px) */
  card: 20,
  /** Forms, action panels, drawers (16 px) */
  panel: 16,
  /** Inputs (10 px) */
  input: 10,
  /** Buttons (12 px) */
  button: 12,
  /** Pills: status badges, compact selections */
  pill: 9999,
  /** Small elements: inline chips */
  small: 6,
} as const;

export const radiiCssVars = {
  card: "--radius-card",
  panel: "--radius-panel",
  input: "--radius-input",
  button: "--radius-button",
  pill: "--radius-pill",
  small: "--radius-small",
} as const;


// ─── Motion durations ─────────────────────────────────────────────────────────
// Source: src/tokens/spacing.css — UX Spec §4.5

/** Duration values in milliseconds. */
export const durations = {
  /** Hover / focus / pressed response (0–120 ms) */
  interaction: 120,
  /** Panel open / disclosure (160–220 ms, midpoint used in CSS) */
  panelOpen: 200,
  /** State change with position preserved (150–200 ms) */
  stateChange: 175,
} as const;

export const durationCssVars = {
  interaction: "--duration-interaction",
  panelOpen: "--duration-panel-open",
  stateChange: "--duration-state-change",
} as const;


// ─── Layout constants ─────────────────────────────────────────────────────────

export const layout = {
  /** Maximum content width in px */
  contentMaxWidth: 1320,
  /** Desktop content margin in px */
  contentMarginDesktop: 40,
  /** Mobile side padding in px */
  contentPaddingMobile: 16,
  /** Navigation rail width in px */
  navRailWidth: 88,
  /** Grid column count */
  gridColumns: 12,
  /** Grid gutter in px */
  gridGutter: 24,
  /** Server card minimum width in px */
  serverCardMinWidth: 280,
  /** Minimum interactive touch/click target in px */
  touchTargetMin: 44,
  /** Mobile breakpoint upper bound in px (≤767) */
  mobileBreakpoint: 767,
  /** Tablet lower bound in px */
  tabletBreakpoint: 768,
  /** Desktop lower bound in px */
  desktopBreakpoint: 1200,
} as const;
