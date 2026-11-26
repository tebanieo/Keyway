import { describe, expect, it } from "vitest";
import { evaluateCompiled, sizeOf, toWireItem, validateCompiled } from "./extenddb";
import { needsNamePlaceholder, parseExpression } from "./expression";
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
    ['#s = :a  names={"#s": "status"}  values={":a": {"S": "active"}}', true],
    ['#s <> :a  names={"#s": "status"}  values={":a": {"S": "active"}}', false],
    ['age > :lo AND age < :hi  values={":lo": {"N": "30"}, ":hi": {"N": "40"}}', true],
    ['age BETWEEN :lo AND :hi  values={":lo": {"N": "37"}, ":hi": {"N": "99"}}', false],
    [
      '#s IN (:p, :a)  names={"#s": "status"}  values={":p": {"S": "pending"}, ":a": {"S": "active"}}',
      true,
    ],
    ['begins_with(PK, :u)  values={":u": {"S": "USER#"}}', true],
    ['contains(#n, :x)  names={"#n": "name"}  values={":x": {"S": "Love"}}', true],
    ['size(#n) = :len  names={"#n": "name"}  values={":len": {"N": "12"}}', true],
    ['attribute_type(age, :t)  values={":t": {"S": "N"}}', true],
    ['NOT (#s = :a)  names={"#s": "status"}  values={":a": {"S": "active"}}', false],
  ])("%s → %s", (text, expected) => {
    expect(holds(text)).toBe(expected);
  });

  it("treats a missing item as empty, as DynamoDB does", () => {
    const none: Item = { id: "", attrs: {} };
    expect(holds("attribute_not_exists(PK)", none)).toBe(true);
    expect(holds('#s = :a  names={"#s": "status"}  values={":a": {"S": "active"}}', none)).toBe(
      false,
    );
  });

  it("compares numbers numerically, not as text", () => {
    expect(holds('age > :n  values={":n": {"N": "4"}}')).toBe(true); // "36" > "4" as text would be false
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

describe("needsNamePlaceholder", () => {
  it("asks ExtendDB which attribute names are reserved", () => {
    expect(needsNamePlaceholder("region")).toBe(true);
    expect(needsNamePlaceholder("GSI1PK")).toBe(false);
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

describe("parseExpression: the API's names= and values=", () => {
  const schema = { hash: ["PK"], range: ["SK"] };

  it("reads names and typed values as JSON, spaces and all", () => {
    const p = parseExpression(
      'PK = :pk and begins_with(#s, :o)  names={"#s": "SK"}  values={":pk": {"S": "ORDER 1"}, ":o": {"S": "ME"}}',
      "key",
      schema,
    );
    expect(p.error).toBeUndefined();
    expect(p.expression?.values).toEqual({ ":pk": { S: "ORDER 1" }, ":o": { S: "ME" } });
  });

  it("keeps a Number a Number, and a quoted 007 a String", () => {
    const p = parseExpression(
      'a = :n OR b = :s  values={":n": {"N": "7"}, ":s": {"S": "007"}}',
      "filter",
    );
    expect(p.expression?.values).toEqual({ ":n": { N: "7" }, ":s": { S: "007" } });
  });

  it("still accepts a compact expression with no spaces", () => {
    const p = parseExpression('#a=:v  names={"#a": "SK"}  values={":v": {"S": "x"}}', "filter");
    expect(p.error).toBeUndefined();
  });

  it("asks for a value the template left empty", () => {
    const p = parseExpression('PK = :pk  values={":pk": {"S": ""}}', "key", schema);
    expect(p.error).toMatch(/:pk is empty/);
  });

  it.each([
    ['PK = :pk  values={":pk": "x"}', /must be a typed value/],
    ['PK = :pk  values={":pk": {"S": "x"}', /complete JSON object/],
    ['PK = :pk  names={"s": "SK"}  values={":pk": {"S": "x"}}', /must start with #/],
    // the user's own query, typed with the old pairs
    [
      "PK = :pk  and SK = :sk :pk= ORDER#1 :sk=META",
      /write it as values=\{":pk": \{"S": "ORDER#1"\}\}/,
    ],
  ])("explains a malformed request: %s", (text, message) => {
    expect(parseExpression(text, "key", schema).error).toMatch(message);
  });
});
