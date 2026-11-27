import { describe, it, expect } from "vitest";
import { StringStream } from "@codemirror/language";
import { token } from "./dslLanguage";

/** [text, style] for each non-space token of one line. */
function tokens(line: string) {
  const s = new StringStream(line, 2, 2);
  const state = { inValue: false };
  const out: [string, string | null][] = [];
  while (!s.eol()) {
    const style = token(s, state);
    const text = s.current();
    if (text.trim()) out.push([text, style]);
    s.start = s.pos;
  }
  return out;
}

describe("dslLanguage", () => {
  it("colours an item line: label, names, values", () => {
    expect(tokens("u1: PK=USER#1  SK=PROFILE  n=3")).toEqual([
      ["u1:", "labelName"],
      ["PK", "propertyName"],
      ["=", "operator"],
      ["USER#1", "string"],
      ["SK", "propertyName"],
      ["=", "operator"],
      ["PROFILE", "string"],
      ["n", "propertyName"],
      ["=", "operator"],
      ["3", "number"],
    ]);
  });

  it("keeps a value with spaces in one colour", () => {
    expect(tokens("u1: name=Ada Lovelace  SK=A").slice(3, 5)).toEqual([
      ["Ada", "string"],
      ["Lovelace", "string"],
    ]);
    expect(tokens("u1: name=Ada Lovelace  SK=A")[5]).toEqual(["SK", "propertyName"]);
  });

  it("colours comments, directives, the index arrow and placeholders", () => {
    expect(tokens("# hi there")).toEqual([["# hi there", "comment"]]);
    const ap = tokens('@ap find -> T PK = :v values={":v": {"S": "x"}}');
    expect(ap[0]).toEqual(["@ap", "keyword"]);
    expect(ap).toContainEqual(["->", "operator"]);
    expect(ap).toContainEqual([":v", "variableName"]);
    expect(ap).toContainEqual(['":v"', "string"]);
    expect(tokens("delete u1")[0]).toEqual(["delete", "keyword"]);
  });
});
