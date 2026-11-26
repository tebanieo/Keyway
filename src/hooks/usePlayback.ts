import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

/**
 * The step scrubber's playback: auto-advance on a timer while `playing`, and
 * stop at the end.
 */
export function usePlayback(
  curStep: number,
  opsLength: number,
  setStep: Dispatch<SetStateAction<number>>,
) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.5);
  useEffect(() => {
    if (!playing) return;
    if (curStep >= opsLength) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setStep((s) => s + 1), 1300 / speed);
    return () => window.clearTimeout(id);
  }, [playing, curStep, opsLength, speed, setStep]);

  const togglePlay = useCallback(() => {
    if (curStep >= opsLength) setStep(0); // replay from the top
    setPlaying((p) => !p);
  }, [curStep, opsLength, setStep]);

  return { playing, setPlaying, speed, setSpeed, togglePlay };
}
