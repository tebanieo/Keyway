// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppRail } from "./AppRail";

function setup(over: Partial<Parameters<typeof AppRail>[0]> = {}) {
  const onToggle = vi.fn();
  const props = {
    reveal: false,
    drawer: null,
    onToggle,
    hasData: false,
    apCount: 0,
    apUnserved: 0,
    ...over,
  };
  render(<AppRail {...props} />);
  return { onToggle };
}

describe("AppRail", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows Examples / Learn / Docs but hides Query and Patterns with no data", () => {
    setup();
    expect(screen.getByRole("button", { name: /Examples/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Learn/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Docs/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Query/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Access Patterns/ })).toBeNull();
  });

  it("reveals Query once there's data and Patterns (with a badge) once declared", () => {
    setup({ hasData: true, apCount: 3, apUnserved: 2 });
    expect(screen.getByRole("button", { name: /Query/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Access Patterns/ })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // unserved badge
  });

  it("toggles a drawer on click", () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Examples/ }));
    expect(onToggle).toHaveBeenCalledWith("examples");
  });

  it("opens the docs site in a new tab", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Docs/ }));
    expect(open).toHaveBeenCalledWith(expect.stringContaining("docs/"), "_blank", "noopener");
  });
});
