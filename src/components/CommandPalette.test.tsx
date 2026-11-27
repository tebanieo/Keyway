// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { matches } from "./commandMatch";

describe("CommandPalette", () => {
  const cmds = () => [
    { id: "q", label: "Read / Query panel", keys: "q", run: vi.fn() },
    { id: "x", label: "Users & orders", group: "Example", run: vi.fn() },
  ];

  it("matches every word, in any order, against the label and group", () => {
    const [q, x] = cmds();
    expect(matches(q, "query read")).toBe(true);
    expect(matches(x, "example users")).toBe(true);
    expect(matches(x, "query")).toBe(false);
  });

  it("filters as you type and runs the highlighted command on Enter", async () => {
    const list = cmds();
    const onClose = vi.fn();
    render(<CommandPalette open commands={list} onClose={onClose} />);
    const input = screen.getByRole("combobox", { name: "Search commands" });
    fireEvent.change(input, { target: { value: "users" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalled();
    await new Promise((r) => requestAnimationFrame(r));
    expect(list[1].run).toHaveBeenCalledOnce();
  });

  it("moves the selection with the arrow keys", () => {
    render(<CommandPalette open commands={cmds()} onClose={vi.fn()} />);
    const input = screen.getByRole("combobox");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
  });
});
