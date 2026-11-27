import { describe, expect, it } from "vitest";
import { parseDoc } from "./dsl";
import { BASE_INDEX } from "./seed";

const HEAD = "@table T pk=PK sk=SK\n@gsi GSI1 pk=GSI1PK sk=GSI1SK\n";
const warn = (line: string) => parseDoc(HEAD + line, BASE_INDEX).diagnostics.map((d) => d.message);

describe("design-slip warnings", () => {
  it("flags a key name one typo away from a declared key", () => {
    expect(warn("u1: PK=A  SK=B  GS1PK=x  GSI1SK=y")).toContainEqual(
      expect.stringMatching(/"GS1PK" looks like "GSI1PK" \(a key of GSI1\)/),
    );
    expect(warn("u1: PK=A  SK=B  gsi1pk=x")[0]).toMatch(/looks like "GSI1PK"/);
  });

  it("flags half of an index key", () => {
    expect(warn("u1: PK=A  SK=B  GSI1PK=x")).toContainEqual(
      expect.stringMatching(/has GSI1PK but no GSI1SK: it won't appear in GSI1/),
    );
  });

  it("flags two pairs run together in one value", () => {
    expect(warn("u1: PK=A  SK=B  _type=username=Ada")).toContainEqual(
      expect.stringMatching(/_type=username=Ada holds "username="/),
    );
  });

  it("stays quiet on a clean item, a sparse item, and values with # or :", () => {
    expect(warn("u1: PK=USER#1  SK=PROFILE  GSI1PK=E#a  GSI1SK=U1  when=12:30")).toEqual([]);
    expect(warn("s1: PK=USER#1  SK=SETTINGS  channel=email")).toEqual([]);
  });
});
