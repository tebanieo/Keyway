// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PanesGrid } from "./PanesGrid";
import type { ShownPane } from "./PanesGrid";
import type { LinkProps } from "./Panel";

// Panel is heavy (it renders full projected tables); stub it so this test
// covers only PanesGrid's own job: layout, the compact class, and one child
// per pane.
vi.mock("./Panel", () => ({
  Panel: ({ subtitle }: { subtitle?: string }) => <div data-testid="panel">{subtitle}</div>,
}));

const pane = (name: string): ShownPane => ({
  name,
  view: {} as never,
  prev: {} as never,
  subtitle: `sub-${name}`,
});

const link = {} as LinkProps;

describe("PanesGrid", () => {
  it("renders one Panel per pane", () => {
    render(<PanesGrid panes={[pane("Base"), pane("GSI1")]} compact={false} diffOn link={link} />);
    expect(screen.getAllByTestId("panel")).toHaveLength(2);
    expect(screen.getByText("sub-Base")).toBeInTheDocument();
  });

  it("applies the compact class when compact", () => {
    const { container } = render(<PanesGrid panes={[]} compact={true} diffOn link={link} />);
    expect(container.querySelector(".panes.compact")).not.toBeNull();
  });

  it("uses the plain panes class when not compact", () => {
    const { container } = render(<PanesGrid panes={[]} compact={false} diffOn link={link} />);
    const el = container.querySelector(".panes");
    expect(el).not.toBeNull();
    expect(el).not.toHaveClass("compact");
  });
});
