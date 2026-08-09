// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { usePlayback } from "./usePlayback";

// usePlayback doesn't own the step; the parent does. This harness models that:
// it holds curStep in state and hands usePlayback the setter, so auto-advance
// actually moves the step and re-runs the effect like it does in App.
function useHarness(opsLength: number, initialStep = 0) {
  const [curStep, setStep] = useState(initialStep);
  const pb = usePlayback(curStep, opsLength, setStep);
  return { curStep, setStep, ...pb };
}

describe("usePlayback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts paused at half speed with no cost pulse", () => {
    const { result } = renderHook(() => useHarness(3));
    expect(result.current.playing).toBe(false);
    expect(result.current.speed).toBe(0.5);
    expect(result.current.costPulse).toBe(false);
  });

  it("auto-advances the step while playing and stops at the end", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness(2));

    act(() => result.current.setPlaying(true));
    act(() => vi.advanceTimersByTime(1300 / 0.5)); // 0 -> 1
    expect(result.current.curStep).toBe(1);
    act(() => vi.advanceTimersByTime(1300 / 0.5)); // 1 -> 2 (== opsLength)
    expect(result.current.curStep).toBe(2);
    // reaching the end stops playback
    expect(result.current.playing).toBe(false);
  });

  it("pulseCost shows the HUD, then hides it after 2.6s", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness(3));
    act(() => result.current.pulseCost());
    expect(result.current.costPulse).toBe(true);
    act(() => vi.advanceTimersByTime(2600));
    expect(result.current.costPulse).toBe(false);
  });

  it("togglePlay from the end replays from step 0", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness(2, 2)); // start at the end
    act(() => result.current.togglePlay());
    expect(result.current.curStep).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it("togglePlay pauses when already playing mid-way", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness(5, 1));
    act(() => result.current.setPlaying(true));
    act(() => result.current.togglePlay());
    expect(result.current.playing).toBe(false);
  });

  it("does not advance while paused", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness(3));
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.curStep).toBe(0);
  });
});
