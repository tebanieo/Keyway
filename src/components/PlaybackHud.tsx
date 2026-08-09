import { CostBar } from "./CostBar";
import type { OpCost } from "../engine/cost";

// The transient overlay shown while auto-playing (or on a single-step cost
// pulse): the current step's narration and its write-cost readout. Keyed on
// curStep so each step re-triggers the entrance animation.
export function PlaybackHud({
  visible,
  narration,
  curStep,
  cost,
  opBytes,
}: {
  visible: boolean;
  narration?: string;
  curStep: number;
  cost: OpCost | null;
  opBytes: number;
}) {
  if (!visible) return null;
  return (
    <>
      {narration && (
        <div
          className={cost?.rejected ? "narration rejected" : "narration"}
          key={`narr-${curStep}`}
        >
          <span className="narr-step">{curStep}</span>
          <span className="narr-text">{narration}</span>
        </div>
      )}
      {cost && (
        <div className="cost-hud" key={`cost-${curStep}`}>
          <CostBar cost={cost} bytes={opBytes} />
        </div>
      )}
    </>
  );
}
