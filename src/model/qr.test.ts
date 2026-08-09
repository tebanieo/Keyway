import { describe, expect, it } from "vitest";
import { qrPath } from "./qr";

describe("qrPath", () => {
  it("encodes a short link into a square module grid", () => {
    const qr = qrPath("https://tebanieo.github.io/Keyway/#m=abc");
    expect(qr).not.toBeNull();
    // Real QR versions are 21..177 modules; plus a quiet zone on each side.
    expect(qr!.size).toBeGreaterThan(21);
    expect(qr!.d.length).toBeGreaterThan(0);
    expect(qr!.d.startsWith("M")).toBe(true);
  });

  it("grows the symbol as the payload grows", () => {
    const small = qrPath("x")!;
    const big = qrPath("x".repeat(600))!;
    expect(big.size).toBeGreaterThan(small.size);
  });

  it("honors the quiet-zone margin in the viewBox size", () => {
    const q0 = qrPath("hello", 0)!;
    const q4 = qrPath("hello", 4)!;
    expect(q4.size - q0.size).toBe(8); // 4 modules on each side
  });

  it("returns null when the payload exceeds even version 40", () => {
    // Byte mode at ECC L tops out around 2953 bytes; well past it → no symbol.
    expect(qrPath("a".repeat(5000))).toBeNull();
  });
});
