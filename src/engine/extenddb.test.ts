import { describe, expect, it } from "vitest";
import { evaluateCompiled, sizeOf, toWireItem, validateCompiled } from "./extenddb";
import { keyConditionTemplate, needsNamePlaceholder, parseExpression } from "./expression";
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

describe("keyConditionTemplate", () => {
  it("names the partition key, leaving its value to fill in", () => {
    expect(keyConditionTemplate({ hash: ["PK"], range: ["SK"] })).toBe("PK = :pk  :pk=");
  });

  it("routes reserved words through #names, as DynamoDB requires", () => {
    expect(needsNamePlaceholder("region")).toBe(true);
    expect(needsNamePlaceholder("GSI1PK")).toBe(false);
    expect(keyConditionTemplate({ hash: ["tenant", "region"], range: ["status", "date"] })).toBe(
      "tenant = :pk1 AND #pk2 = :pk2  #pk2=region :pk1= :pk2=",
    );
  });

  it("is a valid key condition once the values are filled in", () => {
    const schema = { hash: ["tenant", "region"], range: ["status", "date"] };
    const filled = keyConditionTemplate(schema)
      .replace(":pk1=", ":pk1=acme")
      .replace(":pk2=", ":pk2=us");
    expect(parseExpression(filled, "key", schema).error).toBeUndefined();
  });
});

describe("evaluateCompiled never throws", () => {
  it("treats a wrongly typed attribute operand as false, as DynamoDB does", () => {
    // begins_with(a, b) is valid; it only goes wrong when b holds a Number
    const p = parseExpression("begins_with(a, b)", "filter");
    expect(p.error).toBeUndefined();
    const item: Item = { id: "x", attrs: { a: "abc", b: "42" } };
    expect(evaluateCompiled(p.expression!, item, "filter")).toBe(false);
  });
});

describe("parseExpression: quoted values", () => {
  it("unescapes a quoted value, and reports a bad escape instead of throwing", () => {
    // the DSL text  :v="C:\\dir"  is the value  C:\dir
    const ok = parseExpression('x = :v  :v="C:\\\\dir"', "condition");
    expect(ok.expression?.values[":v"]).toEqual({ S: "C:\\dir" });
    // the DSL text  :v="C:\dir"  has an escape JSON doesn't know (\d)
    const bad = parseExpression('x = :v  :v="C:\\dir"', "condition");
    expect(bad.error).toMatch(/:v has an invalid quoted value/);
  });
});
