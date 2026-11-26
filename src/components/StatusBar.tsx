import { CostBar } from "./CostBar";
import { Icon } from "./icons";
import type { OpCost } from "../engine/cost";

/**
 * The bottom status strip, always visible: playback, the current step and its
 * narration, what that step cost, and the running total so far. It replaces
 * the floating narration pill and the cost pop-up that vanished after a beat,
 * so cost has a permanent home and nothing covers the tables.
 */
export function StatusBar({
  curStep,
  opsLength,
  op,
  narration,
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
  curStep: number;
  opsLength: number;
  op: { verb: string; detail: string };
  narration?: string;
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
  return (
    <section className="statusbar" aria-label="Playback and cost">
      <div className="stepper" role="group" aria-label="Playback">
        <button disabled={curStep === 0} onClick={onPrev} title="step back" aria-label="Step back">
          <Icon name="prev" />
        </button>
        <button
          className="play"
          onClick={onTogglePlay}
          title="auto-play"
          aria-label={playing ? "Pause" : "Play"}
        >
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <button
          disabled={curStep === opsLength}
          onClick={onNext}
          title="step forward"
          aria-label="Step forward"
        >
          <Icon name="next" />
        </button>
        <button
          className="speed"
          onClick={() => onSpeed(speed === 0.5 ? 1 : speed === 1 ? 2 : 0.5)}
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
        {narration && (
          <div className="sb-narration" role="status">
            {narration}
          </div>
        )}
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
