import { useRef } from "react";
import { CostBar } from "./CostBar";
import { Icon } from "./icons";
import type { OpCost } from "../engine/cost";

/**
 * The bottom status strip, always visible: playback, the current step, what
 * that step cost, and the running total so far. (The step's narration is read
 * in full above the tables, where the eye is: see StepNote.)
 */
export function StatusBar({
  announce = "",
  curStep,
  opsLength,
  op,
  playing,
  onTogglePlay,
  onPrev,
  onNext,
  speed,
  onSpeed,
  cost,
  opBytes,
  totalWcu,
}: {
  /** What a screen reader hears on each step: number, write, cost and note. */
  announce?: string;
  curStep: number;
  opsLength: number;
  op: { verb: string; detail: string };
  playing: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  speed: number;
  onSpeed: (n: number) => void;
  cost: OpCost | null;
  opBytes: number;
  totalWcu: number;
}) {
  const playRef = useRef<HTMLButtonElement>(null);
  // Stepping onto the last step disables Step forward under the keyboard:
  // hand focus to Play rather than dropping it on the page.
  const next = () => {
    onNext();
    if (curStep + 1 < opsLength) return;
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body)
        playRef.current?.focus();
    });
  };
  return (
    <section className="statusbar" aria-label="Playback and cost">
      {/* One permanent live region, so every step is announced (a region
          inserted already filled is read unreliably). */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
      <div className="stepper" role="group" aria-label="Playback">
        <button disabled={curStep === 0} onClick={onPrev} title="step back" aria-label="Step back">
          <Icon name="prev" />
        </button>
        <button
          className="play"
          ref={playRef}
          onClick={onTogglePlay}
          title="auto-play"
          aria-label={playing ? "Pause" : "Play"}
        >
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <button
          disabled={curStep === opsLength}
          onClick={next}
          title="step forward"
          aria-label="Step forward"
        >
          <Icon name="next" />
        </button>
        <button
          className="speed"
          onClick={() => onSpeed(speed === 1 ? 2 : speed === 2 ? 0.5 : 1)}
          title="playback speed (click to cycle)"
          aria-label={`Playback speed ${speed}×`}
        >
          {speed}&times;
        </button>
      </div>

      <div className={cost?.rejected ? "sb-step rejected" : "sb-step"}>
        <div className="op-label">
          step {curStep}/{opsLength} &middot; <b>{op.verb}</b> {op.detail}
        </div>
      </div>

      <CostBar cost={cost} bytes={opBytes} />

      <div className="sb-total" title="write units of every step so far">
        <span className="sb-sigma">Σ</span>
        <b>{totalWcu}</b>
        <span className="unit">WCU</span>
        <span className="sb-so-far">so far</span>
      </div>
    </section>
  );
}
