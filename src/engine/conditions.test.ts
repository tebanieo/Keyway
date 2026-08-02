import { describe, expect, it } from "vitest";
import { conditionRejected, fold } from "./engine";
import { writeCost } from "./cost";
import { parseFilter } from "./filter";
import type { Condition, IndexSpec, Item, Op } from "./types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };
const GSI1: IndexSpec = { name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" };

/** Build a Condition from expression text (mirrors what the DSL parser does). */
function cond(text: string): Condition {
  const p = parseFilter(text);
  if (!p.ast) throw new Error(`bad test condition: ${text}`);
  return { ast: p.ast, text };
}

function put(id: string, attrs: Record<string, string>, condition?: Condition): Op {
  return { kind: "put", item: { id, attrs }, condition };
}

const empty = new Map<string, Item>();

describe("fold — conditional writes", () => {
  it("applies a create-if-not-exists when the row is absent", () => {
    const ops: Op[] = [
      put("u1", { PK: "U#1", SK: "PROFILE", name: "Ada" }, cond("attribute_not_exists(PK)")),
    ];
    const state = fold(ops, BASE);
    expect([...state.values()]).toHaveLength(1);
  });

  it("rejects a create-if-not-exists once the row exists (no overwrite)", () => {
    const ops: Op[] = [
      put("u1", { PK: "U#1", SK: "PROFILE", name: "Ada" }),
      put("u1", { PK: "U#1", SK: "PROFILE", name: "Impostor" }, cond("attribute_not_exists(PK)")),
    ];
    const state = fold(ops, BASE);
    expect([...state.values()][0].attrs.name).toBe("Ada");
  });

  it("applies an optimistic update while the guard holds, then rejects it", () => {
    const ops: Op[] = [
      put("o1", { PK: "U#1", SK: "O#1", status: "pending" }),
      put("o1", { PK: "U#1", SK: "O#1", status: "shipped" }, cond("status=pending")),
      put("o1", { PK: "U#1", SK: "O#1", status: "cancelled" }, cond("status=pending")),
    ];
    const state = fold(ops, BASE);
    // second write ships (guard held); third is rejected (no longer pending)
    expect([...state.values()][0].attrs.status).toBe("shipped");
  });

  it("a guarded delete only removes the row when the guard holds", () => {
    const held = fold(
      [
        put("o1", { PK: "U#1", SK: "O#1", status: "shipped" }),
        { kind: "delete", id: "o1", condition: cond("status=shipped") },
      ],
      BASE,
    );
    expect(held.size).toBe(0);

    const blocked = fold(
      [
        put("o1", { PK: "U#1", SK: "O#1", status: "pending" }),
        { kind: "delete", id: "o1", condition: cond("status=shipped") },
      ],
      BASE,
    );
    expect(blocked.size).toBe(1);
  });
});

describe("conditionRejected", () => {
  it("is false when there is no condition", () => {
    expect(conditionRejected(empty, put("u1", { PK: "U#1", SK: "P" }), BASE)).toBe(false);
  });

  it("is true when a guard fails against the prior state", () => {
    const prev = fold([put("u1", { PK: "U#1", SK: "P", name: "Ada" })], BASE);
    const op = put("u1", { PK: "U#1", SK: "P", name: "x" }, cond("attribute_not_exists(PK)"));
    expect(conditionRejected(prev, op, BASE)).toBe(true);
  });
});

describe("writeCost — rejected conditional write", () => {
  it("bills a flat 1 WCU and leaves every index untouched", () => {
    const prev = fold([put("u1", { PK: "U#1", SK: "P", GSI1PK: "E#a", GSI1SK: "U#1" })], BASE);
    const op = put(
      "u1",
      { PK: "U#1", SK: "P", GSI1PK: "E#a", GSI1SK: "U#1" },
      cond("attribute_not_exists(PK)"),
    );
    const cost = writeCost(prev, op, BASE, [GSI1]);
    expect(cost.rejected).toBe(true);
    expect(cost.totalWrites).toBe(1);
    expect(cost.baseWrites).toBe(1);
    expect(cost.indexes.every((i) => i.writes === 0 && i.effect === "none")).toBe(true);
  });

  it("bills 2 WCU when the rejected write is transactional", () => {
    const prev = fold([put("t1", { PK: "U#1", SK: "T#open" })], BASE);
    // a key change (transact) guarded by a failing condition
    const op: Op = {
      kind: "transact",
      actions: [
        { kind: "delete", id: "t1" },
        // guard checks the NEW key's occupant, which is absent → status=pending
        // fails against an empty item → the transaction is rejected.
        {
          kind: "put",
          item: { id: "t1", attrs: { PK: "U#2", SK: "T#open" } },
          condition: cond("status=pending"),
        },
      ],
    };
    const cost = writeCost(prev, op, BASE, [GSI1]);
    expect(cost.rejected).toBe(true);
    expect(cost.totalWrites).toBe(2);
  });

  it("an applied conditional write costs the same as a normal write", () => {
    const op = put(
      "u1",
      { PK: "U#1", SK: "P", GSI1PK: "E#a", GSI1SK: "U#1" },
      cond("attribute_not_exists(PK)"),
    );
    const cost = writeCost(empty, op, BASE, [GSI1]);
    expect(cost.rejected).toBeFalsy();
    expect(cost.totalWrites).toBe(2); // base + GSI insert
  });
});
