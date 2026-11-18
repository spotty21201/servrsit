import { useMemo } from "react";
import { qrMatrix, qrPath } from "./qr";

/** Locally rendered QR code (SVG). White quiet zone of 4 modules included. */
export function QrCode({ value, label, size = 192 }: { value: string; label: string; size?: number }) {
  const { path, n } = useMemo(() => {
    const m = qrMatrix(value);
    return { path: qrPath(m), n: m.length };
  }, [value]);
  const q = 4;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`${-q} ${-q} ${n + 2 * q} ${n + 2 * q}`} shapeRendering="crispEdges" style={{ maxWidth: "100%", height: "auto", background: "#fff", display: "block" }}>
      <rect x={-q} y={-q} width={n + 2 * q} height={n + 2 * q} fill="#fff" />
      <path d={path} fill="#1D2532" />
    </svg>
  );
}
