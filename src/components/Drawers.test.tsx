// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
