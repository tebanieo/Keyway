// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useShortcuts } from "./useShortcuts";

const press = (key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));

describe("useShortcuts", () => {
  beforeEach(() => localStorage.clear());

  it("runs a single-key shortcut when you're not typing", () => {
    const run = vi.fn();
    renderHook(() => useShortcuts([{ key: "q", label: "Query", run }], vi.fn()));
    press("q");
    expect(run).toHaveBeenCalledOnce();
    const input = document.body.appendChild(document.createElement("input"));
    press("q", input);
    expect(run).toHaveBeenCalledOnce(); // typing in a field: left alone
    input.remove();
  });

  it("opens the palette with Ctrl/Cmd+K, even from a field", () => {
    const palette = vi.fn();
    renderHook(() => useShortcuts([], palette));
    const input = document.body.appendChild(document.createElement("input"));
    press("k", input, { ctrlKey: true });
    press("k", input, { metaKey: true });
    expect(palette).toHaveBeenCalledTimes(2);
    input.remove();
  });

  it("can be switched off, and remembers it", () => {
    const run = vi.fn();
    const { result } = renderHook(() => useShortcuts([{ key: "q", label: "Query", run }], vi.fn()));
    act(() => result.current.setEnabled(false));
    press("q");
    expect(run).not.toHaveBeenCalled();
    const again = renderHook(() => useShortcuts([], vi.fn()));
    expect(again.result.current.enabled).toBe(false);
  });
});
