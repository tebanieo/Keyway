import { describe, expect, it } from "vitest";
import { setAttrInLine } from "./dsl";

const L = "u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  email=a@x";

describe("setAttrInLine", () => {
  it("replaces a value in place, spaces in values included", () => {
    expect(setAttrInLine(L, "name", "Ada King")).toBe(
      "u1: PK=USER#1  SK=PROFILE  name=Ada King  email=a@x",
    );
    expect(setAttrInLine(L, "email", "b@y")).toBe(
      "u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  email=b@y",
    );
  });

  it("adds a missing attribute, and removes one set to empty", () => {
    expect(setAttrInLine(L, "age", "37")).toBe(`${L}  age=37`);
    expect(setAttrInLine(L, "email", "")).toBe("u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace");
    expect(setAttrInLine(L, "name", "")).toBe("u1: PK=USER#1  SK=PROFILE  email=a@x");
  });

  it("keeps a trailing @if guard where it is", () => {
    const g = "o1: PK=U#1  SK=O#1  status=new  @if attribute_not_exists(PK)";
    expect(setAttrInLine(g, "status", "paid")).toBe(
      "o1: PK=U#1  SK=O#1  status=paid  @if attribute_not_exists(PK)",
    );
    expect(setAttrInLine(g, "total", "5")).toBe(
      "o1: PK=U#1  SK=O#1  status=new  total=5  @if attribute_not_exists(PK)",
    );
  });

  it("doesn't confuse a key with a longer one that ends the same way", () => {
    expect(setAttrInLine("x: PK=A  SK=B  GSI1SK=C", "SK", "Z")).toBe("x: PK=A  SK=Z  GSI1SK=C");
  });
});
