import { describe, expect, it } from "vitest";
import { fold } from "./engine";
import { writeCost } from "./cost";
import type { IndexSpec, Item, Op } from "./types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };
const GSI1: IndexSpec = { name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" };

function put(id: string, attrs: Record<string, string>): Op {
  return { kind: "put", item: { id, attrs } };
}
const empty = new Map<string, Item>();

describe("writeCost — put", () => {
  it("a brand-new indexed item costs base + GSI insert (2 WCU)", () => {
    const op = put("u1", { PK: "U#1", SK: "PROFILE", GSI1PK: "EMAIL#a", GSI1SK: "U#1" });
    const cost = writeCost(empty, op, BASE, [GSI1]);
    expect(cost.totalWrites).toBe(2);
    expect(cost.indexes[0]).toMatchObject({ effect: "insert", writes: 1 });
  });

  it("an un-indexed item costs only the base write (1 WCU)", () => {
    const op = put("s1", { PK: "U#1", SK: "SETTINGS" }); // no GSI1 keys
    const cost = writeCost(empty, op, BASE, [GSI1]);
    expect(cost.totalWrites).toBe(1);
    expect(cost.indexes[0]).toMatchObject({ effect: "none", writes: 0 });
  });

  it("changing a GSI key is a reindex: delete old + put new (2 WCU on the GSI)", () => {
    const prior = fold(
      [put("o1", { PK: "U#1", SK: "ORDER#1", GSI1PK: "STATUS#pending", GSI1SK: "d" })],
      BASE,
    );
    const ship = put("o1", {
      PK: "U#1",
      SK: "ORDER#1",
      GSI1PK: "STATUS#shipped",
      GSI1SK: "d",
    });
    const cost = writeCost(prior, ship, BASE, [GSI1]);
    const g = cost.indexes[0];
    expect(g).toMatchObject({
      effect: "reindex",
      writes: 2,
      from: "STATUS#pending",
      to: "STATUS#shipped",
    });
    // base 1 + GSI 2 = 3, the classic "update cost more than you expected"
    expect(cost.totalWrites).toBe(3);
  });

  it("changing a non-key attribute in place is a single GSI update", () => {
    const prior = fold(
      [put("o1", { PK: "U#1", SK: "ORDER#1", GSI1PK: "STATUS#pending", GSI1SK: "d", note: "a" })],
      BASE,
    );
    const edit = put("o1", {
      PK: "U#1",
      SK: "ORDER#1",
      GSI1PK: "STATUS#pending",
      GSI1SK: "d",
      note: "b",
    });
    const cost = writeCost(prior, edit, BASE, [GSI1]);
    expect(cost.indexes[0]).toMatchObject({ effect: "update", writes: 1 });
    expect(cost.totalWrites).toBe(2);
  });

  it("a non-key change does not rewrite a KEYS_ONLY GSI", () => {
    const KEYS_GSI = { ...GSI1, projection: "KEYS_ONLY" as const };
    const prior = fold(
      [put("o1", { PK: "U#1", SK: "ORDER#1", GSI1PK: "STATUS#pending", GSI1SK: "d", total: "1" })],
      BASE,
    );
    const edit = put("o1", {
      PK: "U#1",
      SK: "ORDER#1",
      GSI1PK: "STATUS#pending",
      GSI1SK: "d",
      total: "2", // not projected into a KEYS_ONLY index
    });
    const cost = writeCost(prior, edit, BASE, [KEYS_GSI]);
    expect(cost.indexes[0]).toMatchObject({ effect: "none", writes: 0 });
    expect(cost.totalWrites).toBe(1); // base put only
  });

  it("rewriting an item with no projected change touches only the base table", () => {
    const attrs = { PK: "U#1", SK: "ORDER#1", GSI1PK: "STATUS#pending", GSI1SK: "d" };
    const prior = fold([put("o1", attrs)], BASE);
    const cost = writeCost(prior, put("o1", { ...attrs }), BASE, [GSI1]);
    expect(cost.indexes[0]).toMatchObject({ effect: "none", writes: 0 });
    expect(cost.totalWrites).toBe(1);
  });
});

describe("writeCost — transact (atomic key rename)", () => {
  it("delete-old + put-new bills base at 2x and reindexes the GSI", () => {
    const prior = fold(
      [put("o1", { PK: "U#1", SK: "ORDER#1", GSI1PK: "STATUS#pending", GSI1SK: "d" })],
      BASE,
    );
    // rename the base key (U#1 -> U#2), keeping the same stable id
    const rename: Op = {
      kind: "transact",
      actions: [
        { kind: "delete", id: "o1" },
        {
          kind: "put",
          item: {
            id: "o1",
            attrs: { PK: "U#2", SK: "ORDER#1", GSI1PK: "STATUS#pending", GSI1SK: "d" },
          },
        },
      ],
    };
    const cost = writeCost(prior, rename, BASE, [GSI1]);
    expect(cost.base).toBe("transact");
    expect(cost.transactional).toBe(true);
    // 2 base items (delete + put) x2 transactional = 4
    expect(cost.baseWrites).toBe(4);
    // GSI key (status) unchanged here, but the item was deleted then re-put:
    // delete old projection + put new projection = a reindex (2), standard rate
    expect(cost.indexes[0]).toMatchObject({ effect: "reindex", writes: 2 });
    // 4 base + 2 GSI = 6, vs 4 for the racy two-request version
    expect(cost.totalWrites).toBe(6);
  });
});

describe("writeCost — INCLUDE projection", () => {
  const INC = { ...GSI1, projection: ["total"] as string[] };
  const base = { PK: "U#1", SK: "O#1", GSI1PK: "S#p", GSI1SK: "d", total: "1", note: "a" };
  it("rewrites the GSI when an INCLUDED attribute changes", () => {
    const prior = fold([put("o1", base)], BASE);
    const cost = writeCost(prior, put("o1", { ...base, total: "2" }), BASE, [INC]);
    expect(cost.indexes[0]).toMatchObject({ effect: "update", writes: 1 });
  });
  it("does NOT rewrite the GSI when a non-included, non-key attribute changes", () => {
    const prior = fold([put("o1", base)], BASE);
    const cost = writeCost(prior, put("o1", { ...base, note: "b" }), BASE, [INC]);
    expect(cost.indexes[0]).toMatchObject({ effect: "none", writes: 0 });
    expect(cost.totalWrites).toBe(1); // base only
  });
});

describe("writeCost — item size drives WCU", () => {
  it("an item over 1 KB costs 2 base WCU", () => {
    const op = put("big", { PK: "U#1", SK: "O#1", data: "x".repeat(1100) });
    expect(writeCost(empty, op, BASE, [GSI1]).baseWrites).toBe(2);
  });
});

describe("writeCost — transact merge branches", () => {
  it("insert one + delete another on the same GSI merges to a reindex (2 writes)", () => {
    const prior = fold([put("o2", { PK: "U#2", SK: "O#2", GSI1PK: "S#p", GSI1SK: "d" })], BASE);
    const op: Op = {
      kind: "transact",
      actions: [
        { kind: "delete", id: "o2" },
        { kind: "put", item: { id: "o1", attrs: { PK: "U#1", SK: "O#1", GSI1PK: "S#q", GSI1SK: "d" } } },
      ],
    };
    const cost = writeCost(prior, op, BASE, [GSI1]);
    expect(cost.indexes[0]).toMatchObject({ effect: "reindex", writes: 2 });
    expect(cost.baseWrites).toBe(4); // two base items x2 transactional
  });

  it("a transact touching no GSI keys leaves the GSI untouched (none)", () => {
    const op: Op = {
      kind: "transact",
      actions: [
        { kind: "put", item: { id: "s1", attrs: { PK: "U#1", SK: "S#1" } } },
        { kind: "put", item: { id: "s2", attrs: { PK: "U#1", SK: "S#2" } } },
      ],
    };
    const cost = writeCost(empty, op, BASE, [GSI1]);
    expect(cost.indexes[0]).toMatchObject({ effect: "none", writes: 0 });
    expect(cost.baseWrites).toBe(4);
  });
});

describe("writeCost — delete", () => {
  it("deleting an indexed item removes it from base and GSI (2 WCU)", () => {
    const prior = fold(
      [put("o1", { PK: "U#1", SK: "ORDER#1", GSI1PK: "STATUS#pending", GSI1SK: "d" })],
      BASE,
    );
    const cost = writeCost(prior, { kind: "delete", id: "o1" }, BASE, [GSI1]);
    expect(cost.base).toBe("delete");
    expect(cost.indexes[0]).toMatchObject({ effect: "delete", writes: 1 });
    expect(cost.totalWrites).toBe(2);
  });

  it("deleting an un-indexed item costs only the base write", () => {
    const prior = fold([put("s1", { PK: "U#1", SK: "SETTINGS" })], BASE);
    const cost = writeCost(prior, { kind: "delete", id: "s1" }, BASE, [GSI1]);
    expect(cost.indexes[0]).toMatchObject({ effect: "none", writes: 0 });
    expect(cost.totalWrites).toBe(1);
  });
});
