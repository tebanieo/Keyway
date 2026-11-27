// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import type { OpCost } from "../engine/cost";

const cost: OpCost = {
  base: "put",
  baseWrites: 1,
  indexes: [],
  transactional: false,
  totalWrites: 1,
};

function setup(over: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  const props = {
    curStep: 1,
    opsLength: 3,
    op: { verb: "put", detail: "u1" },
    playing: false,
    onTogglePlay: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    speed: 0.5,
    onSpeed: vi.fn(),
    cost,
    opBytes: 20,
    totalWcu: 7,
    ...over,
  };
  const { unmount } = render(<StatusBar {...props} />);
  return { ...props, unmount };
}

describe("StatusBar", () => {
  it("always shows the step, its cost and the running total", () => {
    setup();
    expect(screen.getByText(/step 1\/3/)).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument(); // Σ so far
    expect(screen.getAllByText("WCU").length).toBeGreaterThan(0);
  });

  it("announces each step through one permanent live region", () => {
    setup({ announce: "Step 1 of 3: put u1. 1 WCU." });
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent("Step 1 of 3: put u1. 1 WCU.");
  });

  it("disables prev at the start and next at the end", () => {
    const a = setup({ curStep: 0, opsLength: 3 });
    expect(screen.getByRole("button", { name: "Step back" })).toBeDisabled();
    a.unmount();
    setup({ curStep: 3, opsLength: 3 });
    expect(screen.getByRole("button", { name: "Step forward" })).toBeDisabled();
  });

  it("names Play / Pause by state and cycles the speed", () => {
    const p = setup({ speed: 0.5 });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(p.onTogglePlay).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /Playback speed/ }));
    expect(p.onSpeed).toHaveBeenCalledWith(1);
  });
});
