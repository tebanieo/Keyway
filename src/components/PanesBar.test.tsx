// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PanesBar } from "./PanesBar";

function setup(overrides: Partial<Parameters<typeof PanesBar>[0]> = {}) {
  const props = {
    paneNames: ["Base", "GSI1", "GSI2"],
    visible: new Set(["Base", "GSI2"]),
    onTogglePane: vi.fn(),
    showAll: true,
    allVisible: false,
    onToggleAll: vi.fn(),
    diffOn: true,
    onToggleDiff: vi.fn(),
    compact: false,
    onToggleCompact: vi.fn(),
    ...overrides,
  };
  render(<PanesBar {...props} />);
  return props;
}

describe("PanesBar", () => {
  it("renders a button per pane and marks the visible ones active", () => {
    setup();
    // toggle chips: each says on/off by itself
    expect(screen.getByRole("button", { name: "Base" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "GSI1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "GSI2" })).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles a pane by name", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "GSI1" }));
    expect(props.onTogglePane).toHaveBeenCalledWith("GSI1");
  });

  it("offers Show all only when there are GSIs and some pane is hidden", () => {
    setup({ showAll: false });
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });

  it("hides Show all once every pane is shown", () => {
    setup({ allVisible: true });
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });

  it("wires the All, Diff, and Compact toggles", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(props.onToggleAll).toHaveBeenCalledOnce();
    expect(props.onToggleDiff).toHaveBeenCalledOnce();
    expect(props.onToggleCompact).toHaveBeenCalledOnce();
  });

  it("reflects the diff/compact active state", () => {
    setup({ diffOn: false, compact: true });
    expect(screen.getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
  });
});
