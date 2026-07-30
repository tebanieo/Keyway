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
  snippetCompletion,
} from "@codemirror/autocomplete";
import type { CompletionContext } from "@codemirror/autocomplete";
import { forceLinting, linter, lintGutter } from "@codemirror/lint";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { parseDoc } from "./model/dsl";
import { BASE_INDEX } from "./model/seed";

// Snippets with tabstops: pick one, then Tab through the fields (label -> PK ->
// SK -> attr -> value -> ...). ${} placeholders become Tab stops.
const SNIPPETS = [
  snippetCompletion("${label}: PK=${PK}  SK=${SK}  ${attr}=${value}", {
    label: "item",
    detail: "new base item",
    type: "keyword",
  }),
  snippetCompletion(
    "${label}: PK=${PK}  SK=${SK}  GSI1PK=${GSI1PK}  GSI1SK=${GSI1SK}",
    { label: "gsi", detail: "item indexed on GSI1", type: "keyword" },
  ),
  snippetCompletion("delete ${label}", {
    label: "delete",
    detail: "delete an item",
    type: "keyword",
  }),
];

/**
 * Tab as a form-field jump: select the next `attr=` value on the line (or the
 * next line's). This is what "Tab = next attribute" means for authoring — it
 * neither inserts a space nor lets focus escape to the page.
 */
function jumpField(dir: 1 | -1): Command {
  return (view) => {
    const { state } = view;
    const text = state.doc.toString();
    const sel = state.selection.main;
    const eq =
      dir > 0
        ? text.indexOf("=", sel.head)
        : text.lastIndexOf("=", Math.max(0, sel.from - 2));
    if (eq === -1) return false; // nothing ahead/behind — allow default (exit)
    const valStart = eq + 1;
    const rest = text.slice(valStart);
    const boundary = /\s+\w+=|\n|$/.exec(rest);
    const valEnd = valStart + (boundary ? boundary.index : rest.length);
    view.dispatch({
      selection: EditorSelection.range(valStart, valEnd),
      scrollIntoView: true,
    });
    return true;
  };
}

// Tab: accept a completion, else advance a snippet field, else jump to the next
// attribute. Shift-Tab goes back. Escape is the explicit way out of the editor.
const authoringKeys = Prec.highest(
  keymap.of([
    {
      key: "Tab",
      run: (v) => acceptCompletion(v) || nextSnippetField(v) || jumpField(1)(v),
      shift: (v) => prevSnippetField(v) || jumpField(-1)(v),
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
  const word = ctx.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return { from: word.from, options: SNIPPETS };
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
