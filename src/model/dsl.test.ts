import { describe, expect, it } from "vitest";
import { parseDoc, serializeAps, serializeGsis, serializeOps } from "./dsl";
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
      item: {
        id: "u1",
        attrs: { PK: "USER#1", SK: "PROFILE", name: "Ada Lovelace", email: "ada@x.io" },
      },
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
    const { ops } = parseDoc("o1: PK=U#1  SK=O#1\no1: PK=U#2  SK=O#1", BASE);
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

  it("@table names the base table (leading bareword)", () => {
    const { base } = parseDoc("@table AppTable pk=PK sk=SK\nu1: PK=A  SK=B", BASE);
    expect(base).toMatchObject({ name: "AppTable", pk: "PK", sk: "SK" });
  });

  it("@table without a name defaults to 'base'", () => {
    const { base } = parseDoc("@table pk=orgId sk=recordId", BASE);
    expect(base.name).toBe("base");
    expect(base.pk).toBe("orgId");
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

  it("parses a multi-key GSI from comma lists and round-trips it", () => {
    const { gsis } = parseDoc("@gsi M pk=tenant,region sk=status,date", BASE);
    expect(gsis[0]).toMatchObject({
      name: "M",
      pk: "tenant", // first, for compatibility
      pks: ["tenant", "region"],
      sk: "status",
      sks: ["status", "date"],
    });
    // round-trip through the serializer
    const reparsed = parseDoc(serializeGsis(gsis), BASE).gsis[0];
    expect(reparsed.pks).toEqual(["tenant", "region"]);
    expect(reparsed.sks).toEqual(["status", "date"]);
  });

  it("warns when a multi-key GSI exceeds 4 partition or 4 sort attributes", () => {
    const { diagnostics } = parseDoc("@gsi M pk=a,b,c,d,e sk=s", BASE);
    expect(diagnostics.some((d) => d.severity === "warning")).toBe(true);
  });

  it("warns on repeated pk=/sk= (the silent multi-key collapse) and keeps only the last", () => {
    const { gsis, diagnostics } = parseDoc("@gsi M pk=tenant pk=region sk=status,date", BASE);
    expect(gsis[0].pks).toBeUndefined(); // collapsed to a single key
    expect(gsis[0].pk).toBe("region"); // parseAttrs kept the last
    expect(diagnostics.some((d) => /comma list/.test(d.message))).toBe(true);
  });

  it("declares no GSI when none are in the doc (base-table-only model)", () => {
    const { gsis } = parseDoc("u1: PK=A  SK=B", BASE);
    expect(gsis).toEqual([]);
  });

  it("flags a malformed @gsi and ignores @ lines as ops", () => {
    const { gsis, diagnostics, ops } = parseDoc("@gsi\n@gsi Good pk=GPK\nu1: PK=A  SK=B", BASE);
    expect(ops).toHaveLength(1); // only the item line
    expect(gsis.map((g) => g.name)).toEqual(["Good"]);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("declares access patterns via @ap, auto-numbered, with optional index", () => {
    const { aps, diagnostics } = parseDoc(
      "@ap Get a user by id\n@ap Find user by email -> GSI1\nu1: PK=A  SK=B",
      BASE,
    );
    expect(diagnostics).toEqual([]);
    expect(aps).toEqual([
      {
        n: 1,
        description: "Get a user by id",
        index: undefined,
        readOp: "query",
        conds: undefined,
      },
      { n: 2, description: "Find user by email", index: "GSI1", readOp: "query", conds: undefined },
    ]);
  });

  it("parses @ap key conditions (equality + sort-key range) and round-trips them", () => {
    const { aps, diagnostics } = parseDoc(
      "@ap List a user's orders -> AppTable PK=USER#1 SK begins_with ORDER#\n" +
        "@ap Orders in a window -> GSI1 GSI1PK=STATUS#open GSI1SK between 2024-01 and 2024-06",
      BASE,
    );
    expect(diagnostics).toEqual([]);
    expect(aps[0].conds).toEqual([
      { attr: "PK", op: "=", value: "USER#1" },
      { attr: "SK", op: "begins_with", value: "ORDER#" },
    ]);
    expect(aps[1].conds).toEqual([
      { attr: "GSI1PK", op: "=", value: "STATUS#open" },
      { attr: "GSI1SK", op: "between", value: "2024-01", value2: "2024-06" },
    ]);
    // round-trip through the serializer preserves the conditions
    const text = serializeAps(aps);
    const reparsed = parseDoc(text, BASE).aps;
    expect(reparsed.map((a) => a.conds)).toEqual(aps.map((a) => a.conds));
  });

  it("attaches an adjacent comment as an op's narration; blank line silences it", () => {
    const { notes } = parseDoc(
      "# a silent header\n\n# create Ada\nu1: PK=A  SK=B\nu2: PK=A  SK=C\n// ships it\ndelete u1",
      BASE,
    );
    expect(notes[0]).toBe("create Ada"); // header cleared by the blank line
    expect(notes[1]).toBeUndefined(); // no comment above u2
    expect(notes[2]).toBe("ships it"); // // comment above the delete
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

describe("parseDoc — directives & diagnostics", () => {
  const errs = (t: string) => parseDoc(t, BASE).diagnostics.filter((d) => d.severity === "error");
  const warns = (t: string) =>
    parseDoc(t, BASE).diagnostics.filter((d) => d.severity === "warning");

  it("@table requires pk=", () => {
    expect(errs("@table AppTable sk=SK").some((d) => /pk=/.test(d.message))).toBe(true);
  });
  it("@gsi requires a name and pk=", () => {
    expect(errs("@gsi").length).toBeGreaterThan(0);
    expect(errs("@gsi GSI1").length).toBeGreaterThan(0);
  });
  it("a PK-only table (@table pk= only) folds items keyed by PK alone", () => {
    const { base, ops } = parseDoc("@table Events pk=PK\ne1: PK=EVENT#1  name=x", BASE);
    expect(base.sk).toBeUndefined();
    expect(fold(ops, base).size).toBe(1);
  });
  it("parses projection modes: keys → KEYS_ONLY, comma-list → array", () => {
    const { gsis } = parseDoc("@gsi G1 pk=A projection=keys\n@gsi G2 pk=B projection=x,y", BASE);
    expect(gsis[0].projection).toBe("KEYS_ONLY");
    expect(gsis[1].projection).toEqual(["x", "y"]);
  });
  it("warns on an unknown directive", () => {
    expect(warns("@wat foo").length).toBeGreaterThan(0);
  });
  it("@ap requires a description", () => {
    expect(errs("@ap  -> GSI1").length).toBeGreaterThan(0);
  });
  it("warns when an item is missing its key", () => {
    expect(warns("x1: name=nope").some((d) => /key/.test(d.message))).toBe(true);
  });
});

describe("parseDoc — conditional writes (@if)", () => {
  it("parses a trailing @if guard onto a put", () => {
    const { ops, diagnostics } = parseDoc(
      "u1: PK=U#1  SK=P  name=Ada  @if attribute_not_exists(PK)",
      BASE,
    );
    expect(diagnostics).toEqual([]);
    expect(ops[0]).toMatchObject({
      kind: "put",
      item: { attrs: { PK: "U#1", SK: "P", name: "Ada" } },
      condition: { text: "attribute_not_exists(PK)" },
    });
    // the condition text must NOT leak into the item's attrs
    expect((ops[0] as { item: { attrs: Record<string, string> } }).item.attrs).not.toHaveProperty(
      "attribute_not_exists(PK)",
    );
  });

  it("puts the @if guard on the put action of a key-change transact", () => {
    const { ops } = parseDoc(
      "t1: PK=U#1  SK=T#open\nt1: PK=U#2  SK=T#open  @if status=pending",
      BASE,
    );
    expect(ops[1]).toMatchObject({
      kind: "transact",
      actions: [{ kind: "delete" }, { kind: "put", condition: { text: "status=pending" } }],
    });
  });

  it("parses an @if guard on a delete", () => {
    const { ops } = parseDoc("delete o1  @if status=shipped", BASE);
    expect(ops[0]).toMatchObject({
      kind: "delete",
      id: "o1",
      condition: { text: "status=shipped" },
    });
  });

  it("flags a malformed condition as an error", () => {
    const { diagnostics } = parseDoc("u1: PK=U#1  SK=P  @if status =", BASE);
    expect(diagnostics.some((d) => d.severity === "error" && /@if/.test(d.message))).toBe(true);
  });

  it("round-trips the guard through serializeOps", () => {
    const src = "u1: PK=U#1  SK=P  name=Ada  @if attribute_not_exists(PK)";
    const { ops, base } = parseDoc(src, BASE);
    const text = serializeOps(ops, base);
    expect(text).toContain("@if attribute_not_exists(PK)");
    // and re-parsing the serialized text yields the same guard
    const again = parseDoc(text, BASE);
    expect(again.ops[0]).toMatchObject({ condition: { text: "attribute_not_exists(PK)" } });
  });
});
