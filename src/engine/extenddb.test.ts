import { describe, expect, it } from "vitest";
import { evaluateCompiled, sizeOf, toWireItem, validateCompiled } from "./extenddb";
import { parseExpression } from "./expression";
import type { Item } from "./types";

// The WASM is loaded by src/test/extenddb.setup.mjs.

const ada: Item = {
  id: "u1",
  attrs: { PK: "USER#1", SK: "PROFILE", name: "Ada Lovelace", age: "36", status: "active" },
};

/** Evaluate Keyway-style `expr  #n=..  :v=..` text against an item, as a filter. */
const holds = (text: string, item: Item = ada) => {
  const p = parseExpression(text, "filter");
  if (!p.expression) throw new Error(`bad test expression: ${text}: ${p.error}`);
  return evaluateCompiled(p.expression, item, "filter");
};

describe("toWireItem", () => {
  it("sends numeric-looking values as N and the rest as S", () => {
    expect(toWireItem({ age: "36", score: "-1.5", name: "Ada", id: "007x" })).toEqual({
      age: { N: "36" },
      score: { N: "-1.5" },
      name: { S: "Ada" },
      id: { S: "007x" },
    });
  });
});

describe("evaluateCompiled (ExtendDB)", () => {
  it.each([
    ["attribute_exists(PK)", true],
    ["attribute_not_exists(PK)", false],
    ["#s = :a  #s=status :a=active", true],
    ["#s <> :a  #s=status :a=active", false],
    ["age > :lo AND age < :hi  :lo=30 :hi=40", true],
    ["age BETWEEN :lo AND :hi  :lo=37 :hi=99", false],
    ["#s IN (:p, :a)  #s=status :p=pending :a=active", true],
    ["begins_with(PK, :u)  :u=USER#", true],
    ["contains(#n, :x)  #n=name :x=Love", true],
    ["size(#n) = :len  #n=name :len=12", true],
    ["attribute_type(age, :t)  :t=N", true],
    ["NOT (#s = :a)  #s=status :a=active", false],
  ])("%s → %s", (text, expected) => {
    expect(holds(text)).toBe(expected);
  });

  it("treats a missing item as empty, as DynamoDB does", () => {
    const none: Item = { id: "", attrs: {} };
    expect(holds("attribute_not_exists(PK)", none)).toBe(true);
    expect(holds("#s = :a  #s=status :a=active", none)).toBe(false);
  });

  it("compares numbers numerically, not as text", () => {
    expect(holds("age > :n  :n=4")).toBe(true); // "36" > "4" as text would be false
  });
});

describe("validateCompiled", () => {
  const c = { expression: "status = :s", names: {}, values: { ":s": { S: "x" } } };

  it("labels the error by expression kind", () => {
    expect(validateCompiled(c, "condition")).toMatch(/^Invalid ConditionExpression:/);
    expect(validateCompiled(c, "filter")).toMatch(/^Invalid FilterExpression:/);
  });

  it("returns null for a valid expression", () => {
    const valid = { ...c, expression: "#s = :s", names: { "#s": "status" } };
    expect(validateCompiled(valid, "filter")).toBeNull();
  });
});

describe("sizeOf", () => {
  it("counts attribute names and values as DynamoDB does", () => {
    expect(sizeOf({ id: "x", attrs: { PK: "USER#1" } })).toBe(2 + 6);
  });
});
