// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { completeDsl } from "./editorCompletions";

// Drive the completion source the way CodeMirror does: a real EditorState with
// the cursor at `pos`, wrapped in a CompletionContext. No DOM/view needed —
// completeDsl reads only state + context.
function complete(doc: string, pos: number = doc.length, explicit = true) {
  const state = EditorState.create({ doc });
  return completeDsl(new CompletionContext(state, pos, explicit));
}

const labels = (r: ReturnType<typeof complete>) => (r?.options ?? []).map((o) => o.label);

describe("completeDsl", () => {
  it("offers @ directive templates when typing a directive", () => {
    const res = complete("@g");
    expect(labels(res)).toEqual(
      expect.arrayContaining(["@gsi", "@gsi multi-key", "@table", "@ap"]),
    );
    // `from` points at the `@`, so the directive replaces what was typed
    expect(res?.from).toBe(0);
  });

  it("offers line-start options on an empty line", () => {
    const res = complete("");
    expect(labels(res)).toEqual(expect.arrayContaining(["item", "delete", "@gsi", "@table"]));
  });

  it("stays quiet inside a value (segment already has an =)", () => {
    // typing the value of PK — offering attributes here would garble it
    expect(complete("u1: PK=US")).toBeNull();
  });

  it("stays quiet on an empty word (after a space) without an explicit trigger", () => {
    // cursor sits after a space mid-line: no prefix to complete, and the menu
    // wasn't explicitly asked for, so don't pop up unprompted
    expect(complete("abc ", 4, false)).toBeNull();
    // ...but an explicit trigger (Ctrl-Space) in the same spot does offer options
    expect(complete("abc ", 4, true)).not.toBeNull();
  });

  it("offers mid-item completions after a label: GSI keys, _type, and attrs", () => {
    const doc = `@gsi GSI1 pk=GSI1PK sk=GSI1SK
u1: PK=USER#1  SK=PROFILE  name=Ada
u2: `;
    const res = complete(doc);
    const ls = labels(res);
    expect(ls).toContain("GSI1"); // the whole GSI's keys
    expect(ls).toContain("_type"); // tag a new entity type
    expect(ls).toContain("name"); // an attribute already seen
    // declared GSI key attrs are offered even though no item used them yet
    expect(ls).toContain("GSI1PK");
  });

  it("offers the defined entity types right after _type=", () => {
    const doc = `u1: PK=U1  SK=P  _type=order
u2: PK=U2  SK=P  _type=`;
    const res = complete(doc);
    expect(labels(res)).toContain("order");
    // it replaces the (empty) partial type, anchoring at the caret
    expect(res?.from).toBe(doc.length);
  });

  it("scaffolds known entity types at line start", () => {
    const doc = `u1: PK=U1  SK=P  _type=order
`;
    // cursor on the fresh empty second line
    const res = complete(doc);
    expect(labels(res)).toContain("order"); // entityScaffold for the order type
    expect(labels(res)).toContain("item");
  });
});
