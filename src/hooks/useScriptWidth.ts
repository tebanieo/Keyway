import { useState } from "react";

const KEY = "keyway.scriptWidth";
export const SCRIPT_MIN = 20;
export const SCRIPT_MAX = 70;
const clamp = (n: number) => Math.round(Math.min(SCRIPT_MAX, Math.max(SCRIPT_MIN, n)));

/** The script column's width, in % of the workbench, remembered per browser. */
export function useScriptWidth() {
  const [pct, setPct] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(KEY));
      return n ? clamp(n) : 40;
    } catch {
      return 40;
    }
  });
  const set = (n: number) => {
    const v = clamp(n);
    setPct(v);
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      // storage blocked: the width still applies for this visit
    }
  };
  return [pct, set] as const;
}
