import { describe, expect, it } from "vitest";
import { apCoverage, apLineNotes } from "./coverage";
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
    const c = grade(
      MODEL + `\n@ap A user's items -> AppTable PK = :u  values={":u": {"S": "USER#1"}}`,
    );
    expect(c.status).toBe("served");
    expect(c.returned).toBe(3); // profile + order 1 + order 2
  });

  it("served: a GSI query with a sort-key range", () => {
    const c = grade(
      MODEL + '\n@ap Orders by email -> GSI1 GSI1PK = :e  values={":e": {"S": "EMAIL#ada"}}',
    );
    expect(c.status).toBe("served");
    expect(c.returned).toBe(1);
  });

  it("empty: valid query but no item matches", () => {
    const c = grade(
      MODEL +
        '\n@ap Cancelled orders -> GSI1 GSI1PK = :s  values={":s": {"S": "STATUS#cancelled"}}',
    );
    expect(c.status).toBe("empty");
    expect(c.returned).toBe(0);
  });

  it("invalid: query is missing the partition key (teaches the rule)", () => {
    const c = grade(
      MODEL + '\n@ap Orders by date -> GSI1 begins_with(GSI1SK, :y)  values={":y": {"N": "2024"}}',
    );
    expect(c.status).toBe("invalid");
    expect(c.message).toMatch(/partition key condition must use equality/);
  });

  it("invalid: a sort-key condition on a non-key attribute", () => {
    const c = grade(
      MODEL +
        '\n@ap Bad -> GSI1 GSI1PK = :s AND price > :n  values={":s": {"S": "STATUS#pending"}, ":n": {"N": "10"}}',
    );
    expect(c.status).toBe("invalid");
    expect(c.message).toMatch(/missed key schema element: GSI1SK/);
  });

  it("empty: explains a type mismatch, the usual reason nothing matches", () => {
    // a table whose sort keys are all Numbers, queried with a String
    const doc = [
      "@table T pk=PK sk=SK",
      "n1: PK=N  SK=5",
      '@ap By number -> T PK = :p AND SK > :s  values={":p": {"S": "N"}, ":s": {"S": "1"}}',
    ].join("\n");
    const c = grade(doc);
    expect(c.status).toBe("empty");
    expect(c.message).toMatch(/SK holds/);
  });

  it("assigned: index named but no key condition to verify", () => {
    const c = grade(MODEL + "\n@ap Something -> GSI1");
    expect(c.status).toBe("assigned");
  });

  it("no-index: names an index that isn't defined", () => {
    const c = grade(MODEL + '\n@ap Something -> GSI9 GSI9PK = :x  values={":x": {"S": "x"}}');
    expect(c.status).toBe("no-index");
  });

  it("unassigned: no index named", () => {
    const c = grade(MODEL + "\n@ap Just a wish");
    expect(c.status).toBe("unassigned");
  });

  it("served: a GetItem by full base key", () => {
    const c = grade(
      MODEL +
        '\n@ap Get profile -> AppTable get key={"PK": {"S": "USER#1"}, "SK": {"S": "PROFILE"}}',
    );
    expect(c.status).toBe("served");
    expect(c.returned).toBe(1);
  });

  it("invalid: a reserved word without a #name (DynamoDB's own error)", () => {
    const c = grade(
      MODEL +
        '\n@ap Bad -> GSI1 GSI1PK = :s AND status = :x  values={":s": {"S": "a"}, ":x": {"S": "b"}}',
    );
    expect(c.status).toBe("invalid");
    expect(c.message).toMatch(/reserved keyword: status/);
  });

  it("invalid: a GetItem key with a non-key attribute", () => {
    const c = grade(
      MODEL + '\n@ap Get -> AppTable get key={"PK": {"S": "USER#1"}, "name": {"S": "Ada"}}',
    );
    expect(c.status).toBe("invalid");
    expect(c.message).toMatch(/does not match the schema/);
  });

  it("served: a scan returns the whole index", () => {
    const c = grade(MODEL + "\n@ap Everything -> AppTable scan");
    expect(c.status).toBe("served");
    expect(c.returned).toBe(3);
  });
});

describe("apLineNotes", () => {
  it("puts each @ap's coverage on its own line: served is info, a gap a warning", () => {
    const parsed = parseDoc(
      `@table T pk=PK sk=SK
u1: PK=USER#1  SK=A
@ap Get a user -> T PK = :u  values={":u": {"S": "USER#1"}}
@ap By email (no index yet)`,
      BASE,
    );
    expect(apLineNotes(parsed)).toEqual([
      { line: 2, severity: "info", message: expect.stringMatching(/^AP1 served: /) },
      { line: 3, severity: "warning", message: expect.stringMatching(/^AP2 unassigned: /) },
    ]);
  });
});
