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
    ...over,
  };
  const { unmount } = render(<Toolbar {...props} />);
  return { ...props, unmount };
}

describe("Toolbar", () => {
  it("renders the brand and the mode toggle", () => {
    setup();
    expect(screen.getByRole("heading", { name: /Keyway/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Canvas" })).toHaveClass("active");
    // state is exposed, not only shown by colour
    expect(screen.getByRole("button", { name: "Canvas" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Editor" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Editor" })).not.toHaveClass("active");
  });

  it("wires mode, theme, and share", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
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
});
