// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { Editor } from "./Editor";
import type { EditorHandle } from "./Editor";

// Drives the imperative handle App uses for backfill/append. This mounts a real
// CodeMirror view in jsdom (doc edits don't need layout), then asserts the text
// that flows back through onChange.
function mount(initialDoc: string) {
  const onChange = vi.fn();
  const ref = createRef<EditorHandle>();
  render(<Editor ref={ref} initialDoc={initialDoc} onChange={onChange} />);
  const lastText = () => onChange.mock.calls.at(-1)?.[0] as string | undefined;
  return { ref, onChange, lastText };
}

describe("Editor imperative handle", () => {
  it("patchItems appends to the last line defining each label, in place", () => {
    const { ref, lastText } = mount("o1: PK=O#1  SK=ORDER\no2: PK=O#2  SK=ORDER");
    act(() => ref.current!.patchItems([{ label: "o2", append: "discount=0" }]));
    const text = lastText()!;
    expect(text).toContain("o2: PK=O#2  SK=ORDER  discount=0");
    expect(text).toContain("o1: PK=O#1  SK=ORDER"); // the other row is untouched
  });

  it("patchItems targets the LAST line for a repeated label", () => {
    const { ref, lastText } = mount("o1: PK=O#1  SK=ORDER\no1: PK=O#1  SK=SHIPPED");
    act(() => ref.current!.patchItems([{ label: "o1", append: "flag=1" }]));
    const text = lastText()!;
    // only the last o1 line gets the append
    expect(text).toContain("o1: PK=O#1  SK=SHIPPED  flag=1");
    expect(text).toMatch(/o1: PK=O#1 {2}SK=ORDER\n/);
  });

  it("appendLines adds a new line at the end", () => {
    const { ref, lastText } = mount("o1: PK=O#1  SK=ORDER");
    act(() => ref.current!.appendLines("o2: PK=O#2  SK=ORDER"));
    expect(lastText()!).toContain("o2: PK=O#2  SK=ORDER");
  });
});
