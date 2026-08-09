// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDrawers } from "./useDrawers";

describe("useDrawers", () => {
  it("opens with no drawer and an empty highlight", () => {
    const { result } = renderHook(() => useDrawers(true));
    expect(result.current.drawer).toBeNull();
    expect(result.current.highlight.matched.size).toBe(0);
    expect(result.current.highlight.scanned.size).toBe(0);
  });

  it("toggle opens a drawer, and toggling the same one closes it", () => {
    const { result } = renderHook(() => useDrawers(false));
    act(() => result.current.toggle("examples"));
    expect(result.current.drawer).toBe("examples");
    act(() => result.current.toggle("examples"));
    expect(result.current.drawer).toBeNull();
  });

  it("toggling a different drawer switches to it", () => {
    const { result } = renderHook(() => useDrawers(false));
    act(() => result.current.toggle("examples"));
    act(() => result.current.toggle("learn"));
    expect(result.current.drawer).toBe("learn");
  });

  it("close() dismisses whatever is open", () => {
    const { result } = renderHook(() => useDrawers(false));
    act(() => result.current.toggle("query"));
    act(() => result.current.close());
    expect(result.current.drawer).toBeNull();
  });

  it("clears the query highlight when the drawer is not the query drawer", () => {
    const { result } = renderHook(() => useDrawers(false));
    act(() => result.current.toggle("query"));
    act(() =>
      result.current.setHighlight({ matched: new Set(["a"]), scanned: new Set(["a", "b"]) }),
    );
    expect(result.current.highlight.matched.size).toBe(1);

    // moving off the query drawer wipes the highlight
    act(() => result.current.toggle("query")); // closes it
    expect(result.current.highlight.matched.size).toBe(0);
    expect(result.current.highlight.scanned.size).toBe(0);
  });

  it("auto-closes the query drawer when the model empties out", () => {
    const { result, rerender } = renderHook(({ empty }) => useDrawers(empty), {
      initialProps: { empty: false },
    });
    act(() => result.current.toggle("query"));
    expect(result.current.drawer).toBe("query");

    rerender({ empty: true });
    expect(result.current.drawer).toBeNull();
  });

  it("does not touch other drawers when the model empties out", () => {
    const { result, rerender } = renderHook(({ empty }) => useDrawers(empty), {
      initialProps: { empty: false },
    });
    act(() => result.current.toggle("examples"));
    rerender({ empty: true });
    expect(result.current.drawer).toBe("examples");
  });

  it("dismisses the open drawer on a mousedown outside the rail/drawer", () => {
    const { result } = renderHook(() => useDrawers(false));
    act(() => result.current.toggle("examples"));

    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(result.current.drawer).toBeNull();
  });

  it("keeps the drawer open on a mousedown inside the rail", () => {
    const { result } = renderHook(() => useDrawers(false));
    act(() => result.current.toggle("examples"));

    const rail = document.createElement("div");
    rail.className = "rail";
    document.body.appendChild(rail);
    act(() => {
      rail.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(result.current.drawer).toBe("examples");
    rail.remove();
  });
});
