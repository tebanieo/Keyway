// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Panel } from "./Panel";
import type { EditProps, LinkProps } from "./Panel";
import { fold, project } from "../engine/engine";
import { parseDoc } from "../model/dsl";
import { BASE_INDEX } from "../model/seed";

function viewOf(dsl: string) {
  const p = parseDoc(dsl, BASE_INDEX);
  const state = fold(p.ops, p.base);
  return { view: project(state, p.base), base: p.base };
}

const emptyView = viewOf("@table T pk=PK sk=SK").view;

const link = (): LinkProps => ({
  hoveredId: null,
  pinnedId: null,
  onHover: vi.fn(),
  onPin: vi.fn(),
  onCopy: vi.fn(),
});

const editProps = (): EditProps => ({
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onAddItem: vi.fn(),
});

const TWO = `@table T pk=PK sk=SK
u1: PK=U#1  SK=A  name=Ada
u2: PK=U#1  SK=B  name=Alan`;

describe("Panel", () => {
  it("renders the partition, its rows, and key columns", () => {
    const { view } = viewOf(TWO);
    render(<Panel view={view} prev={view} diffOn={false} link={link()} />);
    // "U#1" is both the partition-head pk and the PK cell of each row
    expect(screen.getAllByText("U#1").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 items/).length).toBeGreaterThan(0);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Alan")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "PK" })).toHaveClass("iskey");
  });

  it("copies a cell value on click (read-only pane)", () => {
    const { view } = viewOf(TWO);
    const l = link();
    render(<Panel view={view} prev={view} diffOn={false} link={l} />);
    fireEvent.click(screen.getByText("Ada"));
    expect(l.onCopy).toHaveBeenCalledWith("Ada");
  });

  it("pins a row from its pin button", () => {
    const { view } = viewOf(TWO);
    const l = link();
    render(<Panel view={view} prev={view} diffOn={false} link={l} />);
    fireEvent.click(screen.getAllByTitle("pin / follow this item")[0]);
    expect(l.onPin).toHaveBeenCalledWith("u1");
  });

  it("offers add-item on an empty editable pane", () => {
    const e = editProps();
    render(<Panel view={emptyView} prev={emptyView} diffOn={false} link={link()} edit={e} />);
    fireEvent.click(screen.getByRole("button", { name: /add an item/ }));
    expect(e.onAddItem).toHaveBeenCalledWith("ITEM#1");
  });

  it("edits a cell: double-click, type, Enter commits", () => {
    const { view } = viewOf(TWO);
    const e = editProps();
    render(<Panel view={view} prev={view} diffOn={false} link={link()} edit={e} />);
    fireEvent.doubleClick(screen.getByText("Ada"));
    const input = screen.getByDisplayValue("Ada");
    fireEvent.change(input, { target: { value: "Ada Lovelace" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(e.onEdit).toHaveBeenCalledWith(expect.anything(), "name", "Ada Lovelace");
  });

  it("cancels a cell edit on Escape without committing", () => {
    const { view } = viewOf(TWO);
    const e = editProps();
    render(<Panel view={view} prev={view} diffOn={false} link={link()} edit={e} />);
    fireEvent.doubleClick(screen.getByText("Ada"));
    const input = screen.getByDisplayValue("Ada");
    fireEvent.change(input, { target: { value: "changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(e.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("changed")).toBeNull(); // back to a cell
  });

  it("commits a cell edit on blur", () => {
    const { view } = viewOf(TWO);
    const e = editProps();
    render(<Panel view={view} prev={view} diffOn={false} link={link()} edit={e} />);
    fireEvent.doubleClick(screen.getByText("Ada"));
    const input = screen.getByDisplayValue("Ada");
    fireEvent.change(input, { target: { value: "Ada L" } });
    fireEvent.blur(input);
    expect(e.onEdit).toHaveBeenCalledWith(expect.anything(), "name", "Ada L");
  });

  it("deletes a row from its delete button (editable pane)", () => {
    const { view } = viewOf(TWO);
    const e = editProps();
    render(<Panel view={view} prev={view} diffOn={false} link={link()} edit={e} />);
    fireEvent.click(screen.getAllByTitle("delete item")[0]);
    expect(e.onDelete).toHaveBeenCalledWith("u1");
  });

  it("shows diff gutter markers when diffOn and the previous view was empty", () => {
    const { view } = viewOf(TWO);
    render(<Panel view={view} prev={emptyView} diffOn={true} link={link()} />);
    const table = document.querySelector(".ptable") as HTMLElement;
    // both new rows are marked added
    expect(within(table).getAllByText("+").length).toBe(2);
  });
});
