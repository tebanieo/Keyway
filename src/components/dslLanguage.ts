import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import type { StringStream } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Syntax colouring for the model script. A line-oriented stream tokenizer is
// enough: every construct starts at a line start (`#`, `@directive`, `delete`,
// `label:`), and the rest of a line is `name=value` pairs, `-> Index`, and the
// JSON of `names={…}` / `values={…}`.

interface LineState {
  /** Inside a `name=value` value (until the next ` name=`). */
  inValue: boolean;
}

export function token(stream: StringStream, state: LineState): string | null {
  if (stream.sol()) state.inValue = false;
  if (stream.sol()) {
    if (stream.match(/^\s*#.*/)) return "comment";
    if (stream.match(/^@[\w-]+/)) return "keyword";
    if (stream.match(/^delete\b/)) return "keyword";
    if (stream.match(/^[^\s:=@#][^\s:=]*:(?=\s|$)/)) return "labelName";
  }
  if (stream.eatSpace()) {
    // A value runs until the next ` name=` (values may hold spaces).
    if (stream.match(/^[\w.-]+=/, false) || stream.match("->", false)) state.inValue = false;
    return null;
  }
  if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
  if (stream.match("->")) return "operator";
  if (stream.match(/^:[\w]+/)) return "variableName";
  if (!state.inValue && stream.match(/^#[\w]+/)) return "variableName";
  if (!state.inValue && stream.match(/^[\w.-]+(?==)/)) return "propertyName";
  if (stream.eat("=")) {
    state.inValue = true;
    return "operator";
  }
  if (stream.match(/^(?:<>|<=|>=|[<>{}[\],])/)) return "punctuation";
  if (state.inValue) {
    if (stream.match(/^-?\d+(?:\.\d+)?(?=\s|$)/)) return "number";
    if (!stream.match(/^[^\s"{}]+/)) stream.next();
    return "string";
  }
  if (stream.match(/^(?:AND|OR|NOT|BETWEEN|begins_with|attribute_\w+|contains|size)\b/))
    return "keyword";
  stream.next();
  return null;
}

export const dslLanguage = StreamLanguage.define<LineState>({
  name: "keyway",
  startState: () => ({ inValue: false }),
  copyState: (s) => ({ ...s }),
  token,
  languageData: { commentTokens: { line: "#" } },
});

// Colours from the app's tokens, so both themes follow.
const style = HighlightStyle.define([
  { tag: t.comment, color: "var(--muted)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--accent)", fontWeight: "600" },
  { tag: t.labelName, color: "var(--text)", fontWeight: "600" },
  { tag: t.propertyName, color: "var(--key)" },
  { tag: t.string, color: "var(--enter)" },
  { tag: t.number, color: "var(--enter)" },
  { tag: t.variableName, color: "var(--warn)" },
  { tag: [t.operator, t.punctuation], color: "var(--muted)" },
]);

export const dslHighlighting = [dslLanguage, syntaxHighlighting(style)];
