// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to dark and reflects it onto the document + storage", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("dc-theme")).toBe("dark");
  });

  it("restores paper from localStorage", () => {
    localStorage.setItem("dc-theme", "paper");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("paper");
  });

  it("treats any non-paper stored value as dark", () => {
    localStorage.setItem("dc-theme", "garbage");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("toggles between dark and paper, persisting each flip", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("paper");
    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");
    expect(localStorage.getItem("dc-theme")).toBe("paper");
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("dark");
    expect(localStorage.getItem("dc-theme")).toBe("dark");
  });
});
