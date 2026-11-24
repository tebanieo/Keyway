// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryPanel } from "./QueryPanel";
import { fold } from "../engine/engine";
import { parseDoc } from "../model/dsl";
import { BASE_INDEX } from "../model/seed";

const DSL = `@table T pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK
u1: PK=U#1  SK=A  GSI1PK=E#a  GSI1SK=U1
u2: PK=U#2  SK=B  GSI1PK=E#b  GSI1SK=U2`;

function setup(over: Partial<Parameters<typeof QueryPanel>[0]> = {}) {
  const parsed = parseDoc(DSL, BASE_INDEX);
  const state = fold(parsed.ops, parsed.base);
  const onHighlight = vi.fn();
  const onClose = vi.fn();
  const props = {
    open: true,
    base: parsed.base,
    gsis: parsed.gsis,
    state,
    onHighlight,
    onClose,
    ...over,
  };
  const utils = render(<QueryPanel {...props} />);
  return { onHighlight, onClose, ...utils };
}

describe("QueryPanel", () => {
  it("reflects the open state onto the class + aria-hidden", () => {
    const { container, rerender } = setup({ open: false });
    expect(container.querySelector(".query-panel")).not.toHaveClass("open");
    expect(container.querySelector(".query-panel")).toHaveAttribute("aria-hidden", "true");
    // reopen
    const parsed = parseDoc(DSL, BASE_INDEX);
    rerender(
      <QueryPanel
        open
        base={parsed.base}
        gsis={parsed.gsis}
        state={fold(parsed.ops, parsed.base)}
        onHighlight={() => {}}
        onClose={() => {}}
      />,
    );
    expect(container.querySelector(".query-panel")).toHaveClass("open");
  });

  it("runs a scan over the whole table and reports + highlights the reads", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    // scan hides the key inputs
    expect(document.querySelector(".query-keys")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "run" }));

    expect(document.querySelector(".query-result")).not.toBeNull();
    const last = p.onHighlight.mock.calls.at(-1)![0];
    expect(last.matched.size).toBe(2); // both items returned
  });

  it("pre-fills a KeyConditionExpression template for the chosen index", () => {
    setup();
    const key = screen.getByLabelText("KeyConditionExpression") as HTMLInputElement;
    expect(key.value).toBe("PK = :pk  :pk=");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "GSI1" } });
    expect(key.value).toBe("GSI1PK = :pk  :pk=");
  });

  it("runs a Query from its KeyConditionExpression and highlights the match", () => {
    const p = setup(); // op defaults to "query", index = base
    fireEvent.change(screen.getByLabelText("KeyConditionExpression"), {
      target: { value: "PK = :pk  :pk=U#1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    const last = p.onHighlight.mock.calls.at(-1)![0];
    expect(last.matched.size).toBe(1); // only u1 is under PK=U#1
  });

  it("asks for a value the template left empty", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    expect(screen.getByText(/key: :pk needs a value/)).toBeInTheDocument();
  });

  it("reports DynamoDB's error for a key condition that breaks the key rules", () => {
    setup();
    fireEvent.change(screen.getByLabelText("KeyConditionExpression"), {
      target: { value: "begins_with(PK, :p)  :p=U#" },
    });
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    expect(screen.getByText(/partition key condition must use equality/)).toBeInTheDocument();
  });

  it("runs a GetItem with pk + sk on the base table", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Get" }));
    const [pk, sk] = screen.getAllByPlaceholderText("value");
    fireEvent.change(pk, { target: { value: "U#1" } });
    fireEvent.change(sk, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    const last = p.onHighlight.mock.calls.at(-1)![0];
    expect(last.matched.size).toBe(1);
  });

  it("surfaces a filter parse error", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    fireEvent.change(screen.getByPlaceholderText(/#s=status/), {
      target: { value: "((" },
    });
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    expect(document.querySelector(".query-result.err")).not.toBeNull();
    expect(screen.getByText(/filter: Invalid FilterExpression/)).toBeInTheDocument();
  });

  it("reports DynamoDB's error for a reserved word in a filter", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    fireEvent.change(screen.getByPlaceholderText(/#s=status/), {
      target: { value: "status = :p  :p=pending" },
    });
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    expect(screen.getByText(/reserved keyword: status/)).toBeInTheDocument();
  });

  it("warns when a filter compares against a bare word", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    fireEvent.change(screen.getByPlaceholderText(/#s=status/), {
      target: { value: "tier = gold" },
    });
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    expect(screen.getByText(/`gold` is read as an attribute name/)).toBeInTheDocument();
  });

  it("clear resets the result and empties the highlight", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    expect(document.querySelector(".query-result")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(document.querySelector(".query-result")).toBeNull();
    const last = p.onHighlight.mock.calls.at(-1)![0];
    expect(last.matched.size).toBe(0);
  });

  it("disables GetItem on a GSI (base-table only)", () => {
    setup();
    fireEvent.change(screen.getByLabelText("index"), { target: { value: "GSI1" } });
    expect(screen.getByRole("button", { name: "Get" })).toBeDisabled();
  });

  it("closes from the close button", () => {
    const p = setup();
    fireEvent.click(screen.getByTitle("close"));
    expect(p.onClose).toHaveBeenCalledOnce();
  });
});
