import { describe, expect, it } from "vitest";
import { apCoverage } from "./coverage";
import { parseDoc } from "./dsl";
import { fold } from "../engine/engine";
import type { IndexSpec } from "../engine/types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };

/** Parse a doc, fold the whole thing, and grade the AP at index `i`. */
function grade(doc: string, i = 0) {
  const { aps, base, gsis, ops } = parseDoc(doc, BASE);
  const state = fold(ops, base);
  return apCoverage(aps[i], [base, ...gsis], state);
}

const MODEL = [
  "@table AppTable pk=PK sk=SK",
  "@gsi GSI1 pk=GSI1PK sk=GSI1SK",
  "u1: PK=USER#1  SK=PROFILE  GSI1PK=EMAIL#ada  GSI1SK=USER#1",
  "o1: PK=USER#1  SK=ORDER#1  GSI1PK=STATUS#pending  GSI1SK=2024-01",
  "o2: PK=USER#1  SK=ORDER#2  GSI1PK=STATUS#shipped  GSI1SK=2024-02",
].join("\n");

describe("apCoverage (v2: runs the declared query)", () => {
  it("served: a valid query that returns data", () => {
    const c = grade(MODEL + "\n@ap A user's items -> AppTable PK=USER#1");
    expect(c.status).toBe("served");
    expect(c.returned).toBe(3); // profile + order 1 + order 2
  });

  it("served: a GSI query with a sort-key range", () => {
    const c = grade(MODEL + "\n@ap Orders by email -> GSI1 GSI1PK=EMAIL#ada");
    expect(c.status).toBe("served");
    expect(c.returned).toBe(1);
  });

  it("empty: valid query but no item matches", () => {
    const c = grade(MODEL + "\n@ap Cancelled orders -> GSI1 GSI1PK=STATUS#cancelled");
    expect(c.status).toBe("empty");
    expect(c.returned).toBe(0);
  });

  it("invalid: query is missing the partition key (teaches the rule)", () => {
    const c = grade(MODEL + "\n@ap Orders by date -> GSI1 GSI1SK begins_with 2024");
    expect(c.status).toBe("invalid");
    expect(c.message).toMatch(/partition key/i);
  });

  it("invalid: a range on a non-key attribute", () => {
    const c = grade(MODEL + "\n@ap Bad -> GSI1 total > 10");
    expect(c.status).toBe("invalid");
    expect(c.message).toMatch(/isn't a key/i);
  });

  it("assigned: index named but no key condition to verify", () => {
    const c = grade(MODEL + "\n@ap Something -> GSI1");
    expect(c.status).toBe("assigned");
  });

  it("no-index: names an index that isn't defined", () => {
    const c = grade(MODEL + "\n@ap Something -> GSI9 GSI9PK=x");
    expect(c.status).toBe("no-index");
  });

  it("unassigned: no index named", () => {
    const c = grade(MODEL + "\n@ap Just a wish");
    expect(c.status).toBe("unassigned");
  });

  it("served: a GetItem by full base key", () => {
    const c = grade(MODEL + "\n@ap Get profile -> AppTable get PK=USER#1 SK=PROFILE");
    expect(c.status).toBe("served");
    expect(c.returned).toBe(1);
  });

  it("served: a scan returns the whole index", () => {
    const c = grade(MODEL + "\n@ap Everything -> AppTable scan");
    expect(c.status).toBe("served");
    expect(c.returned).toBe(3);
  });
});
