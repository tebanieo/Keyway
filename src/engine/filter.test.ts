import { describe, expect, it } from "vitest";
import { evalFilter, parseFilter } from "./filter";
import type { Item } from "./types";

const item = (attrs: Record<string, string>): Item => ({ id: "x", attrs });

/** Parse + evaluate against an item; throws if the expression doesn't parse. */
function match(expr: string, attrs: Record<string, string>): boolean {
  const { ast, error } = parseFilter(expr);
  if (error || !ast) throw new Error(error ?? "no ast");
  return evalFilter(ast, item(attrs));
}

describe("parseFilter — errors", () => {
  it("empty expression yields no ast, no error", () => {
    expect(parseFilter("   ")).toEqual({});
  });
  it("reports a parse error for junk", () => {
    expect(parseFilter("status =").error).toBeTruthy();
    expect(parseFilter("status = pending AND").error).toBeTruthy();
    expect(parseFilter("(status = a").error).toBeTruthy();
  });
});

describe("comparators", () => {
  it("= and <>", () => {
    expect(match("status = pending", { status: "pending" })).toBe(true);
    expect(match("status = pending", { status: "shipped" })).toBe(false);
    expect(match("status <> pending", { status: "shipped" })).toBe(true);
  });
  it("compares numbers numerically, not lexically", () => {
    expect(match("total > 9", { total: "10" })).toBe(true); // "10" > "9" lexically is false
    expect(match("total <= 50", { total: "42.00" })).toBe(true);
  });
  it("a missing attribute makes a comparison false", () => {
    expect(match("status = pending", {})).toBe(false);
  });
});

describe("BETWEEN and IN", () => {
  it("BETWEEN is inclusive", () => {
    expect(match("date BETWEEN 2024-01 AND 2024-03", { date: "2024-02" })).toBe(true);
    expect(match("date BETWEEN 2024-01 AND 2024-03", { date: "2024-09" })).toBe(false);
  });
  it("IN matches any listed value", () => {
    expect(match("status IN (open, pending, shipped)", { status: "pending" })).toBe(true);
    expect(match("status IN (open, shipped)", { status: "pending" })).toBe(false);
  });
});

describe("functions", () => {
  it("attribute_exists / attribute_not_exists", () => {
    expect(match("attribute_exists(email)", { email: "a@x" })).toBe(true);
    expect(match("attribute_exists(email)", {})).toBe(false);
    expect(match("attribute_not_exists(email)", {})).toBe(true);
  });
  it("begins_with and contains", () => {
    expect(match("begins_with(SK, ORDER#)", { SK: "ORDER#1" })).toBe(true);
    expect(match("contains(name, Lov)", { name: "Ada Lovelace" })).toBe(true);
    expect(match("contains(name, zzz)", { name: "Ada" })).toBe(false);
  });
  it("size() as a numeric operand", () => {
    expect(match("size(name) > 3", { name: "Ada" })).toBe(false); // len 3
    expect(match("size(name) >= 3", { name: "Ada" })).toBe(true);
    expect(match("size(name) <= 20", { name: "Ada Lovelace" })).toBe(true);
  });
  it("attribute_type infers N for numeric values, S otherwise (consistent with compare)", () => {
    expect(match("attribute_type(name, S)", { name: "Ada" })).toBe(true);
    expect(match("attribute_type(name, N)", { name: "Ada" })).toBe(false);
    // numeric-looking values report N, matching how `compare` orders them
    expect(match("attribute_type(total, N)", { total: "42.00" })).toBe(true);
    expect(match("attribute_type(total, S)", { total: "42.00" })).toBe(false);
  });
});

describe("logic + precedence", () => {
  it("AND binds tighter than OR", () => {
    // a OR b AND c  ==  a OR (b AND c)
    const attrs = { a: "1", b: "0", c: "0" };
    expect(match("a = 1 OR b = 1 AND c = 1", attrs)).toBe(true); // a matches
    expect(match("b = 1 AND c = 1 OR a = 1", attrs)).toBe(true);
  });
  it("parentheses override precedence", () => {
    const attrs = { a: "1", b: "1", c: "0" };
    expect(match("(a = 1 OR b = 1) AND c = 1", attrs)).toBe(false); // c fails
    expect(match("a = 1 OR b = 1 AND c = 1", attrs)).toBe(true); // a matches
  });
  it("NOT negates", () => {
    expect(match("NOT status = pending", { status: "shipped" })).toBe(true);
    expect(match("NOT (status = pending OR status = open)", { status: "shipped" })).toBe(true);
  });
  it("quoted values allow spaces", () => {
    expect(match('name = "Ada Lovelace"', { name: "Ada Lovelace" })).toBe(true);
  });
});

describe("comparators — full op matrix (string semantics)", () => {
  it("<, <=, >, >= and <> on strings", () => {
    expect(match("s < b", { s: "a" })).toBe(true);
    expect(match("s <= a", { s: "a" })).toBe(true);
    expect(match("s > a", { s: "b" })).toBe(true);
    expect(match("s >= b", { s: "b" })).toBe(true);
    expect(match("s <> a", { s: "b" })).toBe(true);
    expect(match("s <> a", { s: "a" })).toBe(false);
  });
});

describe("size() operand positions", () => {
  it("size on the right, and in BETWEEN", () => {
    expect(match("size(name) between 1 and 3", { name: "Ada" })).toBe(true);
    expect(match("size(name) between 4 and 10", { name: "Ada" })).toBe(false);
  });
  it("size() of a missing attribute is undefined → comparison false", () => {
    expect(match("size(missing) > 0", {})).toBe(false);
  });
});

describe("parse errors surface a message", () => {
  it("unterminated string / unexpected char / keyword-as-attr / no comparator", () => {
    expect(parseFilter('name = "abc').error).toMatch(/unterminated/);
    expect(parseFilter("name = %").error).toBeTruthy();
    expect(parseFilter("and = 1").error).toMatch(/keyword/);
    expect(parseFilter("status pending").error).toMatch(/comparator/);
    expect(parseFilter("attribute_type(x)").error).toBeTruthy(); // missing comma/type
  });
});

describe("deep nesting and NOT chains", () => {
  it("doubled NOT and nested parens evaluate", () => {
    expect(match("NOT NOT status = a", { status: "a" })).toBe(true);
    expect(match("(((status = a)))", { status: "a" })).toBe(true);
  });
});

describe("proto-key hygiene (SEC1)", () => {
  it("inherited keys are not attributes", () => {
    expect(match("attribute_exists(constructor)", {})).toBe(false);
    expect(match("attribute_not_exists(toString)", {})).toBe(true);
    expect(match("attribute_type(hasOwnProperty, S)", {})).toBe(false);
  });
  it("a real own attribute of that name still works", () => {
    expect(match("attribute_exists(constructor)", { constructor: "x" })).toBe(true);
    expect(match("constructor = x", { constructor: "x" })).toBe(true);
  });
});
