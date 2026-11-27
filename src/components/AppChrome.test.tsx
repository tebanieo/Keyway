// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppHint, AppFooter, CopiedToast, ResetToast, StepNote } from "./AppChrome";

describe("AppHint", () => {
  it("guides a first model in full while the model is empty", () => {
    render(<AppHint empty />);
    expect(screen.getByText(/scaffolds a row/)).toBeInTheDocument();
    expect(screen.getByText(/GSI2PK/)).toBeInTheDocument();
  });

  it("is one line once there's a model", () => {
    render(<AppHint empty={false} />);
    expect(screen.getByText(/Double-click a cell to edit it/)).toBeInTheDocument();
    expect(screen.queryByText(/scaffolds a row/)).toBeNull();
  });
});

describe("AppFooter", () => {
  it("renders the disclaimer and a Source link to the repo", () => {
    render(<AppFooter />);
    expect(screen.getByText(/Opinions are my own/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      "https://github.com/tebanieo/Keyway",
    );
  });
});

describe("CopiedToast", () => {
  it("renders nothing when there is no value", () => {
    const { container } = render(<CopiedToast value={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the copied value", () => {
    render(<CopiedToast value="USER#1" />);
    expect(screen.getByText("USER#1")).toBeInTheDocument();
    expect(screen.getByText(/copied/)).toBeInTheDocument();
  });
});

describe("ResetToast", () => {
  it("offers the model back after a reset, announced as a status", () => {
    const onUndo = vi.fn();
    render(<ResetToast onUndo={onUndo} />);
    expect(screen.getByRole("status")).toHaveTextContent("Model reset.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("renders nothing when there's nothing to undo", () => {
    const { container } = render(<ResetToast onUndo={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("StepNote", () => {
  it("shows the whole narration, and what the step does when it has none", () => {
    const long = "A settings item carries NO GSI1 key, so it never reaches GSI1. ".repeat(3);
    const { rerender } = render(<StepNote text={long} step={3} total={8} fallback="put u1" />);
    expect(screen.getByText(long.trim())).toBeInTheDocument();
    expect(screen.getByText("Step 3/8")).toBeInTheDocument();
    rerender(<StepNote step={4} total={8} fallback="put u2" />);
    expect(screen.getByText("put u2")).toBeInTheDocument();
  });
});
