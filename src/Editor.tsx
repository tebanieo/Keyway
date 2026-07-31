import { useEffect, useRef } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import type { Command } from "@codemirror/view";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { basicSetup } from "codemirror";
import {
  acceptCompletion,
  autocompletion,
  completionKeymap,
  nextSnippetField,
  prevSnippetField,
  snippet,
  snippetCompletion,
} from "@codemirror/autocomplete";
import type { CompletionContext } from "@codemirror/autocomplete";
import { forceLinting, linter, lintGutter } from "@codemirror/lint";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { fold } from "./engine/engine";
import { parseDoc } from "./model/dsl";
import { BASE_INDEX } from "./model/seed";
import { allAttrNames, deriveEntities, TYPE_ATTR } from "./model/entities";
import type { EntityTemplate } from "./model/entities";

// Two-space separator built via char code so no literal space sits in a string.
const SP2 = String.fromCharCode(32, 32);
const ph = (name: string) => "${" + name + "}"; // a snippet tabstop

// Static completions. `item` scaffolds a whole row; `gsi` is ADDITIVE (just the
// GSI1 keys, appended to the item you're writing); `delete` removes one.
const ITEM_SNIPPET = snippetCompletion(
  `${ph("label")}: PK=${ph("PK")}${SP2}SK=${ph("SK")}${SP2}${ph("attr")}=${ph("value")}`,
  { label: "item", detail: "new base item (whole row)", type: "keyword" },
);
const GSI_SNIPPET = snippetCompletion(
  `GSI1PK=${ph("GSI1PK")}${SP2}GSI1SK=${ph("GSI1SK")}`,
  { label: "gsi", detail: "add GSI1 keys to this item", type: "property" },
);
const DELETE_SNIPPET = snippetCompletion(`delete ${ph("label")}`, {
  label: "delete",
  detail: "delete an item",
  type: "keyword",
});

const LEAD = [BASE_INDEX.pk, BASE_INDEX.sk].filter((k): k is string => Boolean(k));

/** Parse the live doc into entity templates + known attribute names. */
function liveModel(doc: string) {
  const items = [...fold(parseDoc(doc, BASE_INDEX).ops, BASE_INDEX).values()];
  return { entities: deriveEntities(items, LEAD), attrs: allAttrNames(items) };
}

/** A whole-row scaffold prefilled with an entity's attributes, tagged _type. */
function entityScaffold(e: EntityTemplate) {
  const body = e.attrs.map((a) => `${a}=${ph(a)}`).join(SP2);
  const template = `${ph("label")}: ${body}${SP2}${TYPE_ATTR}=${e.type}`;
  return snippetCompletion(template, {
    label: e.type,
    detail: `scaffold ${e.type} (${e.count}×)`,
    type: "class",
  });
}

/**
 * Tab as a form-field jump, scoped to the current line. Two leading spaces are
 * built via char code so no literal space sits inside a string source.
 */
const addAttr = snippet(String.fromCharCode(32, 32) + "${attr}=${value}");

/** Select the value that starts just after the `=` at absolute offset `eq`. */
function selectValue(view: EditorView, eq: number): void {
  const line = view.state.doc.lineAt(eq);
  const valStart = eq + 1;
  const rest = line.text.slice(valStart - line.from);
  const boundary = /\s+\w+=|$/.exec(rest);
  const valEnd = valStart + (boundary ? boundary.index : rest.length);
  view.dispatch({
    selection: EditorSelection.range(valStart, valEnd),
    scrollIntoView: true,
  });
}

// Tab: move to the next `attr=` value on this line; at the end of an item line,
// append a fresh `attr=value` slot (so you keep adding attributes and never get
// ejected). Returns false only on a non-item line, letting Tab exit normally.
const tabForward: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const eqRel = line.text.indexOf("=", sel.head - line.from);
  if (eqRel !== -1) {
    selectValue(view, line.from + eqRel);
    return true;
  }
  if (line.text.includes("=")) {
    addAttr(view, null, line.to, line.to); // new attribute tabstop
    return true;
  }
  return false;
};

