// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Splitter } from "./Splitter";

describe("Splitter", () => {
  it("resizes from the keyboard, within its limits", () => {
    const onChange = vi.fn();
    render(<Splitter pct={40} onChange={onChange} />);
    const sep = screen.getByRole("separator", { name: "Resize the script" });
    expect(sep).toHaveAttribute("aria-valuenow", "40");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    fireEvent.keyDown(sep, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(sep, { key: "End" });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([42, 30, 70]);
  });
});
