import { describe, expect, it } from "vitest";
import { parseDoc, serializeOps } from "./dsl";
import { DEFAULT_DOC } from "./doc";
import { fold, project } from "../engine/engine";
import type { IndexSpec } from "../engine/types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };

describe("parseDoc", () => {
  it("parses a put with space-bearing values", () => {
    const { ops, diagnostics } = parseDoc(
      "u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  email=ada@x.io",
      BASE,
    );
    expect(diagnostics).toEqual([]);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      kind: "put",
      item: { id: "u1", attrs: { PK: "USER#1", SK: "PROFILE", name: "Ada Lovelace", email: "ada@x.io" } },
    });
  });

  it("ignores comments and blank lines", () => {
    const { ops } = parseDoc("# hello\n\n  # indented comment\nu1: PK=A  SK=B", BASE);
    expect(ops).toHaveLength(1);
  });

  it("a repeated label with the same key is a put (update)", () => {
    const { ops } = parseDoc(
      "o1: PK=U#1  SK=O#1  status=pending\no1: PK=U#1  SK=O#1  status=shipped",
      BASE,
    );
    expect(ops.map((o) => o.kind)).toEqual(["put", "put"]);
  });

  it("a repeated label with a new key becomes an atomic transact", () => {
    const { ops } = parseDoc(
      "o1: PK=U#1  SK=O#1\no1: PK=U#2  SK=O#1",
      BASE,
    );
    expect(ops[0].kind).toBe("put");
    expect(ops[1]).toMatchObject({
      kind: "transact",
      actions: [{ kind: "delete", id: "o1" }, { kind: "put" }],
    });
  });

  it("parses delete in both `delete x` and `-x` forms", () => {
    const { ops } = parseDoc("delete o1\n-o2", BASE);
    expect(ops).toEqual([
      { kind: "delete", id: "o1" },
      { kind: "delete", id: "o2" },
    ]);
  });

  it("flags a malformed line as an error", () => {
    const { diagnostics } = parseDoc("this is not valid", BASE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ line: 0, severity: "error" });
  });

  it("warns when an item is missing its key", () => {
    const { diagnostics } = parseDoc("x1: name=orphan", BASE);
    expect(diagnostics[0]).toMatchObject({ line: 0, severity: "warning" });
  });

  it("declares GSIs from @gsi directives with projection", () => {
    const { gsis, diagnostics } = parseDoc(
      "@gsi GSI1 pk=GSI1PK sk=GSI1SK\n@gsi ByStatus pk=G2PK sk=G2SK projection=keys\n@gsi Fred pk=FPK projection=status,total",
      BASE,
    );
    expect(diagnostics).toEqual([]);
    expect(gsis).toHaveLength(3);
    expect(gsis[0]).toMatchObject({ name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" });
    expect(gsis[0].projection).toBeUndefined(); // ALL
    expect(gsis[1]).toMatchObject({ name: "ByStatus", projection: "KEYS_ONLY" });
    expect(gsis[2]).toMatchObject({ name: "Fred", pk: "FPK", projection: ["status", "total"] });
    expect(gsis[2].sk).toBeUndefined(); // pk-only GSI
  });

  it("@table sets custom base keys, and drives item key detection", () => {
    const { base, ops, diagnostics } = parseDoc(
      "@table pk=orgId sk=recordId\nx1: orgId=ACME  recordId=INFO  note=hi",
      BASE,
    );
    expect(diagnostics).toEqual([]);
    expect(base).toMatchObject({ pk: "orgId", sk: "recordId" });
    expect(ops).toHaveLength(1); // item has both custom keys -> valid
  });

  it("@table with only pk= makes a PK-only base table", () => {
    const { base, diagnostics } = parseDoc("@table pk=id\nx1: id=A  v=1", BASE);
    expect(diagnostics).toEqual([]);
    expect(base.pk).toBe("id");
    expect(base.sk).toBeUndefined();
  });

  it("defaults base to the passed default when no @table", () => {
    const { base } = parseDoc("u1: PK=A  SK=B", BASE);
    expect(base).toMatchObject({ pk: "PK", sk: "SK" });
  });

  it("flags @table without pk=", () => {
    const { diagnostics } = parseDoc("@table sk=only", BASE);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("defaults to a single GSI1 when none are declared", () => {
    const { gsis } = parseDoc("u1: PK=A  SK=B", BASE);
    expect(gsis.map((g) => g.name)).toEqual(["GSI1"]);
  });

  it("flags a malformed @gsi and ignores @ lines as ops", () => {
    const { gsis, diagnostics, ops } = parseDoc(
      "@gsi\n@gsi Good pk=GPK\nu1: PK=A  SK=B",
      BASE,
    );
    expect(ops).toHaveLength(1); // only the item line
    expect(gsis.map((g) => g.name)).toEqual(["Good"]);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("serialize -> parse round-trips the op log", () => {
    const original = parseDoc(DEFAULT_DOC, BASE).ops;
    const text = serializeOps(original, BASE);
    const reparsed = parseDoc(text, BASE).ops;
    expect(reparsed).toEqual(original);
  });

  it("the default doc parses to the 8-step story with no errors", () => {
    const { ops, diagnostics } = parseDoc(DEFAULT_DOC, BASE);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(ops).toHaveLength(8);
    // final state: 4 items (u1, u2, s1, o3) after o1 ships and o2 is deleted
    const state = fold(ops, BASE);
    const ids = [...project(state, BASE).partitions.flatMap((p) => p.items.map((i) => i.id))];
    expect(ids.sort()).toEqual(["o1", "o3", "s1", "u1", "u2"].sort());
  });
});
