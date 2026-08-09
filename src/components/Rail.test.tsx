// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Drawer, RightRail } from "./Rail";
import type { RailItem } from "./Rail";

describe("Drawer", () => {
  it("reflects the open state onto the class and aria-hidden", () => {
    const { rerender, container } = render(
      <Drawer open={false} title="Examples" onClose={() => {}}>
        <p>body</p>
      </Drawer>,
    );
    let el = container.querySelector(".drawer")!;
    expect(el).not.toHaveClass("open");
    expect(el).toHaveAttribute("aria-hidden", "true");

    rerender(
      <Drawer open={true} title="Examples" onClose={() => {}}>
        <p>body</p>
      </Drawer>,
    );
    el = container.querySelector(".drawer")!;
    expect(el).toHaveClass("open");
    expect(el).toHaveAttribute("aria-hidden", "false");
  });

  it("renders title + children and closes from the button", () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Examples" onClose={onClose}>
        <p>the body</p>
      </Drawer>,
    );
    expect(screen.getByText("Examples")).toBeInTheDocument();
    expect(screen.getByText("the body")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("close"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

const item = (over: Partial<RailItem> = {}): RailItem => ({
  id: "examples",
  label: "Examples",
  icon: <i data-testid="icon" />,
  active: false,
  onClick: vi.fn(),
  ...over,
});

describe("RightRail", () => {
  it("renders nothing when there are no items", () => {
    const { container } = render(<RightRail items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a button per item and fires onClick", () => {
    const onClick = vi.fn();
    render(<RightRail items={[item({ onClick })]} />);
    const btn = screen.getByRole("button", { name: "Examples" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows a badge and warn state for an item with a count", () => {
    render(<RightRail items={[item({ badge: 3 })]} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Examples" })).toHaveClass("warn");
  });

  it("marks the active item and reveals the rail on the hint flag", () => {
    const { container } = render(<RightRail items={[item({ active: true })]} reveal />);
    expect(screen.getByRole("button", { name: "Examples" })).toHaveClass("active");
    expect(container.querySelector(".rail")).toHaveClass("hint");
    expect(container.querySelector(".rail")).toHaveClass("revealed");
  });
});
