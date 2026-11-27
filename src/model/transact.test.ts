import { describe, expect, it } from "vitest";
import { fold } from "../engine/engine";
import { writeCost } from "../engine/cost";
import { parseDoc, serializeOps } from "./dsl";
import { BASE_INDEX } from "./seed";

const HEAD = `@table T pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK
p1: PK=PRODUCT#1  SK=STOCK  stock=3
cart1: PK=USER#1  SK=CART  item=PRODUCT#1
`;

const ORDER = `${HEAD}
# place an order: all or nothing
@transact
o1: PK=USER#1  SK=ORDER#1  GSI1PK=STATUS#new  GSI1SK=1  @if attribute_not_exists(PK)
check p1  @if stock >= :n  values={":n": {"N": "1"}}
delete cart1
@end
`;

const items = (text: string) => {
  const p = parseDoc(text, BASE_INDEX);
  return { p, state: fold(p.ops, p.base) };
};

describe("@transact … @end (TransactWriteItems)", () => {
  it("is one step that applies every write together", () => {
    const { p, state } = items(ORDER);
    expect(p.diagnostics).toEqual([]);
    expect(p.ops).toHaveLength(3); // p1, cart1, the transaction
    const tx = p.ops[2];
    expect(tx.kind).toBe("transact");
    expect(tx.kind === "transact" && tx.actions.map((a) => a.kind)).toEqual([
      "put",
      "check",
      "delete",
    ]);
    expect(p.notes[2]).toBe("place an order: all or nothing");
    const ids = [...state.values()].map((i) => i.id).sort();
    expect(ids).toEqual(["o1", "p1"]); // order in, cart gone, product untouched
  });

  it("is cancelled as a whole when any condition fails: nothing is written", () => {
    const out = ORDER.replace('{"N": "1"}', '{"N": "5"}'); // only 3 in stock
    const { p, state } = items(out);
    const ids = [...state.values()].map((i) => i.id).sort();
    expect(ids).toEqual(["cart1", "p1"]); // no order, the cart is still there
    const prev = fold(p.ops.slice(0, 2), p.base);
    const cost = writeCost(prev, p.ops[2], p.base, p.gsis);
    expect(cost.rejected).toBe(true);
    expect(cost.base).toBe("transact");
  });

  it("bills every action at the transactional rate, a check included", () => {
    const { p } = items(ORDER);
    const prev = fold(p.ops.slice(0, 2), p.base);
    const cost = writeCost(prev, p.ops[2], p.base, p.gsis);
    expect(cost.transactional).toBe(true);
    expect(cost.baseWrites).toBe(6); // put + check + delete, 2 WCU each
    expect(cost.indexes[0]).toMatchObject({ index: "GSI1", writes: 1 }); // the order enters GSI1
  });

  it("refuses two actions on one item, as DynamoDB does", () => {
    const { p } = items(`${HEAD}
@transact
delete cart1
check cart1  @if attribute_exists(PK)
@end
`);
    expect(p.diagnostics[0].message).toMatch(/multiple operations on one item/);
    expect(p.ops).toHaveLength(2); // the transaction never happens
  });

  it("flags check outside a block, a stray @end, nesting, and an unclosed block", () => {
    const stray = parseDoc(`${HEAD}check p1  @if attribute_exists(PK)\n@end\n`, BASE_INDEX);
    expect(stray.diagnostics.map((d) => d.message)).toEqual([
      expect.stringMatching(/only goes inside @transact/),
      expect.stringMatching(/@end without an open @transact/),
    ]);
    const nested = parseDoc(`${HEAD}@transact\n@transact\ndelete cart1\n@end\n`, BASE_INDEX);
    expect(nested.diagnostics[0].message).toMatch(/don't nest/);
    // mid-typing: an unclosed block still shows, with a nudge to close it
    const open = parseDoc(`${HEAD}@transact\ndelete cart1\n`, BASE_INDEX);
    expect(open.diagnostics[0]).toMatchObject({ severity: "warning" });
    expect(open.ops.at(-1)?.kind).toBe("transact");
  });

  it("round-trips through serializeOps as a block", () => {
    const { p } = items(ORDER);
    const text = serializeOps(p.ops.slice(2), p.base);
    expect(text.split("\n")[0]).toBe("@transact");
    expect(text).toContain("check p1");
    expect(text.trimEnd().endsWith("@end")).toBe(true);
    const again = parseDoc(`${HEAD}${text}`, BASE_INDEX);
    expect(again.ops[2]).toEqual(p.ops[2]);
  });
});
