// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { initialTheme, useTheme } from "./useTheme";

/** Stub the system preference; returns a function that flips it live. */
function systemPrefers(light: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return light;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => media);
  return (next: boolean) => {
    light = next;
    listeners.forEach((fn) => fn());
  };
}

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.unstubAllGlobals();
  });

  it("follows a dark system by default, and stores nothing", () => {
    systemPrefers(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.length).toBe(0);
  });

  it("follows a light system by default", () => {
    systemPrefers(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("paper");
  });

  it("follows the system live while no choice was made", () => {
    const flip = systemPrefers(false);
    const { result } = renderHook(() => useTheme());
    act(() => flip(true));
    expect(result.current.theme).toBe("paper");
    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");
  });

  it("a choice made with the toggle wins over the system, and is remembered", () => {
    const flip = systemPrefers(false);
    const { result, unmount } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("paper");
    expect(localStorage.getItem("keyway-theme")).toBe("paper");
    act(() => flip(false));
    expect(result.current.theme).toBe("paper");
    unmount();
    expect(renderHook(() => useTheme()).result.current.theme).toBe("paper");
  });

  it("keeps an old deliberate 'paper' choice, but not the old always-written 'dark'", () => {
    systemPrefers(true);
    localStorage.setItem("dc-theme", "dark");
    expect(renderHook(() => useTheme()).result.current.theme).toBe("paper"); // system wins
    systemPrefers(false);
    localStorage.setItem("dc-theme", "paper");
    expect(renderHook(() => useTheme()).result.current.theme).toBe("paper"); // carried over
  });

  it("ignores a garbage stored value", () => {
    systemPrefers(false);
    localStorage.setItem("keyway-theme", "garbage");
    expect(renderHook(() => useTheme()).result.current.theme).toBe("dark");
  });

  it("initialTheme matches what the hook will show, for the first paint", () => {
    systemPrefers(true);
    expect(initialTheme()).toBe("paper");
    localStorage.setItem("keyway-theme", "dark");
    expect(initialTheme()).toBe("dark");
  });
});
