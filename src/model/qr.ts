import qrcode from "qrcode-generator";

export type QrLevel = "L" | "M" | "Q" | "H";

export interface QrPath {
  /** SVG path data: one 1x1 square per dark module. */
  d: string;
  /** viewBox side length in modules, quiet zone included. */
  size: number;
  /** The error-correction level that fit the data (drives safe logo size). */
  level: QrLevel;
}

// Strongest error correction first: more recovery lets a center logo cover more
// of the symbol. We take the strongest level that still fits, so short models
// host a bolder keyhole and only large ones step down toward more capacity.
// Approx. byte capacity at version 40: H 1273, Q 1663, M 2331, L 2953.
const LEVELS: QrLevel[] = ["H", "Q", "M", "L"];

/**
 * Build an SVG path for a QR encoding of `text`, or null when the text is too
 * large to fit even the biggest symbol (version 40) at the weakest correction.
 * Pure geometry, no DOM, so the caller renders a themeable <svg> from it.
 */
export function qrPath(text: string, quietZone = 2): QrPath | null {
  for (const level of LEVELS) {
    try {
      const qr = qrcode(0, level); // type 0 = auto-pick the smallest version that fits
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
      return { d, size: count + quietZone * 2, level };
    } catch {
      // Data exceeds this level's capacity; try the next weaker one.
    }
  }
  return null; // exceeds capacity even at level L
}

/**
 * Safe center-logo width as a fraction of the symbol, per correction level. A
 * square logo of fraction f erases ~f² of the modules; every value here stays
 * well under the level's recovery budget so the code still scans.
 */
export function qrLogoFraction(level: QrLevel): number {
  switch (level) {
    case "H":
      return 0.22;
    case "Q":
      return 0.19;
    case "M":
      return 0.16;
    case "L":
      return 0.12;
  }
}
