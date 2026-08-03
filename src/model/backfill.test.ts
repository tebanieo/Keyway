import { describe, expect, it } from "vitest";
import { fold } from "../engine/engine";
import { computeBackfill, putItemOf } from "./backfill";
import type { IndexSpec, Op } from "../engine/types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };

function put(id: string, attrs: Record<string, string>): Op {
  return { kind: "put", item: { id, attrs } };
}
const state = (ops: Op[]) => fold(ops, BASE);

describe("computeBackfill", () => {
  it("flags an attribute present on some items of a type but not all", () => {
    const b = computeBackfill(
      state([
        put("o1", { PK: "U#1", SK: "O#1", _type: "order", discount: "10" }),
        put("o2", { PK: "U#1", SK: "O#2", _type: "order" }),
        put("o3", { PK: "U#2", SK: "O#3", _type: "order" }),
      ]),
      BASE,
    );
    expect(b).not.toBeNull();
    expect(b!.attr).toBe("discount");
    expect(b!.type).toBe("order");
    expect(b!.value).toBe("10");
    expect(b!.targets.map((t) => t.id).sort()).toEqual(["o2", "o3"]);
  });

  it("returns null when every item of the type has the attribute", () => {
    const b = computeBackfill(
      state([
        put("o1", { PK: "U#1", SK: "O#1", _type: "order", discount: "10" }),
        put("o2", { PK: "U#1", SK: "O#2", _type: "order", discount: "0" }),
      ]),
      BASE,
    );
    expect(b).toBeNull();
  });

  it("never flags key attributes or _type", () => {
    // o2 has no GSI1PK, but that's a key: not a backfill candidate here since
    // the only differing attribute would be a key. status differs in presence.
    const b = computeBackfill(
      state([
        put("o1", { PK: "U#1", SK: "O#1", _type: "order" }),
        put("o2", { PK: "U#1", SK: "O#2", _type: "order" }),
      ]),
      BASE,
    );
    expect(b).toBeNull();
  });

  it("ignores untyped items and single-item types", () => {
    const b = computeBackfill(
      state([
        put("x1", { PK: "U#1", SK: "A", note: "hi" }), // untyped
        put("s1", { PK: "U#1", SK: "S", _type: "settings", channel: "email" }), // lone
      ]),
      BASE,
    );
    expect(b).toBeNull();
  });
});

describe("putItemOf", () => {
  it("extracts the put item from put / transact, and null otherwise", () => {
    expect(putItemOf({ kind: "put", item: { id: "a", attrs: {} } })!.id).toBe("a");
    expect(
      putItemOf({
        kind: "transact",
        actions: [
          { kind: "delete", id: "a" },
          { kind: "put", item: { id: "b", attrs: {} } },
        ],
      })!.id,
    ).toBe("b");
    expect(putItemOf({ kind: "delete", id: "a" })).toBeNull();
    expect(putItemOf(undefined)).toBeNull();
    expect(putItemOf({ kind: "transact", actions: [{ kind: "delete", id: "a" }] })).toBeNull();
  });
});
