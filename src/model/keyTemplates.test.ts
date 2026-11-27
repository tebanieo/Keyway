import { describe, expect, it } from "vitest";
import { fold } from "../engine/engine";
import { parseDoc } from "./dsl";
import { BASE_INDEX } from "./seed";
import { fill, inferTemplate, keyLine } from "./keyTemplates";
import { schemaChanges } from "./schemaChange";

const HEAD = `@table T pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK
`;
const parse = (t: string) => parseDoc(t, BASE_INDEX);
const keysOf = (t: string) => {
  const p = parse(t);
  return [...fold(p.ops, p.base).values()].map((i) => i.attrs);
};

describe("@key templates", () => {
  it("fill an item's keys from its own attributes, written in any order", () => {
    const [o1] =
      keysOf(`${HEAD}@key order  SK=ORDER#{date}#{id}  GSI1PK=STATUS#{status}  GSI1SK={date}
o1: id=7  status=pending  PK=USER#1  date=2024-01  _type=order`);
    expect(o1).toMatchObject({
      SK: "ORDER#2024-01#7",
      GSI1PK: "STATUS#pending",
      GSI1SK: "2024-01",
    });
  });

  it("re-key every item of the type when the template changes", () => {
    const items = `o1: PK=U#1  date=2024-01  id=1  _type=order
o2: PK=U#1  date=2024-02  id=2  _type=order`;
    const v1 = keysOf(`${HEAD}@key order  SK=ORDER#{date}#{id}\n${items}`).map((a) => a.SK);
    const v2 = keysOf(`${HEAD}@key order  SK=ORD#{id}\n${items}`).map((a) => a.SK);
    expect(v1).toEqual(["ORDER#2024-01#1", "ORDER#2024-02#2"]);
    expect(v2).toEqual(["ORD#1", "ORD#2"]);
  });

  it("say what an item is missing, and keep an explicit key that disagrees (with a warning)", () => {
    const p = parse(`${HEAD}@key order  SK=ORDER#{date}#{id}
o1: PK=U#1  id=7  _type=order
o2: PK=U#1  SK=ORDER#x  date=d  id=1  _type=order`);
    const msgs = p.diagnostics.map((d) => d.message);
    expect(msgs).toContainEqual(expect.stringMatching(/o1 needs `date` for SK/));
    expect(msgs).toContainEqual(expect.stringMatching(/SK=ORDER#x doesn't match @key order/));
  });

  it("are suggested, with a one-click fix, when existing keys already follow a pattern", () => {
    const p = parse(`${HEAD}
o1: PK=USER#ada  SK=ORDER#2024-01#1  date=2024-01  n=1  _type=order
o2: PK=USER#bob  SK=ORDER#2024-02#2  date=2024-02  n=2  _type=order`);
    const hint = p.diagnostics.find((d) => d.severity === "hint")!;
    expect(hint.message).toMatch(/order keys follow a pattern/);
    expect(hint.fix).toEqual({
      label: "Add @key order",
      line: 2, // after the schema lines
      text: "@key order  SK=ORDER#{date}#{n}",
    });
  });

  it("flag the one item that breaks the pattern its siblings follow", () => {
    const p = parse(`${HEAD}
o1: PK=U#1  SK=ORDER#a  d=a  _type=order
o2: PK=U#1  SK=ORDER#b  d=b  _type=order
o3: PK=U#1  SK=ORDER#zz  d=c  _type=order`);
    expect(p.diagnostics.map((d) => d.message)).toContainEqual(
      expect.stringMatching(/o3's SK breaks the pattern .* \(expected SK=ORDER#c\)/),
    );
  });

  it("explain a template change on a model with data as a migration", () => {
    const a = parse(`${HEAD}@key order  SK=ORDER#{id}`);
    const b = parse(`${HEAD}@key order  SK=ORD#{id}`);
    const [c] = schemaChanges(a, b);
    expect(c.kind).toBe("key-template");
    expect(c.message).toMatch(/re-keys every order item/);
  });
});

describe("template helpers", () => {
  it("fill and infer", () => {
    expect(fill("A#{x}#{y}", { x: "1", y: "2" })).toEqual({ value: "A#1#2" });
    expect(fill("A#{x}", {})).toEqual({ missing: ["x"] });
    expect(inferTemplate(["P#1", "P#2"], [{ n: "1" }, { n: "2" }], new Set())).toBe("P#{n}");
    expect(inferTemplate(["PROFILE", "PROFILE"], [{}, {}], new Set())).toBeNull();
    expect(keyLine("order", { SK: "O#{id}" })).toBe("@key order  SK=O#{id}");
  });
});
