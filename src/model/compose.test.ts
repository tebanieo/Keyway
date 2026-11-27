import { describe, expect, it } from "vitest";
import { entityLines, indexLine } from "./compose";
import { parseDoc } from "./dsl";
import { BASE_INDEX } from "./seed";
import { fold } from "../engine/engine";

describe("guided forms write ordinary script lines", () => {
  it("an index", () => {
    expect(
      indexLine({ name: "GSI2", pk: "status", sk: "date", projection: "all", include: "" }),
    ).toBe("@gsi GSI2 pk=status sk=date");
    expect(
      indexLine({
        name: "ByT",
        pk: "tenant, region",
        sk: "",
        projection: "include",
        include: "a, b",
      }),
    ).toBe("@gsi ByT pk=tenant,region projection=a,b");
    expect(indexLine({ name: "G", pk: "x", sk: "", projection: "keys", include: "" })).toBe(
      "@gsi G pk=x projection=keys",
    );
  });

  it("an entity: a @key template plus a first item whose keys it fills in", () => {
    const lines = entityLines(
      {
        type: "order",
        keys: { PK: "USER#{userId}", SK: "ORDER#{date}#{id}" },
        attrs: "total, date",
      },
      "order1",
    );
    expect(lines).toEqual([
      "@key order  PK=USER#{userId}  SK=ORDER#{date}#{id}",
      "order1: userId=<userId>  date=<date>  id=<id>  total=<total>  _type=order",
    ]);
    const p = parseDoc(`@table T pk=PK sk=SK\n${lines.join("\n")}`, BASE_INDEX);
    const [item] = [...fold(p.ops, p.base).values()];
    expect(item.attrs).toMatchObject({ PK: "USER#<userId>", SK: "ORDER#<date>#<id>" });
  });

  it("an entity with literal keys only: no @key line", () => {
    expect(
      entityLines({ type: "user", keys: { PK: "USER#1", SK: "PROFILE" }, attrs: "" }, "u1"),
    ).toEqual(["u1: PK=USER#1  SK=PROFILE  _type=user"]);
  });
});
