import { describe, expect, it } from "vitest";
import { allAttrNames, deriveEntities } from "./entities";
import type { Item } from "../engine/types";

const item = (attrs: Record<string, string>): Item => ({ id: attrs.SK ?? "x", attrs });

describe("deriveEntities", () => {
  const items: Item[] = [
    item({ PK: "USER#1", SK: "PROFILE", name: "Ada", email: "a@x", _type: "user-profile" }),
    item({ PK: "USER#2", SK: "PROFILE", name: "Alan", _type: "user-profile" }),
    item({ PK: "USER#1", SK: "ORDER#1", total: "42", status: "pending", _type: "order" }),
    item({ PK: "USER#1", SK: "SETTINGS" }), // untyped — ignored
  ];

  it("groups by _type and unions attributes", () => {
    const ents = deriveEntities(items);
    const byType = Object.fromEntries(ents.map((e) => [e.type, e]));
    expect(Object.keys(byType).sort()).toEqual(["order", "user-profile"]);
    // union across the two profiles: name from both, email from the first only
    expect(byType["user-profile"].attrs.sort()).toEqual(["PK", "SK", "email", "name"].sort());
    expect(byType["user-profile"].count).toBe(2);
    expect(byType["order"].attrs.sort()).toEqual(
      ["PK", "SK", "status", "total"].sort(),
    );
  });

  it("does not include _type itself in a template", () => {
    const ents = deriveEntities(items);
    expect(ents.every((e) => !e.attrs.includes("_type"))).toBe(true);
  });

  it("orders lead attributes (keys) first", () => {
    const [profile] = deriveEntities(items, ["PK", "SK"]);
    expect(profile.attrs.slice(0, 2)).toEqual(["PK", "SK"]);
  });

  it("ignores untyped items", () => {
    const ents = deriveEntities(items);
    expect(ents.reduce((n, e) => n + e.count, 0)).toBe(3); // the SETTINGS row is skipped
  });
});

describe("allAttrNames", () => {
  it("collects distinct attribute names, excluding _type", () => {
    const names = allAttrNames([
      item({ PK: "A", SK: "B", status: "x", _type: "order" }),
      item({ PK: "A", SK: "C", total: "1" }),
    ]);
    expect(names).toContain("status");
    expect(names).toContain("total");
    expect(names).not.toContain("_type");
  });
});
