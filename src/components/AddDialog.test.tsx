// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddDialog } from "./AddDialog";

const base = { name: "T", pk: "PK", sk: "SK" };

function setup(kind: "index" | "entity") {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(
    <AddDialog
      open
      kind={kind}
      onKind={vi.fn()}
      base={base}
      gsis={[]}
      nextLabel={(t) => `${t}1`}
      onAdd={onAdd}
      onClose={onClose}
    />,
  );
  return { onAdd, onClose };
}

describe("AddDialog", () => {
  it("previews the exact @gsi line and adds it", () => {
    const p = setup("index");
    fireEvent.change(screen.getByLabelText(/Partition key/), { target: { value: "status" } });
    fireEvent.change(screen.getByLabelText(/Sort key/), { target: { value: "date" } });
    expect(screen.getByText("@gsi GSI1 pk=status sk=date")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to script" }));
    expect(p.onAdd).toHaveBeenCalledWith(["@gsi GSI1 pk=status sk=date"]);
    expect(p.onClose).toHaveBeenCalled();
  });

  it("writes an entity as a @key template plus a first item", () => {
    const p = setup("entity");
    const add = screen.getByRole("button", { name: "Add to script" });
    expect(add).toBeDisabled(); // needs a type name
    fireEvent.change(screen.getByLabelText(/Type name/), { target: { value: "order" } });
    fireEvent.change(screen.getByLabelText("SK"), { target: { value: "ORDER#{id}" } });
    fireEvent.click(add);
    expect(p.onAdd).toHaveBeenCalledWith([
      "@key order  SK=ORDER#{id}",
      "order1: id=<id>  _type=order",
    ]);
  });
});
