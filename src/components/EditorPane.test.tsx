// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorPane } from "./EditorPane";
import type { EditorHandle } from "./Editor";

function setup(over: Partial<Parameters<typeof EditorPane>[0]> = {}) {
  const onToggleCollapse = vi.fn();
  const ref = createRef<EditorHandle>();
  const props = {
    collapsed: false,
    onToggleCollapse,
    itemCount: 2,
    gsiCount: 1,
    apCount: 1,
    editorKey: 0,
    initialDoc: "u1: PK=U#1  SK=A",
    onChange: vi.fn(),
    activeLine: null,
    ...over,
  };
  const { container } = render(<EditorPane ref={ref} {...props} />);
  return { onToggleCollapse, container };
}

describe("EditorPane", () => {
  it("summarizes item / index / pattern counts", () => {
    setup({ itemCount: 2, gsiCount: 1, apCount: 1 });
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/items/)).toBeInTheDocument();
    expect(screen.getByText(/index/)).toBeInTheDocument();
    expect(screen.getByText(/pattern/, { ignore: ".sr-only" })).toBeInTheDocument();
    // how to leave the script is part of its description, for screen readers
    expect(screen.getByRole("textbox", { name: "Model script" })).toHaveAccessibleDescription(
      /press Escape, then Tab/,
    );
  });

  it("shows the empty hint when there are no items", () => {
    setup({ itemCount: 0 });
    expect(screen.getByText(/empty - load an example/)).toBeInTheDocument();
  });

  it("reflects the collapsed state and toggles it", () => {
    const { onToggleCollapse, container } = setup({ collapsed: true });
    expect(container.querySelector(".editor-wrap")).toHaveClass("collapsed");
    // a zero-height editor must not take focus
    expect(container.querySelector(".editor-body")).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: /Editor/ }));
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });
});
