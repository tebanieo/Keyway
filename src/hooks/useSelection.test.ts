// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSelection } from "./useSelection";

describe("useSelection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no clipboard; stub a resolving writeText.
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("starts with nothing hovered, pinned, or copied", () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.hoveredId).toBeNull();
    expect(result.current.pinnedId).toBeNull();
    expect(result.current.copied).toBeNull();
  });

  it("pins an item, and pinning the same item again unpins it", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.link.onPin("a"));
    expect(result.current.pinnedId).toBe("a");

    act(() => result.current.link.onPin("a"));
    expect(result.current.pinnedId).toBeNull();
  });

  it("switches the pin when a different item is pinned", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.link.onPin("a"));
    act(() => result.current.link.onPin("b"));
    expect(result.current.pinnedId).toBe("b");
  });

  it("tracks the hovered id and clears it on leave", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.link.onHover("x"));
    expect(result.current.hoveredId).toBe("x");
    act(() => result.current.link.onHover(null));
    expect(result.current.hoveredId).toBeNull();
  });

  it("copies a value to the clipboard and shows a toast that clears after 1.4s", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.link.onCopy("hello"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe("hello");

    act(() => vi.advanceTimersByTime(1400));
    expect(result.current.copied).toBeNull();
  });

  it("ignores a copy of the empty string (blank cell)", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.link.onCopy(""));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(result.current.copied).toBeNull();
  });

  it("a newer copy replaces the toast without an early timer clobbering it", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.link.onCopy("first"));
    act(() => vi.advanceTimersByTime(1000)); // first's timer not yet due
    act(() => result.current.link.onCopy("second"));

    // The first copy's timer fires; it must not clear "second".
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.copied).toBe("second");

    act(() => vi.advanceTimersByTime(1000)); // second's own timer
    expect(result.current.copied).toBeNull();
  });
});
