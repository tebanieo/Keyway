import { describe, expect, it } from "vitest";
import { fold } from "./engine";
import { runQuery } from "./query";
import type { QuerySpec } from "./query";
import { pkAttrs, skAttrs } from "./engine";
import { parseExpression } from "./expression";
import type { IndexSpec, Op } from "./types";

/** A FilterExpression as the Query panel builds it (throws if invalid). */
const filter = (text: string) => {
  const p = parseExpression(text, "filter");
  if (!p.expression) throw new Error(`bad test filter: ${text}: ${p.error}`);
  return p.expression;
};

/** A KeyConditionExpression for `index`, as the Query panel builds it. */
const key = (index: IndexSpec, text: string) => {
  const p = parseExpression(text, "key", { hash: pkAttrs(index), range: skAttrs(index) });
  if (!p.expression) throw new Error(`bad test key condition: ${text}: ${p.error}`);
  return p.expression;
};

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };
const GSI1: IndexSpec = { name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" };

function put(id: string, attrs: Record<string, string>): Op {
  return { kind: "put", item: { id, attrs } };
}

const data: Op[] = [
  put("p", { PK: "U#1", SK: "PROFILE", name: "Ada" }),
  put("o1", {
    PK: "U#1",
    SK: "ORDER#2024-01",
    status: "shipped",
    GSI1PK: "STATUS#shipped",
    GSI1SK: "2024-01",
  }),
  put("o2", {
    PK: "U#1",
    SK: "ORDER#2024-02",
    status: "pending",
    GSI1PK: "STATUS#pending",
    GSI1SK: "2024-02",
  }),
  put("o3", {
    PK: "U#1",
    SK: "ORDER#2024-03",
    status: "pending",
    GSI1PK: "STATUS#pending",
    GSI1SK: "2024-03",
  }),
  put("q", { PK: "U#2", SK: "PROFILE", name: "Alan" }),
];
const state = fold(data, BASE);

const spec = (o: Partial<QuerySpec>): QuerySpec => ({
  op: "query",
  pk: [],
  sk: [],
  key: null,
  filter: null,
  consistent: false,
  ...o,
});

describe("runQuery: get", () => {
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

describe("runQuery: query", () => {
  it("reads only the matched partition + sort range", () => {
    const r = runQuery(
      state,
      BASE,
      spec({ key: key(BASE, "PK = :u AND begins_with(SK, :a)  :u=U#1 :a=ORDER#") }),
    );
    expect(r.items.map((i) => i.id).sort()).toEqual(["o1", "o2", "o3"]);
    expect(r.scanned).toBe(3); // the profile is not read
  });

  it("a filter trims results but not the read cost", () => {
    const r = runQuery(
      state,
      BASE,
      spec({
        key: key(BASE, "PK = :u AND begins_with(SK, :a)  :u=U#1 :a=ORDER#"),
        filter: filter("#s = :p  #s=status :p=pending"),
      }),
    );
    expect(r.items.map((i) => i.id).sort()).toEqual(["o2", "o3"]); // returned
    expect(r.scanned).toBe(3); // but 3 were read: filters don't save RCU
  });

  it("queries a GSI partition", () => {
    const r = runQuery(state, GSI1, spec({ key: key(GSI1, "GSI1PK = :s  :s=STATUS#pending") }));
    expect(r.items.map((i) => i.id).sort()).toEqual(["o2", "o3"]);
  });

  it("applies a compound filter expression (AND)", () => {
    const r = runQuery(
      state,
      BASE,
      spec({
        key: key(BASE, "PK = :u AND begins_with(SK, :a)  :u=U#1 :a=ORDER#"),
        filter: filter("#s = :p AND GSI1SK > :d  #s=status :p=pending :d=2024-02"),
      }),
    );
    expect(r.items.map((i) => i.id)).toEqual(["o3"]);
  });

  it("applies a compound filter expression (OR)", () => {
    const r = runQuery(
      state,
      BASE,
      spec({
        key: key(BASE, "PK = :u AND begins_with(SK, :a)  :u=U#1 :a=ORDER#"),
        filter: filter("#s = :sh OR GSI1SK = :d  #s=status :sh=shipped :d=2024-03"),
      }),
    );
    expect(r.items.map((i) => i.id).sort()).toEqual(["o1", "o3"]);
  });

  it("range with between on the sort key", () => {
    const r = runQuery(
      state,
      BASE,
      spec({
        key: key(
          BASE,
          "PK = :u AND SK BETWEEN :a AND :b  :u=U#1 :a=ORDER#2024-02 :b=ORDER#2024-99",
        ),
      }),
    );
    expect(r.items.map((i) => i.id).sort()).toEqual(["o2", "o3"]);
  });
});

describe("runQuery: scan", () => {
  it("reads every item in the index", () => {
    const r = runQuery(state, BASE, spec({ op: "scan" }));
    expect(r.scanned).toBe(5); // ALL items: the expensive read (by count)
    // but these 5 items are tiny: cumulative < 4KB rounds to one eventual unit
    expect(r.rcu).toBe(0.5);
  });
  it("scan on a GSI only reads items present in that GSI (sparse)", () => {
    const r = runQuery(state, GSI1, spec({ op: "scan" }));
    expect(r.scanned).toBe(3); // only the 3 orders carry GSI1 keys
  });
  it("a scan filter trims results, not cost", () => {
    const r = runQuery(
      state,
      BASE,
      spec({ op: "scan", filter: filter("#s = :p  #s=status :p=pending") }),
    );
    expect(r.items.map((i) => i.id).sort()).toEqual(["o2", "o3"]);
    expect(r.scanned).toBe(5); // still read everything
  });
});

describe("runQuery: sort-key condition matrix", () => {
  it("= exact, and each range op on the sort key", () => {
    const eq = runQuery(
      state,
      BASE,
      spec({ key: key(BASE, "PK = :u AND SK = :a  :u=U#1 :a=ORDER#2024-02") }),
    );
    expect(eq.items.map((i) => i.id)).toEqual(["o2"]);

    const lt = runQuery(
      state,
      BASE,
      spec({ key: key(BASE, "PK = :u AND SK < :a  :u=U#1 :a=ORDER#2024-02") }),
    );
    expect(lt.items.map((i) => i.id)).toEqual(["o1"]);

    const lte = runQuery(
      state,
      BASE,
      spec({ key: key(BASE, "PK = :u AND SK <= :a  :u=U#1 :a=ORDER#2024-02") }),
    );
    expect(lte.items.map((i) => i.id).sort()).toEqual(["o1", "o2"]);

    // "PROFILE" sorts lexically AFTER "ORDER#..." so the > ranges include it,
    // a real DynamoDB gotcha (mixed SK prefixes in one partition).
    const gt = runQuery(
      state,
      BASE,
      spec({ key: key(BASE, "PK = :u AND SK > :a  :u=U#1 :a=ORDER#2024-02") }),
    );
    expect(gt.items.map((i) => i.id).sort()).toEqual(["o3", "p"]);

    const gte = runQuery(
      state,
      BASE,
      spec({ key: key(BASE, "PK = :u AND SK >= :a  :u=U#1 :a=ORDER#2024-02") }),
    );
    expect(gte.items.map((i) => i.id).sort()).toEqual(["o2", "o3", "p"]);
  });

  it("a query with no sort condition reads the whole partition (incl. the profile)", () => {
    const r = runQuery(state, BASE, spec({ key: key(BASE, "PK = :u  :u=U#1") }));
    expect(r.items.map((i) => i.id).sort()).toEqual(["o1", "o2", "o3", "p"]);
    expect(r.scanned).toBe(4);
  });

  it("an empty partition reads nothing but still costs the 1-unit RCU floor", () => {
    const r = runQuery(state, BASE, spec({ key: key(BASE, "PK = :u  :u=U#404") }));
    expect(r.items).toHaveLength(0);
    expect(r.scanned).toBe(0);
    expect(r.rcu).toBe(0.5); // even a zero-item read bills the minimum eventual unit
  });
});

describe("runQuery: read consistency (RCU)", () => {
  it("a strongly-consistent get costs 1 RCU vs 0.5 eventual", () => {
    const strong = runQuery(
      state,
      BASE,
      spec({ op: "get", pk: ["U#1"], sk: ["PROFILE"], consistent: true }),
    );
    expect(strong.rcu).toBe(1);
    const eventual = runQuery(state, BASE, spec({ op: "get", pk: ["U#1"], sk: ["PROFILE"] }));
    expect(eventual.rcu).toBe(0.5);
  });
});

describe("runQuery: validation (ExtendDB key-condition rules)", () => {
  const MGSI: IndexSpec = {
    name: "M",
    pk: "tenant",
    pks: ["tenant", "area"],
    sk: "phase",
    sks: ["phase", "opened"],
  };
  const raw = (expression: string, values: Record<string, string>) => ({
    expression,
    names: {},
    values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { S: v }])),
    text: expression,
  });

  it("a Query needs a KeyConditionExpression", () => {
    expect(runQuery(state, BASE, spec({})).error).toMatch(/KeyConditionExpression/);
  });
  it("requires the partition key", () => {
    const r = runQuery(state, BASE, spec({ key: raw("SK = :s", { ":s": "PROFILE" }) }));
    expect(r.error).toMatch(/missed key schema element: PK/);
  });
  it("refuses a non-key attribute in place of the sort key", () => {
    const k = raw("PK = :u AND price = :p", { ":u": "U#1", ":p": "9" });
    expect(runQuery(state, BASE, spec({ key: k })).error).toMatch(/missed key schema element: SK/);
  });
  it("requires equality on every partition attribute of a multi-key index", () => {
    const r = runQuery(state, MGSI, spec({ key: raw("tenant = :t", { ":t": "acme" }) }));
    expect(r.error).toMatch(/HASH key attributes area must have equality conditions/);
  });
  it("rejects a range on a non-last sort attribute", () => {
    const k = raw("tenant = :t AND area = :z AND phase > :p AND opened = :o", {
      ":t": "acme",
      ":z": "us",
      ":p": "open",
      ":o": "x",
    });
    expect(runQuery(state, MGSI, spec({ key: k })).error).toMatch(
      /RANGE key attributes phase must have equality conditions/,
    );
  });
  it("allows a range on the last sort attribute with equality before it", () => {
    const k = raw("tenant = :t AND area = :z AND phase = :p AND opened > :o", {
      ":t": "acme",
      ":z": "us",
      ":p": "open",
      ":o": "2024-01",
    });
    expect(runQuery(state, MGSI, spec({ key: k })).error).toBeNull();
  });
  it("GetItem needs the full primary key", () => {
    const r = runQuery(state, BASE, spec({ op: "get", pk: ["U#1"], sk: [] }));
    expect(r.error).toMatch(/does not match the schema/);
  });
});
