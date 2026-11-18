/**
 * Local QR code rendering for the authenticator enrolment (T-065).
 * The otpauth:// URI contains the TOTP secret, so it must never leave the
 * browser: this uses the bundled qrcode-generator (MIT, no dependencies, no
 * network). Output is a plain boolean matrix; QrCode.tsx draws it as SVG.
 */
import qrcode from "qrcode-generator";

export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M"); // type 0 = smallest version that fits; M = ~15 % error correction
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** SVG path data: one rectangle per dark module, in module units. */
export function qrPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c++; continue; }
      let end = c;
      while (end < row.length && row[end]) end++;
      parts.push(`M${c} ${r}h${end - c}v1h-${end - c}z`);
      c = end;
    }
  });
  return parts.join("");
}
