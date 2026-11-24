import { describe, expect, it } from "vitest";
import { compareKeyValues, isNumber } from "./number";
import { toAttributeValue } from "./extenddb";

describe("isNumber: when a Keyway value is a DynamoDB Number", () => {
  it.each(["0", "7", "-7", "2024", "1.5", "-0.25", "10.50"])("%s is a Number", (v) => {
    expect(isNumber(v)).toBe(true);
    expect(toAttributeValue(v)).toEqual({ N: v });
  });
  it.each(["007", "00", "1e5", "+1", "1.", ".5", "v2024", "", "1".repeat(39)])(
    "%s is a String",
    (v) => {
      expect(isNumber(v)).toBe(false);
      expect(toAttributeValue(v)).toEqual({ S: v });
    },
  );
  it("allows exactly 38 significant digits", () => {
    expect(isNumber("1".repeat(38))).toBe(true);
    expect(isNumber("1" + "0".repeat(40))).toBe(true); // trailing zeros aren't significant
  });
});

describe("compareKeyValues", () => {
  it("orders Numbers numerically, as DynamoDB orders an N key", () => {
    expect(["10", "9", "-1", "2.5"].sort(compareKeyValues)).toEqual(["-1", "2.5", "9", "10"]);
  });
  it("orders Strings by their characters", () => {
    expect(["ORDER#10", "ORDER#9"].sort(compareKeyValues)).toEqual(["ORDER#10", "ORDER#9"]);
  });
});
