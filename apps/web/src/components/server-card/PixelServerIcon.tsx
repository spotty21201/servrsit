/**
 * PixelServerIcon — 16×16 pixel-art rack server (ADR-011 F4)
 *
 * Identity only: the fill is the server's identity color (Lilac / Citron /
 * Tangerine). It never reflects health. The "LEDs" are white, never green or
 * red, so they cannot be read as a status light.
 *
 * Rendered at 48 px (exact 3× scale) with shape-rendering="crispEdges" so
 * every pixel is a solid square with no anti-aliasing.
 */
import type { ServerEmblemVariant } from "../../fixtures/overview.js";

const IDENTITY_FILL: Record<ServerEmblemVariant, string> = {
  lilac: "var(--color-lilac)",
  citron: "var(--color-citron)",
  tangerine: "var(--color-tangerine)",
};

// k = Ink outline/slots, f = identity fill, w = white LED, . = transparent
const PIXELS = [
  "................",
  ".kkkkkkkkkkkkkk.",
  ".kffffffffffffk.",
  ".kfkkkffffwfwfk.",
  ".kffffffffffffk.",
  ".kkkkkkkkkkkkkk.",
  ".kffffffffffffk.",
  ".kfkkkffffwfwfk.",
  ".kffffffffffffk.",
  ".kkkkkkkkkkkkkk.",
  ".kffffffffffffk.",
  ".kfkkkffffwfwfk.",
  ".kffffffffffffk.",
  ".kkkkkkkkkkkkkk.",
  "..kk........kk..",
  "................",
] as const;

type Run = { x: number; y: number; w: number; c: "k" | "f" | "w" };

/** Merge horizontal runs of the same color into single rects. */
function toRuns(rows: readonly string[]): Run[] {
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (c === "k" || c === "f" || c === "w") {
        let end = x + 1;
        while (row[end] === c) end++;
        runs.push({ x, y, w: end - x, c });
        x = end;
      } else {
        x++;
      }
    }
  });
  return runs;
}

const RUNS = toRuns(PIXELS);

interface PixelServerIconProps {
  variant: ServerEmblemVariant;
  /** Rendered size in CSS px; keep a multiple of 16 for crisp pixels. CSS on `className` may override (e.g. 32px on mobile). */
  size?: number;
  className?: string;
}

export function PixelServerIcon({ variant, size = 48, className }: PixelServerIconProps) {
  const fillFor = (c: Run["c"]) =>
    c === "k" ? "var(--color-ink)" : c === "w" ? "var(--color-surface)" : IDENTITY_FILL[variant];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flexShrink: 0 }}
    >
      {RUNS.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={fillFor(r.c)} />
      ))}
    </svg>
  );
}
