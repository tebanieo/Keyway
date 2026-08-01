import { describe, expect, it } from "vitest";
import { fold } from "./engine";
import { runQuery } from "./query";
import type { QuerySpec } from "./query";
import type { IndexSpec, Op } from "./types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };
const GSI1: IndexSpec = { name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" };

function put(id: string, attrs: Record<string, string>): Op {
  return { kind: "put", item: { id, attrs } };
}

const data: Op[] = [
  put("p", { PK: "U#1", SK: "PROFILE", name: "Ada" }),
  put("o1", { PK: "U#1", SK: "ORDER#2024-01", status: "shipped", GSI1PK: "STATUS#shipped", GSI1SK: "2024-01" }),
  put("o2", { PK: "U#1", SK: "ORDER#2024-02", status: "pending", GSI1PK: "STATUS#pending", GSI1SK: "2024-02" }),
  put("o3", { PK: "U#1", SK: "ORDER#2024-03", status: "pending", GSI1PK: "STATUS#pending", GSI1SK: "2024-03" }),
  put("q", { PK: "U#2", SK: "PROFILE", name: "Alan" }),
];
const state = fold(data, BASE);

const spec = (o: Partial<QuerySpec>): QuerySpec => ({
  op: "query",
  pk: [],
  sk: [],
  skParts: [],
  filters: [],
  consistent: false,
  ...o,
});

describe("runQuery — get", () => {
  it("returns the exact item and charges one read", () => {
    const r = runQuery(state, BASE, spec({ op: "get", pk: ["U#1"], sk: ["PROFILE"] }));
    expect(r.items.map((i) => i.id)).toEqual(["p"]);
    expect(r.scanned).toBe(1);
    expect(r.rcu).toBe(0.5); // eventually consistent
  });
  it("still charges a read on a miss", () => {
    const r = runQuery(state, BASE, spec({ op: "get", pk: ["U#9"], sk: ["PROFILE"] }));
    expect(r.items).toHaveLength(0);
    expect(r.scanned).toBe(1);
  });
});

describe("runQuery — query", () => {
  it("reads only the matched partition + sort range", () => {
    const r = runQuery(
      state,
      BASE,
      spec({ pk: ["U#1"], skParts: [{ op: "begins_with", value: "ORDER#" }] }),
    );
    expect(r.items.map((i) => i.id).sort()).toEqual(["o1", "o2", "o3"]);
    expect(r.scanned).toBe(3); // the profile is not read
  });

  it("a filter trims results but not the read cost", () => {
    const r = runQuery(
      state,
      BASE,
      spec({
        pk: ["U#1"],
        skParts: [{ op: "begins_with", value: "ORDER#" }],
        filters: [{ attr: "status", op: "=", value: "pending" }],
      }),
    );
    expect(r.items.map((i) => i.id).sort()).toEqual(["o2", "o3"]); // returned
    expect(r.scanned).toBe(3); // but 3 were read — filters don't save RCU
  });

  it("queries a GSI partition", () => {
    const r = runQuery(state, GSI1, spec({ pk: ["STATUS#pending"] }));
    expect(r.items.map((i) => i.id).sort()).toEqual(["o2", "o3"]);
  });

  it("ANDs multiple filter conditions", () => {
    const r = runQuery(
      state,
      BASE,
      spec({
        pk: ["U#1"],
        skParts: [{ op: "begins_with", value: "ORDER#" }],
        filters: [
          { attr: "status", op: "=", value: "pending" },
          { attr: "GSI1SK", op: ">", value: "2024-02", combinator: "and" },
        ],
      }),
    );
    expect(r.items.map((i) => i.id)).toEqual(["o3"]); // pending AND after 2024-02
  });

  it("ORs filter conditions (AND binds tighter)", () => {
    const r = runQuery(
      state,
      BASE,
      spec({
        pk: ["U#1"],
        skParts: [{ op: "begins_with", value: "ORDER#" }],
        filters: [
          { attr: "status", op: "=", value: "shipped" },
          { attr: "GSI1SK", op: "=", value: "2024-03", combinator: "or" },
        ],
      }),
    );
    expect(r.items.map((i) => i.id).sort()).toEqual(["o1", "o3"]); // shipped OR 2024-03
  });

  it("range with between on the sort key", () => {
    const r = runQuery(
      state,
      BASE,
      spec({ pk: ["U#1"], skParts: [{ op: "between", value: "ORDER#2024-02", value2: "ORDER#2024-99" }] }),
    );
    expect(r.items.map((i) => i.id).sort()).toEqual(["o2", "o3"]);
  });
});

describe("runQuery — scan", () => {
  it("reads every item in the index", () => {
    const r = runQuery(state, BASE, spec({ op: "scan" }));
    expect(r.scanned).toBe(5); // ALL items — the expensive read
    expect(r.rcu).toBe(2.5);
  });
  it("scan on a GSI only reads items present in that GSI (sparse)", () => {
    const r = runQuery(state, GSI1, spec({ op: "scan" }));
    expect(r.scanned).toBe(3); // only the 3 orders carry GSI1 keys
  });
  it("a scan filter trims results, not cost", () => {
    const r = runQuery(state, BASE, spec({ op: "scan", filters: [{ attr: "status", op: "=", value: "pending" }] }));
    expect(r.items.map((i) => i.id).sort()).toEqual(["o2", "o3"]);
    expect(r.scanned).toBe(5); // still read everything
  });
});

describe("runQuery — validation (multi-key rules)", () => {
  const MGSI: IndexSpec = {
    name: "M",
    pk: "tenant",
    pks: ["tenant", "region"],
    sk: "status",
    sks: ["status", "date"],
  };
  it("requires equality on every partition attribute", () => {
    const r = runQuery(state, MGSI, spec({ pk: ["acme"] })); // missing region
    expect(r.error).toMatch(/partition key/);
  });
  it("rejects a range on a non-last sort attribute", () => {
    const r = runQuery(
      state,
      MGSI,
      spec({ pk: ["acme", "us"], skParts: [{ op: ">", value: "open" }, { op: "=", value: "x" }] }),
    );
    expect(r.error).toMatch(/only the last sort key/);
  });
  it("allows a range on the last sort attribute with equality before it", () => {
    const r = runQuery(
      state,
      MGSI,
      spec({ pk: ["acme", "us"], skParts: [{ op: "=", value: "open" }, { op: ">", value: "2024-01" }] }),
    );
    expect(r.error).toBeNull();
  });
});
