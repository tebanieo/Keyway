import { useState } from "react";
import { SCRIPT_MAX as MAX, SCRIPT_MIN as MIN } from "../hooks/useScriptWidth";

/**
 * The script's right edge: drag it, or focus it and use the arrow keys
 * (Home/End for the limits), to give the script or the tables more room.
 */
export function Splitter({ pct, onChange }: { pct: number; onChange: (pct: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const toPct = (el: HTMLElement, x: number) => {
    const main = el.closest(".wb-main")!.getBoundingClientRect();
    return ((x - main.left) / main.width) * 100;
  };
  return (
    <div
      className={dragging ? "wb-split dragging" : "wb-split"}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the script"
      aria-valuenow={pct}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (dragging) onChange(toPct(e.currentTarget, e.clientX));
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => onChange(40)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 2;
        const next: Record<string, number> = {
          ArrowLeft: pct - step,
          ArrowRight: pct + step,
          Home: MIN,
          End: MAX,
        };
        if (e.key in next) {
          e.preventDefault();
          onChange(next[e.key]);
        }
      }}
    />
  );
}
