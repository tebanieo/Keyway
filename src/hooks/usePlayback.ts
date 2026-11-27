import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

/** Base time on a step at 1×, before any time to read its note. */
export const STEP_MS = 2600;
/** Reading time per character of the step's note (about 25 chars a second). */
export const READ_MS_PER_CHAR = 40;

/**
 * The step scrubber's playback: auto-advance on a timer while `playing`, and
 * stop at the end. Each step is held long enough to read its note: a long
 * note gets more time than a bare write (`noteLength`).
 */
export function usePlayback(
  curStep: number,
  opsLength: number,
  setStep: Dispatch<SetStateAction<number>>,
  noteLength = 0,
) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing) return;
    if (curStep >= opsLength) {
      setPlaying(false);
      return;
    }
    const hold = (STEP_MS + noteLength * READ_MS_PER_CHAR) / speed;
    const id = window.setTimeout(() => setStep((s) => s + 1), hold);
    return () => window.clearTimeout(id);
  }, [playing, curStep, opsLength, speed, setStep, noteLength]);

  const togglePlay = useCallback(() => {
    if (curStep >= opsLength) setStep(0); // replay from the top
    setPlaying((p) => !p);
  }, [curStep, opsLength, setStep]);

  return { playing, setPlaying, speed, setSpeed, togglePlay };
}
