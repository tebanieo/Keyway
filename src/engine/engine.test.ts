import { describe, expect, it } from "vitest";
import { fold, keyOf, project } from "./engine";
import { animatedIds, diffViews } from "./diff";
import type { IndexSpec, Item, Op } from "./types";

const SEP = String.fromCharCode(0); // must match engine's KEY_SEP
const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };
const GSI1: IndexSpec = { name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" };

function item(id: string, attrs: Record<string, string>): Item {
  return { id, attrs };
}
function put(it: Item): Op {
  return { kind: "put", item: it };
}

describe("keyOf", () => {
  it("joins pk and sk with the composite separator", () => {
    expect(keyOf(item("a", { PK: "USER#1", SK: "PROFILE" }), BASE)).toBe(
      "USER#1" + SEP + "PROFILE",
    );
  });
  it("returns null when a key attribute is missing (sparse)", () => {
    expect(keyOf(item("a", { PK: "USER#1", SK: "PROFILE" }), GSI1)).toBeNull();
    expect(keyOf(item("a", { PK: "USER#1" }), BASE)).toBeNull();
  });
});

describe("fold", () => {
  it("last write wins on the same base key (overwrite)", () => {
    const ops: Op[] = [
      put(item("v1", { PK: "U#1", SK: "PROFILE", name: "old" })),
      put(item("v2", { PK: "U#1", SK: "PROFILE", name: "new" })),
    ];
    const state = fold(ops, BASE);
    expect(state.size).toBe(1);
    expect([...state.values()][0].attrs.name).toBe("new");
  });

  it("delete by stable id removes the row", () => {
    const ops: Op[] = [
      put(item("a", { PK: "U#1", SK: "PROFILE" })),
      put(item("b", { PK: "U#1", SK: "ORDER#1" })),
      { kind: "delete", id: "a" },
    ];
    const state = fold(ops, BASE);
    expect([...state.values()].map((i) => i.id)).toEqual(["b"]);
  });

  it("drops puts with an incomplete base key", () => {
    const state = fold([put(item("x", { PK: "U#1" }))], BASE);
    expect(state.size).toBe(0);
  });

  it("applies a transact bundle atomically as one step (key rename)", () => {
    const ops: Op[] = [
      put(item("o1", { PK: "U#1", SK: "ORDER#1" })),
      {
        kind: "transact",
        actions: [
          { kind: "delete", id: "o1" },
          { kind: "put", item: item("o1", { PK: "U#2", SK: "ORDER#1" }) },
        ],
      },
    ];
    const state = fold(ops, BASE);
    // exactly one row, moved to the new key, same stable id
    expect(state.size).toBe(1);
    const [row] = [...state.values()];
    expect(row.id).toBe("o1");
    expect(row.attrs.PK).toBe("U#2");
  });
});

describe("project", () => {
  const ops: Op[] = [
    put(item("p", { PK: "U#1", SK: "PROFILE", GSI1PK: "EMAIL#a@x", GSI1SK: "U#1" })),
    put(item("o2", { PK: "U#1", SK: "ORDER#2", GSI1PK: "STATUS#open", GSI1SK: "2024" })),
    put(item("o1", { PK: "U#1", SK: "ORDER#1", GSI1PK: "STATUS#open", GSI1SK: "2023" })),
    put(item("nogsi", { PK: "U#2", SK: "PROFILE" })), // absent from GSI1
  ];

  it("groups by base partition and sorts by sk", () => {
    const view = project(fold(ops, BASE), BASE);
    const u1 = view.partitions.find((p) => p.pk === "U#1")!;
    expect(u1.items.map((i) => i.attrs.SK)).toEqual(["ORDER#1", "ORDER#2", "PROFILE"]);
  });

  it("regroups items into GSI partitions", () => {
    const view = project(fold(ops, BASE), GSI1);
    const pks = view.partitions.map((p) => p.pk).sort();
    expect(pks).toEqual(["EMAIL#a@x", "STATUS#open"]);
    const open = view.partitions.find((p) => p.pk === "STATUS#open")!;
    // sorted by GSI1SK
    expect(open.items.map((i) => i.attrs.GSI1SK)).toEqual(["2023", "2024"]);
  });

  it("excludes sparse items from a GSI", () => {
    const view = project(fold(ops, BASE), GSI1);
    const allIds = view.partitions.flatMap((p) => p.items.map((i) => i.id));
    expect(allIds).not.toContain("nogsi");
  });

  it("INCLUDE keeps index keys, base keys, and the listed attributes", () => {
    const projected: IndexSpec = { ...GSI1, projection: ["GSI1SK"] };
    const view = project(fold(ops, BASE), projected, BASE);
    const anyItem = view.partitions[0].items[0];
    // GSI keys + base keys (PK, SK) + the include, but not name/total/etc.
    expect(Object.keys(anyItem.attrs).sort()).toEqual(["GSI1PK", "GSI1SK", "PK", "SK"].sort());
  });

  it("KEYS_ONLY keeps only the index keys and base keys", () => {
    const projected: IndexSpec = { ...GSI1, projection: "KEYS_ONLY" };
    const view = project(fold(ops, BASE), projected, BASE);
    const anyItem = view.partitions[0].items[0];
    expect(Object.keys(anyItem.attrs).sort()).toEqual(["GSI1PK", "GSI1SK", "PK", "SK"].sort());
  });
});

describe("project: multi-key GSI", () => {
  // up to 4 pk / 4 sk attributes, native (no concatenation)
  const MGSI: IndexSpec = {
    name: "MGSI",
    pk: "tenant",
    pks: ["tenant", "region"],
    sk: "status",
    sks: ["status", "date"],
  };
  const ops: Op[] = [
    put(
      item("a", {
        PK: "U#1",
        SK: "A",
        tenant: "acme",
        region: "us",
        status: "open",
        date: "2024-01",
      }),
    ),
    put(
      item("b", {
        PK: "U#1",
        SK: "B",
        tenant: "acme",
        region: "us",
        status: "open",
        date: "2024-02",
      }),
    ),
    put(
      item("c", {
        PK: "U#1",
        SK: "C",
        tenant: "acme",
        region: "eu",
        status: "open",
        date: "2024-01",
      }),
    ),
    put(item("d", { PK: "U#1", SK: "D", tenant: "acme" })), // missing region/status/date
  ];

  it("groups by the full partition tuple (tenant + region)", () => {
    const view = project(fold(ops, BASE), MGSI, BASE);
    // acme/us has a and b; acme/eu has c: two partitions
    expect(view.partitions).toHaveLength(2);
    const us = view.partitions.find((p) => p.items.some((i) => i.id === "a"))!;
    expect(us.items.map((i) => i.id)).not.toContain("c");
  });

  it("sorts within a partition by the sort-key tuple (status, then date)", () => {
    const view = project(fold(ops, BASE), MGSI, BASE);
    const us = view.partitions.find((p) => p.items.some((i) => i.id === "a"))!;
    expect(us.items.map((i) => i.id)).toEqual(["a", "b"]); // same status, 2024-01 < 2024-02
  });

  it("excludes an item missing any key attribute (sparse over the tuple)", () => {
    const view = project(fold(ops, BASE), MGSI, BASE);
    const ids = view.partitions.flatMap((p) => p.items.map((i) => i.id));
    expect(ids).not.toContain("d");
  });
});

describe("diffViews", () => {
  it("classifies enter / move / stable across an insert", () => {
    const before = fold(
      [put(item("a", { PK: "U#1", SK: "B" })), put(item("c", { PK: "U#1", SK: "D" }))],
      BASE,
    );
    const after = fold(
      [
        put(item("a", { PK: "U#1", SK: "B" })),
        put(item("c", { PK: "U#1", SK: "D" })),
        put(item("b", { PK: "U#1", SK: "C" })), // inserts between a and c
      ],
      BASE,
    );
    const delta = diffViews(project(before, BASE), project(after, BASE));
    expect([...delta.entered]).toEqual(["b"]);
    expect([...delta.moved]).toEqual(["c"]); // pushed down one slot
    expect([...delta.stable]).toEqual(["a"]); // unchanged position
    // only 2 elements animate regardless of partition size
    expect(animatedIds(delta).size).toBe(2);
  });
});
