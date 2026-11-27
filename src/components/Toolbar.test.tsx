// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toolbar } from "./Toolbar";

function setup(over: Partial<Parameters<typeof Toolbar>[0]> = {}) {
  const props = {
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
  it("renders the brand, and wires theme and share", () => {
    const p = setup();
    expect(screen.getByRole("heading", { name: /Keyway/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Canvas" })).toBeNull(); // one interface
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
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
