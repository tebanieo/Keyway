import { describe, expect, it } from "vitest";
import { fold } from "../engine/engine";
import { computeBackfill } from "./backfill";
import type { IndexSpec, Op } from "../engine/types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };

function put(id: string, attrs: Record<string, string>): Op {
  return { kind: "put", item: { id, attrs } };
}

// Three orders; o1 is about to gain a `discount`.
const seed: Op[] = [
  put("o1", { PK: "U#1", SK: "O#1", status: "pending", _type: "order" }),
  put("o2", { PK: "U#1", SK: "O#2", status: "pending", _type: "order" }),
  put("o3", { PK: "U#2", SK: "O#3", status: "pending", _type: "order" }),
];

describe("computeBackfill", () => {
  it("suggests the other same-type items when a new attribute appears", () => {
    const addDiscount = put("o1", { PK: "U#1", SK: "O#1", status: "pending", _type: "order", discount: "10" });
    const prev = fold(seed, BASE);
    const cur = fold([...seed, addDiscount], BASE);
    const b = computeBackfill(prev, cur, addDiscount, BASE);
    expect(b).not.toBeNull();
    expect(b!.attr).toBe("discount");
    expect(b!.type).toBe("order");
    expect(b!.value).toBe("10");
    expect(b!.targets.map((t) => t.id).sort()).toEqual(["o2", "o3"]);
  });

  it("returns null when every same-type item already has the attribute", () => {
    const withDiscount = seed.map((o) =>
      o.kind === "put" ? put(o.item.id, { ...o.item.attrs, discount: "0" }) : o,
    );
    const edit = put("o1", { PK: "U#1", SK: "O#1", status: "shipped", _type: "order", discount: "0" });
    const prev = fold(withDiscount, BASE);
    const cur = fold([...withDiscount, edit], BASE);
    // `status` changed but isn't new; `discount` already everywhere -> nothing
    expect(computeBackfill(prev, cur, edit, BASE)).toBeNull();
  });

  it("ignores key attributes, _type, and untyped items", () => {
    const untyped: Op[] = [
      put("x1", { PK: "U#1", SK: "A", note: "hi" }), // no _type
    ];
    const edit = put("x1", { PK: "U#1", SK: "A", note: "hi", extra: "y" });
    const prev = fold(untyped, BASE);
    const cur = fold([...untyped, edit], BASE);
    expect(computeBackfill(prev, cur, edit, BASE)).toBeNull();
  });

  it("does not fire for a brand-new item (all attributes are new)", () => {
    const fresh = put("o4", { PK: "U#3", SK: "O#4", status: "pending", _type: "order", coupon: "z" });
    const prev = fold(seed, BASE);
    const cur = fold([...seed, fresh], BASE);
    expect(computeBackfill(prev, cur, fresh, BASE)).toBeNull();
  });
});
