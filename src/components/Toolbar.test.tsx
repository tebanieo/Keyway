// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toolbar } from "./Toolbar";

function setup(over: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const props = {
    mode: "canvas" as const,
    onMode: vi.fn(),
    theme: "dark" as const,
    onToggleTheme: vi.fn(),
    onShare: vi.fn(),
    dirty: true,
    onReset: vi.fn(),
    pinnedId: null as string | null,
    onUnpin: vi.fn(),
    curStep: 1,
    opsLength: 3,
    op: { verb: "PUT", detail: "u1" },
    playing: false,
    onTogglePlay: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    speed: 0.5,
    onSpeed: vi.fn(),
    ...over,
  };
  const { unmount } = render(<Toolbar {...props} />);
  return { ...props, unmount };
}

describe("Toolbar", () => {
  it("renders the brand, mode toggle, and step label", () => {
    setup();
    expect(screen.getByRole("heading", { name: /Keyway/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Canvas" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "Editor" })).not.toHaveClass("active");
    expect(screen.getByText(/step 1\/3/)).toBeInTheDocument();
  });

  it("wires mode, theme, and share", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(p.onMode).toHaveBeenCalledWith("editor");
    expect(p.onToggleTheme).toHaveBeenCalledOnce();
    expect(p.onShare).toHaveBeenCalledOnce();
  });

  it("shows Reset only when dirty", () => {
    const p = setup({ dirty: true });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(p.onReset).toHaveBeenCalledOnce();
    p.unmount();
    setup({ dirty: false });
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("shows the pin chip only when pinned and unpins on click", () => {
    const p = setup({ pinnedId: "u1abcdef99" });
    const chip = screen.getByText(/Pinned/);
    expect(chip).toBeInTheDocument();
    fireEvent.click(chip);
    expect(p.onUnpin).toHaveBeenCalledOnce();
  });

  it("disables prev at the start and next at the end", () => {
    const a = setup({ curStep: 0, opsLength: 3 });
    expect(screen.getByRole("button", { name: "step back" })).toBeDisabled();
    a.unmount();
    setup({ curStep: 3, opsLength: 3 });
    expect(screen.getByRole("button", { name: "step forward" })).toBeDisabled();
  });

  it("cycles the speed 0.5 -> 1", () => {
    const p = setup({ speed: 0.5 });
    fireEvent.click(screen.getByRole("button", { name: "playback speed" }));
    expect(p.onSpeed).toHaveBeenCalledWith(1);
  });
});
