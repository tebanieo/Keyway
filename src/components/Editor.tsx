import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Decoration, EditorView, keymap, placeholder } from "@codemirror/view";
import type { Command, DecorationSet } from "@codemirror/view";
import { EditorSelection, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { basicSetup } from "codemirror";
import {
  acceptCompletion,
  autocompletion,
  completionKeymap,
  hasNextSnippetField,
  hasPrevSnippetField,
  nextSnippetField,
  prevSnippetField,
  startCompletion,
} from "@codemirror/autocomplete";
import { forceLinting, linter, lintGutter } from "@codemirror/lint";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { parseDoc } from "../model/dsl";
import { BASE_INDEX } from "../model/seed";
import { completeDsl } from "./editorCompletions";

const SEP2 = String.fromCharCode(32, 32); // two-space attribute separator

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
// add a separator and OPEN the completion menu (GSI keys / _type / attributes)
// so you pick what to add next: no conflicting slot. Returns false on a
// non-item line, letting Tab exit normally.
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
    view.dispatch({
      changes: { from: line.to, insert: SEP2 },
      selection: EditorSelection.cursor(line.to + SEP2.length),
    });
    startCompletion(view);
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
      // Inside a snippet with another field, advance the field first: so the
      // open autocomplete popup can't hijack Tab. Otherwise accept a completion
      // if the popup is open, else jump to the next attribute on the line.
      run: (v) =>
        (hasNextSnippetField(v.state) && nextSnippetField(v)) ||
        acceptCompletion(v) ||
        tabForward(v),
      shift: (v) => (hasPrevSnippetField(v.state) && prevSnippetField(v)) || tabBackward(v),
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

// Run the same pure parser the app uses, surface its diagnostics inline, but
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
    "&": { backgroundColor: "var(--editor-bg)", color: "var(--editor-fg)", fontSize: "13px" },
    ".cm-content": {
      fontFamily: "var(--font-mono)",
      caretColor: "var(--accent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--editor-bg)",
      color: "var(--editor-gutter)",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "var(--fill-1)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--fill-1)" },
    ".cm-step-line": { backgroundColor: "var(--editor-step)" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "var(--editor-sel)" },
  },
  { dark: true },
);

// A single "current step" line highlight, driven imperatively from the app so
// playback lights up the source line of the op that's running.
const setStepLine = StateEffect.define<number | null>();
const stepLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setStepLine)) {
        const n = e.value;
        deco =
          n != null && n >= 1 && n <= tr.state.doc.lines
            ? Decoration.set([
                Decoration.line({ class: "cm-step-line" }).range(tr.state.doc.line(n).from),
              ])
            : Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Imperative handle so the app can push text in (e.g. a backfill). */
export interface EditorHandle {
  appendLines: (text: string) => void;
  /** Append ` attr=value` to the last line defining each label, in place. */
  patchItems: (patches: { label: string; append: string }[]) => void;
}

export const Editor = forwardRef<
  EditorHandle,
  { initialDoc: string; onChange: (text: string) => void; activeLine?: number | null }
>(function Editor({ initialDoc, onChange, activeLine }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Keep the latest onChange without re-creating the editor.
  const cb = useRef(onChange);
  cb.current = onChange;

  useImperativeHandle(
    ref,
    () => ({
      appendLines: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const end = view.state.doc.length;
        const needsNL = end > 0 && view.state.doc.sliceString(end - 1) !== "\n";
        view.dispatch({ changes: { from: end, insert: (needsNL ? "\n" : "") + text } });
      },
      patchItems: (patches) => {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc;
        const sep = String.fromCharCode(32, 32);
        const changes: { from: number; insert: string }[] = [];
        for (const { label, append } of patches) {
          // the LAST line for this label determines the item's final state
          let target: { to: number } | null = null;
          for (let i = 1; i <= doc.lines; i++) {
            const line = doc.line(i);
            const m = /^\s*([\w-]+)\s*:/.exec(line.text);
            if (m && m[1] === label) target = line;
          }
          if (target) changes.push({ from: target.to, insert: sep + append });
        }
        if (changes.length) view.dispatch({ changes });
      },
    }),
    [],
  );

  useEffect(() => {
    if (!host.current) return;
    let lastLine = 0; // re-lint when the cursor changes lines
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          authoringKeys, // Tab/Shift-Tab/Escape: must win over defaults
          basicSetup,
          keymap.of(completionKeymap),
          autocompletion({ override: [completeDsl] }),
          dslLinter,
          lintGutter(),
          placeholder("item<Tab> to scaffold a row…"),
          theme,
          stepLineField,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              cb.current(u.state.doc.toString());
              // Landed on a fresh empty line (e.g. after Enter)? Pop the menu of
              // what you can do here. Deferred: can't dispatch inside an update.
              const cur = u.state.doc.lineAt(u.state.selection.main.head);
              if (cur.text.trim() === "") {
                const v = u.view;
                setTimeout(() => startCompletion(v), 0);
              }
            }
            const line = u.state.doc.lineAt(u.state.selection.main.head).number;
            if (line !== lastLine) {
              lastLine = line;
              forceLinting(u.view); // refresh so the line you just left re-lints
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; the doc is uncontrolled from here (editor owns its text).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight the source line of the current step. Scroll to follow it only when
  // the user is driving via the transport (editor unfocused), so typing never
  // jumps the view.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const n = activeLine ?? null;
    view.dispatch({ effects: setStepLine.of(n) });
    if (n != null && n >= 1 && n <= view.state.doc.lines && !view.hasFocus) {
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.doc.line(n).from, { y: "center" }),
      });
    }
  }, [activeLine]);

  return <div className="editor" ref={host} />;
});
