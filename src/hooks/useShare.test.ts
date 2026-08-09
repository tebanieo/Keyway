// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useShare } from "./useShare";
import { track } from "../analytics";

vi.mock("../analytics", () => ({ track: vi.fn() }));

describe("useShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("starts closed", () => {
    const { result } = renderHook(() => useShare());
    expect(result.current.url).toBeNull();
    expect(result.current.copied).toBe(false);
  });

  it("open() snapshots a share link and resets the copied flag", () => {
    const { result } = renderHook(() => useShare());
    act(() => result.current.open("@table T pk=PK\nu1: PK=USER#1"));
    // shareUrl builds a `#m=` fragment link; we only assert the shape.
    expect(result.current.url).toContain("#m=");
    expect(result.current.copied).toBe(false);
  });

  it("close() clears the snapshot", () => {
    const { result } = renderHook(() => useShare());
    act(() => result.current.open("x"));
    act(() => result.current.close());
    expect(result.current.url).toBeNull();
  });

  it("copy() writes the snapshot to the clipboard, sets copied, and tracks the event", async () => {
    const { result } = renderHook(() => useShare());
    act(() => result.current.open("x"));
    const url = result.current.url!;

    await act(async () => {
      await result.current.copy();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url);
    expect(result.current.copied).toBe(true);
    expect(track).toHaveBeenCalledWith("link-shared");
  });

  it("copy() is a no-op when nothing is open", async () => {
    const { result } = renderHook(() => useShare());
    await act(async () => {
      await result.current.copy();
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("the copied flag falls back to false after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useShare());
      act(() => result.current.open("x"));
      await act(async () => {
        await result.current.copy();
      });
      expect(result.current.copied).toBe(true);
      act(() => vi.advanceTimersByTime(1600));
      expect(result.current.copied).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("swallows a clipboard rejection without throwing", async () => {
    // The hook logs the URL as a fallback when the clipboard is denied; keep
    // that out of the test output.
    vi.spyOn(console, "log").mockImplementation(() => {});
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const { result } = renderHook(() => useShare());
    act(() => result.current.open("x"));
    await act(async () => {
      await result.current.copy();
    });
    // stayed false, and no throw propagated
    await waitFor(() => expect(result.current.copied).toBe(false));
  });
});
