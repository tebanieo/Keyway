import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

/**
 * The step scrubber's playback: auto-advance on a timer while `playing`, stop at
 * the end, and drive the transient cost HUD (`costPulse`) whenever a step lands
 * (via playback or a manual prev/next calling `pulseCost`).
 */
export function usePlayback(
  curStep: number,
  opsLength: number,
  setStep: Dispatch<SetStateAction<number>>,
) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [costPulse, setCostPulse] = useState(false);
  const costTimer = useRef<number | undefined>(undefined);

  // Cost is about a transition — surface the HUD when the user steps or plays,
  // then auto-hide (so it isn't "just sitting there" while editing).
  const pulseCost = useCallback(() => {
    setCostPulse(true);
    window.clearTimeout(costTimer.current);
    costTimer.current = window.setTimeout(() => setCostPulse(false), 2600);
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (curStep >= opsLength) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => {
      setStep((s) => s + 1);
      pulseCost();
    }, 1300 / speed);
    return () => window.clearTimeout(id);
  }, [playing, curStep, opsLength, speed, pulseCost, setStep]);

  const togglePlay = useCallback(() => {
    if (curStep >= opsLength) setStep(0); // replay from the top
    setPlaying((p) => !p);
  }, [curStep, opsLength, setStep]);

  return { playing, setPlaying, speed, setSpeed, togglePlay, costPulse, pulseCost };
}
