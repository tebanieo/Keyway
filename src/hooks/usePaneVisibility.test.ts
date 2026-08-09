// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePaneVisibility } from "./usePaneVisibility";

const names = (s: Set<string>) => [...s].sort();

describe("usePaneVisibility", () => {
  it("defaults to base + the last GSI", () => {
    const { result } = renderHook(() => usePaneVisibility(["Base", "GSI1", "GSI2"]));
    expect(names(result.current.visible)).toEqual(["Base", "GSI2"]);
    expect(result.current.diffOn).toBe(true);
    expect(result.current.compact).toBe(false);
  });

  it("toggling a pane adds/removes it", () => {
    const { result } = renderHook(() => usePaneVisibility(["Base", "GSI1", "GSI2"]));
    act(() => result.current.toggle("GSI1"));
    expect(result.current.visible.has("GSI1")).toBe(true);
    act(() => result.current.toggle("GSI1"));
    expect(result.current.visible.has("GSI1")).toBe(false);
  });

  it("never removes the last visible pane", () => {
    const { result } = renderHook(() => usePaneVisibility(["Base", "GSI1"]));
    // default is Base + GSI1; turn GSI1 off, then try to turn Base off too
    act(() => result.current.toggle("GSI1"));
    act(() => result.current.toggle("Base"));
    expect(names(result.current.visible)).toEqual(["Base"]);
  });

  it("toggleAll shows every pane, then collapses back to base + last GSI", () => {
    const { result } = renderHook(() => usePaneVisibility(["Base", "GSI1", "GSI2"]));
    act(() => result.current.toggleAll());
    expect(result.current.allVisible).toBe(true);
    expect(names(result.current.visible)).toEqual(["Base", "GSI1", "GSI2"]);
    act(() => result.current.toggleAll());
    expect(names(result.current.visible)).toEqual(["Base", "GSI2"]);
  });

  it("reconciles when a shown index disappears from the model", () => {
    const { result, rerender } = renderHook(({ p }) => usePaneVisibility(p), {
      initialProps: { p: ["Base", "GSI1", "GSI2"] },
    });
    // showing Base + GSI2 by default; drop GSI2 from the model
    rerender({ p: ["Base", "GSI1"] });
    // GSI2 is gone; with a GSI present but none shown, it reveals the last one
    expect(names(result.current.visible)).toEqual(["Base", "GSI1"]);
  });

  it("reveals the last GSI when the first index is declared", () => {
    const { result, rerender } = renderHook(({ p }) => usePaneVisibility(p), {
      initialProps: { p: ["Base"] },
    });
    expect(names(result.current.visible)).toEqual(["Base"]);
    rerender({ p: ["Base", "GSI1"] });
    expect(names(result.current.visible)).toEqual(["Base", "GSI1"]);
  });

  it("keeps manual pane choices across non-structural rerenders", () => {
    const { result, rerender } = renderHook(({ p }) => usePaneVisibility(p), {
      initialProps: { p: ["Base", "GSI1", "GSI2"] },
    });
    act(() => result.current.toggle("GSI2")); // hide it manually
    expect(result.current.visible.has("GSI2")).toBe(false);
    // same names, new array identity — the effect must not re-run and re-reveal
    rerender({ p: ["Base", "GSI1", "GSI2"] });
    expect(result.current.visible.has("GSI2")).toBe(false);
  });
});
