import { describe, expect, it } from "vitest";
import { itemSize, rcu, wcu } from "./itemsize";
import type { Item } from "./types";

const item = (attrs: Record<string, string>): Item => ({ id: "x", attrs });

describe("itemSize", () => {
  it("sums UTF-8 bytes of each attribute name + value", () => {
    // PK(2) + U#1(3) + SK(2) + PROFILE(7) = 14
    expect(itemSize(item({ PK: "U#1", SK: "PROFILE" }))).toBe(14);
  });
  it("counts multi-byte UTF-8 correctly (not code units)", () => {
    // n(1) + é(2 bytes in UTF-8, though .length is 1) = 3
    expect(itemSize(item({ n: "é" }))).toBe(3);
  });
  it("sizes numbers by significant digits, as DynamoDB does (via ExtendDB)", () => {
    // y(1) + 2024 as N: 1 + ceil(4 / 2) = 3, not the 4 bytes of the text
    expect(itemSize(item({ y: "2024" }))).toBe(1 + 3);
    // 1.5 as N: 1 + ceil(1/2) + ceil(1/2) = 3; -7 as N: 1 + 1 + 1 (sign) = 3
    expect(itemSize(item({ a: "1.5" }))).toBe(1 + 3);
    expect(itemSize(item({ a: "-7" }))).toBe(1 + 3);
    // a numeric-looking value inside a string is still a string
    expect(itemSize(item({ a: "v2024" }))).toBe(1 + 5);
  });
  it("is empty for an item with no attributes", () => {
    expect(itemSize(item({}))).toBe(0);
  });
});

describe("wcu", () => {
  it("1 WCU per 1KB, rounded up, min 1", () => {
    expect(wcu(0)).toBe(1);
    expect(wcu(500)).toBe(1);
    expect(wcu(1024)).toBe(1);
    expect(wcu(1025)).toBe(2);
    expect(wcu(3000)).toBe(3);
  });
  it("transactional writes cost double", () => {
    expect(wcu(500, true)).toBe(2);
    expect(wcu(1025, true)).toBe(4);
  });
});

describe("rcu", () => {
  it("1 RCU per 4KB strong, half eventual, double transactional", () => {
    expect(rcu(100, "strong")).toBe(1);
    expect(rcu(100, "eventual")).toBe(0.5);
    expect(rcu(100, "transactional")).toBe(2);
  });
  it("rounds up per 4KB", () => {
    expect(rcu(4096, "strong")).toBe(1);
    expect(rcu(4097, "strong")).toBe(2);
    expect(rcu(4097, "eventual")).toBe(1); // 2 units × 0.5
  });
  it("cumulative: many small items round once (Query/Scan)", () => {
    // 5 items totaling ~400 bytes read together = one 4KB unit
    expect(rcu(400, "eventual")).toBe(0.5);
  });
});
