import { describe, expect, it } from "vitest";
import { attributeTypes, keyConditionRequest, typeMismatches } from "./keyhelp";
import type { Item } from "./types";

const item = (attrs: Record<string, string>): Item => ({ id: "x", attrs });

describe("attributeTypes", () => {
  it("reads a Number only when every value is one", () => {
    const t = attributeTypes([item({ a: "5", b: "5", c: "x" }), item({ a: "7", b: "v7" })]);
    expect(t.get("a")).toBe("N");
    expect(t.get("b")).toBe("S");
    expect(t.get("c")).toBe("S");
  });
});

describe("keyConditionRequest", () => {
  const schema = { hash: ["PK"], range: ["SK"] };
  const types = new Map([["SK", "N" as const]]);

  it.each([
    ["=", "PK = :pk AND SK = :sk"],
    ["<", "PK = :pk AND SK < :sk"],
    [">=", "PK = :pk AND SK >= :sk"],
    ["BETWEEN", "PK = :pk AND SK BETWEEN :sk1 AND :sk2"],
    ["begins_with", "PK = :pk AND begins_with(SK, :sk)"],
  ] as const)("%s", (op, expression) => {
    expect(keyConditionRequest(schema, op, types).expression).toBe(expression);
  });

  it("types each value from the table and keeps what was typed", () => {
    const r = keyConditionRequest(schema, "=", types, { ":pk": { S: "U#1" } });
    expect(r.values).toEqual({ ":pk": { S: "U#1" }, ":sk": { N: "" } });
  });

  it("names reserved key attributes through #placeholders", () => {
    const r = keyConditionRequest({ hash: ["tenant", "region"], range: ["date"] }, ">", new Map());
    expect(r.expression).toBe("tenant = :pk1 AND #pk2 = :pk2 AND #sk > :sk");
    expect(r.names).toEqual({ "#pk2": "region", "#sk": "date" });
  });
});

describe("typeMismatches", () => {
  it("flags a String value compared with a Number attribute", () => {
    const expr = {
      expression: "#k > :v AND begins_with(s, :p)",
      names: { "#k": "SK" },
      values: { ":v": { S: "6" }, ":p": { S: "x" } },
      text: "",
    };
    const types = new Map([
      ["SK", "N" as const],
      ["s", "S" as const],
    ]);
    expect(typeMismatches(expr, types)).toEqual([
      "SK holds Numbers (N) in this table, but :v is a String (S): DynamoDB compares by type, so it won't match",
    ]);
  });
});
