import qrcode from "qrcode-generator";

export interface QrPath {
  /** SVG path data: one 1x1 square per dark module. */
  d: string;
  /** viewBox side length in modules, quiet zone included. */
  size: number;
}

/**
 * Build an SVG path for a QR encoding of `text`, or null when the text is too
 * large to fit even the biggest symbol (version 40). Pure geometry, no DOM, so
 * the caller renders a themeable <svg> from it. Uses the lowest error
 * correction ("L") to let a share link carry as much model as possible.
 */
export function qrPath(text: string, quietZone = 2): QrPath | null {
  try {
    const qr = qrcode(0, "L"); // type 0 = auto-pick the smallest version that fits
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          d += `M${col + quietZone} ${row + quietZone}h1v1h-1z`;
        }
      }
    }
    return { d, size: count + quietZone * 2 };
  } catch {
    return null; // data exceeds QR capacity
  }
}