// Shift-Tab: back to the previous `attr=` value on this line.
const tabBackward: Command = (view) => {
  const { state } = view;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.from);
  const eqRel = line.text.lastIndexOf("=", Math.max(0, sel.from - line.from - 2));
  if (eqRel !== -1) {
    selectValue(view, line.from + eqRel);
    return true;
  }
  return false;
};

// Tab: accept a completion, else advance a snippet field, else the field jump.
// Shift-Tab goes back. Escape is the explicit way out of the editor.
const authoringKeys = Prec.highest(
  keymap.of([
    {
      key: "Tab",
      run: (v) => acceptCompletion(v) || nextSnippetField(v) || tabForward(v),
      shift: (v) => prevSnippetField(v) || tabBackward(v),
    },
    {
      key: "Escape",
      run: (v) => {
        v.contentDOM.blur();
        return true;
      },
    },
  ]),
);

function completeDsl(ctx: CompletionContext) {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = ctx.state.sliceDoc(line.from, ctx.pos);

  // After `_type=` → offer the entity types already defined in the model.
  const typeVal = /_type=([\w-]*)$/.exec(before);
  if (typeVal) {
    const { entities } = liveModel(ctx.state.doc.toString());
    return {
      from: ctx.pos - typeVal[1].length,
      options: entities.map((e) => ({
        label: e.type,
        detail: `${e.count}×`,
        type: "constant",
      })),
    };
  }

  const word = ctx.matchBefore(/[\w-]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;

  const { entities, attrs } = liveModel(ctx.state.doc.toString());
  const started = /^\s*[\w-]+\s*:/.test(before); // line already has `label:`

  const options = started
    ? // mid-item: add GSI keys or a known attribute
      [
        GSI_SNIPPET,
        ...attrs.map((a) =>
          snippetCompletion(`${a}=${ph("value")}`, {
            label: a,
            detail: "attribute",
            type: "property",
          }),
        ),
      ]
    : // line start: scaffold a fresh item — blank, or from an entity template
      [ITEM_SNIPPET, DELETE_SNIPPET, ...entities.map(entityScaffold)];

  return { from: word.from, options };
}

// Run the same pure parser the app uses, surface its diagnostics inline — but
// never nag the line the cursor is on, so a half-typed `o5: PK=` stays quiet
// until you move off it.
const dslLinter = linter((view): CmDiagnostic[] => {
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const { diagnostics } = parseDoc(view.state.doc.toString(), BASE_INDEX);
  return diagnostics
    .filter((d) => d.line + 1 !== activeLine)
    .map((d) => {
      const l = view.state.doc.line(d.line + 1);
      return { from: l.from, to: l.to, severity: d.severity, message: d.message };
    });
});

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "#12151c", color: "#e6e9ef", fontSize: "13px" },
    ".cm-content": {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      caretColor: "#5b9dff",
    },
    ".cm-gutters": { backgroundColor: "#12151c", color: "#5b6172", border: "none" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.03)" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "rgba(91,157,255,0.25)" },
  },
  { dark: true },
);

export function Editor({
  initialDoc,
  onChange,
}: {
  initialDoc: string;
  onChange: (text: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Keep the latest onChange without re-creating the editor.
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    let lastLine = 0; // re-lint when the cursor changes lines
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          authoringKeys, // Tab/Shift-Tab/Escape — must win over defaults
          basicSetup,
          keymap.of(completionKeymap),
          autocompletion({ override: [completeDsl] }),
          dslLinter,
          lintGutter(),
          placeholder("item<Tab> to scaffold a row…"),
          theme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current(u.state.doc.toString());
            const line = u.state.doc.lineAt(u.state.selection.main.head).number;
            if (line !== lastLine) {
              lastLine = line;
              forceLinting(u.view); // refresh so the line you just left re-lints
            }
          }),
        ],
      }),
    });
    return () => view.destroy();
    // Mount once; the doc is uncontrolled from here (editor owns its text).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="editor" ref={host} />;
}
