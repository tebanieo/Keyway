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

function setup(over: Partial<Parameters<typeof QueryPanel>[0]> = {}, dsl = DSL) {
  const parsed = parseDoc(dsl, BASE_INDEX);
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
    // closed and off-screen: inert, so none of its fields are tab stops
    expect(container.querySelector(".query-panel")).toHaveAttribute("inert");
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
    expect(container.querySelector(".query-panel")).not.toHaveAttribute("inert");
  });

  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
  const type = (name: string, value: string) =>
    fireEvent.change(field(name), { target: { value } });
  const run = () => fireEvent.click(screen.getByRole("button", { name: "run" }));

  it("runs a scan over the whole table and reports + highlights the reads", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(screen.queryByLabelText("KeyConditionExpression")).toBeNull();
    run();
    expect(document.querySelector(".query-result.err")).toBeNull();
    const last = p.onHighlight.mock.calls.at(-1)![0];
    expect(last.matched.size).toBe(2); // both items returned
  });

  it("lists the returned items in the panel, keys first", () => {
    setup();
    type("ExpressionAttributeValues", '{":pk": {"S": "U#1"}}');
    run();
    const list = screen.getByRole("list", { name: "Returned items" });
    expect(list.querySelectorAll("li")).toHaveLength(1);
    expect(list).toHaveTextContent("U#1 / A");
    expect(list).toHaveTextContent("GSI1PK=E#a");
  });

  it("starts from a typed request template for the chosen index", () => {
    setup();
    expect(field("KeyConditionExpression").value).toBe("PK = :pk");
    // pre-filled from a real item, so it runs as-is the first time
    expect(JSON.parse(field("ExpressionAttributeValues").value)).toEqual({ ":pk": { S: "U#1" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "GSI1" } });
    expect(field("KeyConditionExpression").value).toBe("GSI1PK = :pk");
  });

  it("formats the JSON fields one entry per line, without touching the values", () => {
    setup();
    type("ExpressionAttributeValues", '{":pk": {"S": "a\\":b"}}');
    fireEvent.click(screen.getByRole("button", { name: "=" }));
    expect(field("ExpressionAttributeValues").value).toBe(
      '{\n  ":pk": {"S": "a\\":b"},\n  ":sk": {"S": ""}\n}',
    );
  });

  it("runs a Query written as the API request, and highlights the match", () => {
    const p = setup();
    type("ExpressionAttributeValues", '{":pk": {"S": "U#1"}}');
    run();
    const last = p.onHighlight.mock.calls.at(-1)![0];
    expect(last.matched.size).toBe(1); // only u1 is under PK=U#1
  });

  it("writes the key condition for each sort-key operator, keeping typed values", () => {
    setup();
    type("ExpressionAttributeValues", '{":pk": {"S": "U#1"}}');
    fireEvent.click(screen.getByRole("button", { name: "begins_with" }));
    expect(field("KeyConditionExpression").value).toBe("PK = :pk AND begins_with(SK, :sk)");
    expect(JSON.parse(field("ExpressionAttributeValues").value)).toEqual({
      ":pk": { S: "U#1" },
      ":sk": { S: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "BETWEEN" }));
    expect(field("KeyConditionExpression").value).toBe("PK = :pk AND SK BETWEEN :sk1 AND :sk2");
    fireEvent.click(screen.getByRole("button", { name: "none" }));
    expect(field("KeyConditionExpression").value).toBe("PK = :pk");
  });

  it("pre-fills on open when the panel mounted before the model had data", () => {
    const empty = parseDoc("@table T pk=PK sk=SK", BASE_INDEX);
    const full = parseDoc(DSL, BASE_INDEX);
    const props = { base: full.base, gsis: full.gsis, onHighlight: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(
      <QueryPanel {...props} open={false} state={fold(empty.ops, empty.base)} />,
    );
    rerender(<QueryPanel {...props} open state={fold(full.ops, full.base)} />);
    expect(JSON.parse(field("ExpressionAttributeValues").value)).toEqual({ ":pk": { S: "U#1" } });
  });

  it("runs the pre-filled template as-is", () => {
    const p = setup();
    run();
    expect(p.onHighlight.mock.calls.at(-1)![0].matched.size).toBe(1);
  });

  it("runs with Ctrl/Cmd+Enter from any field, the JSON ones included", () => {
    const p = setup();
    fireEvent.keyDown(field("ExpressionAttributeValues"), { key: "Enter", ctrlKey: true });
    expect(p.onHighlight).toHaveBeenCalled();
  });

  it("asks for a value left empty", () => {
    setup();
    type("ExpressionAttributeValues", '{":pk": {"S": ""}}');
    run();
    expect(screen.getByText(/:pk is empty/)).toBeInTheDocument();
  });

  it("reports DynamoDB's error for a key condition that breaks the key rules", () => {
    setup();
    type("KeyConditionExpression", "begins_with(PK, :pk)");
    type("ExpressionAttributeValues", '{":pk": {"S": "U#"}}');
    run();
    expect(screen.getByText(/partition key condition must use equality/)).toBeInTheDocument();
  });

  it("refuses an entry no expression uses, as the API does", () => {
    setup();
    type("ExpressionAttributeValues", '{":pk": {"S": "U#1"}, ":extra": {"S": "x"}}');
    run();
    expect(screen.getByText(/ExpressionAttributeValues unused.*:extra/)).toBeInTheDocument();
  });

  it("warns when a value's type can't match what the table holds", () => {
    const p = setup({}, "@table T pk=PK sk=SK\nn1: PK=U  SK=5\nn2: PK=U  SK=7");
    fireEvent.click(screen.getByRole("button", { name: ">" }));
    type("ExpressionAttributeValues", '{":pk": {"S": "U"}, ":sk": {"S": "6"}}');
    run();
    expect(
      screen.getByText(/SK holds Numbers \(N\) in this table, but :sk is a String/),
    ).toBeInTheDocument();
    expect(p.onHighlight.mock.calls.at(-1)![0].matched.size).toBe(0);
  });

  it("types the template from the table: a Number sort key gets an N", () => {
    setup({}, "@table T pk=PK sk=SK\nn1: PK=U  SK=5");
    fireEvent.click(screen.getByRole("button", { name: "=" }));
    expect(JSON.parse(field("ExpressionAttributeValues").value)[":sk"]).toEqual({ N: "" });
  });

  it("surfaces a FilterExpression error, labelled as DynamoDB does", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    type("FilterExpression", "((");
    run();
    expect(screen.getByText(/FilterExpression: Invalid FilterExpression/)).toBeInTheDocument();
  });

  it("reports DynamoDB's error for a reserved word in a filter", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    type("FilterExpression", "status = :p");
    type("ExpressionAttributeValues", '{":p": {"S": "pending"}}');
    run();
    expect(screen.getByText(/reserved keyword: status/)).toBeInTheDocument();
  });

  it("warns when a filter compares against a bare word", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    type("FilterExpression", "tier = gold");
    run();
    expect(screen.getByText(/`gold` is read as an attribute name/)).toBeInTheDocument();
  });

  it("disables GetItem on a GSI (base-table only)", () => {
    setup();
    fireEvent.change(screen.getByLabelText("index"), { target: { value: "GSI1" } });
    expect(screen.getByRole("button", { name: "Get" })).toBeDisabled();
  });

  it("runs a GetItem from a typed Key on the base table", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Get" }));
    expect(screen.queryByLabelText("FilterExpression")).toBeNull(); // GetItem has none
    type("Key", '{"PK": {"S": "U#1"}, "SK": {"S": "A"}}');
    run();
    expect(p.onHighlight.mock.calls.at(-1)![0].matched.size).toBe(1);
  });

  it("shows the matching AWS CLI command", () => {
    setup();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "GSI1" } });
    type("ExpressionAttributeValues", '{":pk": {"S": "E#a"}}');
    const cli = screen.getByLabelText("AWS CLI command").textContent ?? "";
    expect(cli).toContain("aws dynamodb query");
    expect(cli).toContain("--table-name 'T'");
    expect(cli).toContain("--index-name 'GSI1'");
    expect(cli).toContain("--key-condition-expression 'GSI1PK = :pk'");
    expect(cli).toContain(`--expression-attribute-values '{":pk":{"S":"E#a"}}'`);
  });

  it("resets the template when the index's keys change under it", () => {
    const { rerender, onHighlight, onClose } = setup();
    const parsed = parseDoc(
      DSL.replace("@table T pk=PK sk=SK", "@table T pk=ID sk=SK"),
      BASE_INDEX,
    );
    rerender(
      <QueryPanel
        open
        base={parsed.base}
        gsis={parsed.gsis}
        state={fold(parsed.ops, parsed.base)}
        onHighlight={onHighlight}
        onClose={onClose}
      />,
    );
    expect(field("KeyConditionExpression").value).toBe("ID = :pk");
  });

  it("clear resets the result and empties the highlight", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    run();
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(document.querySelector(".query-result")).toBeNull();
    expect(p.onHighlight.mock.calls.at(-1)![0].matched.size).toBe(0);
  });

  it("closes from the × button", () => {
    const p = setup();
    fireEvent.click(screen.getByTitle("close"));
    expect(p.onClose).toHaveBeenCalled();
  });
});
