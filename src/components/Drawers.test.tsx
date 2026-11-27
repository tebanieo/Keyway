// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ExamplesDrawer } from "./ExamplesDrawer";
import { LearnDrawer } from "./LearnDrawer";
import { EXAMPLES } from "../model/examples";
import { TOURS } from "../model/tours";

vi.mock("../analytics", () => ({ track: vi.fn(), trackItem: vi.fn() }));

describe("ExamplesDrawer", () => {
  it("lists every example and loads one (then closes) on click", () => {
    const onLoad = vi.fn();
    const onClose = vi.fn();
    render(<ExamplesDrawer open onLoad={onLoad} onClose={onClose} />);

    for (const ex of EXAMPLES) {
      expect(screen.getByText(ex.name)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText(EXAMPLES[0].name));
    expect(onLoad).toHaveBeenCalledWith(EXAMPLES[0].dsl);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("drawer lists", () => {
  it("move with the arrow keys, Home and End", () => {
    const { container } = render(<ExamplesDrawer open onLoad={vi.fn()} onClose={vi.fn()} />);
    const items = [...container.querySelectorAll<HTMLElement>(".ex-item")];
    items[0].focus();
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "End" });
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(items.at(-1)!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });
});

describe("LearnDrawer", () => {
  it("lists every tour and plays one (then closes) on click", () => {
    const onPlay = vi.fn();
    const onClose = vi.fn();
    render(<LearnDrawer open onPlay={onPlay} onClose={onClose} />);

    for (const tour of TOURS) {
      expect(screen.getByText(tour.name)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText(TOURS[0].name));
    expect(onPlay).toHaveBeenCalledWith(TOURS[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("drawer keyboard behaviour", () => {
  const frame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(null))));

  it("opening focuses the first entry; Escape closes and gives focus back", async () => {
    const onClose = vi.fn();
    const invoker = document.createElement("button");
    document.body.append(invoker);
    invoker.focus();
    const { rerender } = render(<ExamplesDrawer open={false} onLoad={vi.fn()} onClose={onClose} />);
    rerender(<ExamplesDrawer open onLoad={vi.fn()} onClose={onClose} />);
    await frame();
    expect(document.activeElement).toHaveTextContent(EXAMPLES[0].name);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<ExamplesDrawer open={false} onLoad={vi.fn()} onClose={onClose} />);
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it("is a named dialog, and inert while closed", () => {
    const { container } = render(<LearnDrawer open={false} onPlay={vi.fn()} onClose={vi.fn()} />);
    const dialog = container.querySelector('[role="dialog"][aria-label="Learn"]');
    expect(dialog).toHaveAttribute("inert");
  });
});
