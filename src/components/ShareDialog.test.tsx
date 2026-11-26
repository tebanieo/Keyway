// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShareDialog } from "./ShareDialog";

const SHORT = "https://tebanieo.github.io/Keyway/#m=N4Igabc";

function setup(over: Partial<Parameters<typeof ShareDialog>[0]> = {}) {
  const props = {
    open: true,
    url: SHORT,
    copied: false,
    onCopy: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<ShareDialog {...props} />);
  return props;
}

describe("ShareDialog", () => {
  it("renders an empty, closed dialog when closed", () => {
    const { container } = render(
      <ShareDialog open={false} url={SHORT} copied={false} onCopy={() => {}} onClose={() => {}} />,
    );
    const dialog = container.querySelector("dialog")!;
    expect(dialog).not.toHaveAttribute("open");
    expect(dialog).toBeEmptyDOMElement();
  });

  it("is a modal dialog that focuses Copy link", () => {
    setup();
    const dialog = document.querySelector("dialog")!;
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveAccessibleName("Share this model");
    expect(screen.getByRole("button", { name: "Copy link" })).toHaveFocus();
  });

  it("shows a scannable QR and the link for a small model", () => {
    setup();
    expect(screen.getByRole("img", { name: /QR code/ })).toBeInTheDocument();
    expect(screen.getByLabelText("shareable link")).toHaveValue(SHORT);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("flips the copy button to Copied and fires onCopy", () => {
    const p = setup({ copied: true });
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copied" }));
    expect(p.onCopy).toHaveBeenCalledOnce();
  });

  it("closes from the button and on Escape", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close share dialog" }));
    // Escape on a modal <dialog> arrives as its `cancel` event
    fireEvent(document.querySelector("dialog")!, new Event("cancel", { cancelable: true }));
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });

  it("degrades to a copy-the-text note when too large for a link", () => {
    setup({ url: "x".repeat(9000) });
    expect(screen.getByText(/too large to fit in a link/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /QR code/ })).toBeNull();
  });

  it("shows a link-only note when it fits a URL but is too dense for a QR", () => {
    // between the QR capacity (~2953) and SAFE_URL_LEN (8000): link works, QR doesn't
    setup({ url: "x".repeat(4000) });
    expect(screen.getByText(/too dense for a QR/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });
});
