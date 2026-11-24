import { describe, expect, it } from "vitest";
import { compile, evaluate, sizeOf, toWireItem } from "./extenddb";
import { parseFilter } from "./filter";
import type { Item } from "./types";

const ast = (text: string) => {
  const parsed = parseFilter(text);
  if (!parsed.ast) throw new Error(parsed.error ?? "empty");
  return parsed.ast;
};

const ada: Item = {
  id: "u1",
  attrs: { PK: "USER#1", SK: "PROFILE", name: "Ada Lovelace", age: "36", status: "active" },
};

// The WASM is loaded by src/test/extenddb.setup.mjs.

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

describe("compile", () => {
  it("moves names and values into placeholders", () => {
    expect(compile(ast("status = active AND age > 30"))).toEqual({
      expression: "(#n0 = :v0 AND #n1 > :v1)",
      names: { "#n0": "status", "#n1": "age" },
      values: { ":v0": { S: "active" }, ":v1": { N: "30" } },
    });
  });

  it("reuses a placeholder for a repeated name or value", () => {
    const c = compile(ast("a = x OR b = x OR a = y"));
    expect(Object.keys(c.names)).toEqual(["#n0", "#n1"]);
    expect(Object.keys(c.values)).toEqual([":v0", ":v1"]);
  });

  it("translates functions, BETWEEN, IN and size()", () => {
    expect(compile(ast("attribute_not_exists(PK)")).expression).toBe("attribute_not_exists(#n0)");
    expect(compile(ast("begins_with(SK, ORDER#)")).expression).toBe("begins_with(#n0, :v0)");
    expect(compile(ast("age BETWEEN 1 AND 9")).expression).toBe("#n0 BETWEEN :v0 AND :v1");
    expect(compile(ast("status IN (a, b)")).expression).toBe("#n0 IN (:v0, :v1)");
    expect(compile(ast("size(name) > 3")).expression).toBe("size(#n0) > :v0");
  });
});

describe("evaluate (ExtendDB)", () => {
  it.each([
    ["attribute_exists(PK)", true],
    ["attribute_not_exists(PK)", false],
    ["status = active", true],
    ["status <> active", false],
    ["age > 30 AND age < 40", true],
    ["age BETWEEN 37 AND 99", false],
    ["status IN (pending, active)", true],
    ['begins_with(PK, "USER#")', true],
    ["contains(name, Love)", true],
    ["size(name) = 12", true],
    ["attribute_type(age, N)", true],
    ["NOT (status = active)", false],
  ])("%s → %s", (text, expected) => {
    expect(evaluate(ast(text), ada)).toBe(expected);
  });

  it("treats a missing item as empty, as DynamoDB does", () => {
    const none: Item = { id: "", attrs: {} };
    expect(evaluate(ast("attribute_not_exists(PK)"), none)).toBe(true);
    expect(evaluate(ast("status = active"), none)).toBe(false);
  });

  it("compares numbers numerically, not as text", () => {
    expect(evaluate(ast("age > 4"), ada)).toBe(true); // "36" > "4" as text would be false
  });
});

describe("sizeOf", () => {
  it("counts attribute names and values as DynamoDB does", () => {
    expect(sizeOf({ id: "x", attrs: { PK: "USER#1" } })).toBe(2 + 6);
  });
});
