import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Decoration, EditorView, keymap, placeholder } from "@codemirror/view";
import type { Command, DecorationSet } from "@codemirror/view";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { basicSetup } from "codemirror";
import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeCompletion,
  completionKeymap,
  CompletionContext,
  completionStatus,
  hasNextSnippetField,
  hasPrevSnippetField,
  nextSnippetField,
  prevSnippetField,
  selectedCompletion,
  setSelectedCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { forceLinting, linter, lintGutter, openLintPanel } from "@codemirror/lint";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { parseDoc } from "../model/dsl";
import { apLineNotes } from "../model/coverage";
import { BASE_INDEX } from "../model/seed";
import { completeDsl } from "./editorCompletions";
import { dslHighlighting } from "./dslLanguage";

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
  // At the end of an ITEM line, open room for the next key=value. Not on a
  // directive (`@gsi … sk=X` would get two stray spaces and the line-start menu).
  if (/^\s*[A-Za-z0-9_]+\s*:/.test(line.text) && line.text.includes("=")) {
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

// Tab with the menu open: accept the highlighted option, or the top one once
// you've typed a prefix (`item`<Tab>). The menu never preselects, so Enter
// stays a newline unless you deliberately arrowed into the menu.
const acceptTop: Command = (view) => {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const typed = /[\w@-]+$/.exec(view.state.sliceDoc(line.from, head))?.[0] ?? "";
  if (completionStatus(view.state) === "active") {
    if (!selectedCompletion(view.state)) {
      if (!typed) return false; // nothing typed: don't guess
      view.dispatch({ effects: setSelectedCompletion(0) });
    }
    if (acceptCompletion(view)) return true;
    // CodeMirror refuses to accept for ~75 ms after the menu updates (a
    // misclick guard), which a fast typist hits: complete directly instead.
    if (!typed) return false;
    closeCompletion(view);
    return completeNow(view, typed);
  }
  // Typed faster than the menu opens (`item` then Tab within ~100 ms): ask the
  // same completion source now, and apply its top match for what was typed.
  return typed ? completeNow(view, typed) : false;
};

/** Apply the best completion for `typed` at the caret, without the menu. */
function completeNow(view: EditorView, typed: string): boolean {
  const pos = view.state.selection.main.head;
  const result = completeDsl(new CompletionContext(view.state, pos, true));
  if (!result || result.from !== pos - typed.length) return false;
  const best = result.options
    .filter((o) => o.label.startsWith(typed))
    .sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0))[0];
  if (!best) return false;
  if (typeof best.apply === "function") best.apply(view, best, result.from, pos);
  else {
    const text = best.apply ?? best.label;
    view.dispatch({
      changes: { from: result.from, to: pos, insert: text },
      selection: EditorSelection.cursor(result.from + text.length),
    });
  }
  return true;
}

// Tab never leaves the editor (a keyboard user leaves with Escape, then Tab):
// advance a snippet field, else accept a completion, else jump to the next
// value; on a blank line it opens the suggestions; anywhere else it's a no-op.
const tabElsewhere: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  if (line.text.trim() === "") startCompletion(view);
  return true;
};

// Escape walks back one step at a time: close the menu, then end the snippet,
// then "arm" the editor so the very next Tab / Shift-Tab moves focus out
// (forward to the tables, or back to the toolbar): CodeMirror's Esc-then-Tab
// convention. Any other key disarms it.
const exitArmed = new WeakSet<EditorView>();
const arm = (view: EditorView, on: boolean) => {
  if (on) exitArmed.add(view);
  else exitArmed.delete(view);
  view.dom.classList.toggle("exit-armed", on);
};
const escapeChain: Command = (view) => {
  if (completionStatus(view.state) === "active") return closeCompletion(view);
  if (hasNextSnippetField(view.state) || hasPrevSnippetField(view.state)) {
    return clearSnippet(view);
  }
  arm(view, true);
  return true;
};
const disarmOnOtherKeys = EditorView.domEventHandlers({
  keydown: (e, view) => {
    if (e.key !== "Tab" && e.key !== "Escape" && e.key !== "Shift") arm(view, false);
    return false;
  },
  blur: (_e, view) => {
    arm(view, false);
    return false;
  },
});

const authoringKeys = Prec.highest(
  keymap.of([
    {
      key: "Tab",
      // Armed by Escape: report "not handled", so the browser's Tab moves focus
      // out. Otherwise: inside a snippet, advance its field first (so the open
      // menu can't hijack Tab); then accept a completion; then jump to the
      // next value; never leave the editor.
      run: (v) => {
        if (exitArmed.has(v)) {
          arm(v, false);
          return false;
        }
        return (
          (hasNextSnippetField(v.state) && nextSnippetField(v)) ||
          acceptTop(v) ||
          tabForward(v) ||
          tabElsewhere(v)
        );
      },
      shift: (v) => {
        if (exitArmed.has(v)) {
          arm(v, false);
          return false;
        }
        return (hasPrevSnippetField(v.state) && prevSnippetField(v)) || tabBackward(v) || true;
      },
    },
    { key: "Escape", run: escapeChain },
  ]),
);

// Which line the caret is on, and whether it has been edited since the caret
// arrived: a half-typed `o5: PK=` stays quiet, but a problem you jumped to
// (F8, or the problems list) still shows.
const editing = new WeakMap<EditorView, { line: number; edited: boolean }>();

// Run the same pure parser the app uses and surface its diagnostics inline,
// except on the line you're in the middle of typing.
const dslLinter = linter((view): CmDiagnostic[] => {
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const typing = editing.get(view);
  const quiet = typing && typing.line === activeLine && typing.edited ? activeLine : -1;
  const parsed = parseDoc(view.state.doc.toString(), BASE_INDEX);
  // Problems, plus each access pattern's coverage on its own @ap line (served
  // or why not), so you see it without opening the Access patterns panel.
  return [...parsed.diagnostics, ...apLineNotes(parsed)]
    .filter((d) => d.line + 1 !== quiet)
    .map((d): CmDiagnostic => {
      const l = view.state.doc.line(d.line + 1);
      const fix = "fix" in d ? d.fix : undefined;
      return {
        from: l.from,
        to: l.to,
        severity: d.severity,
        message: d.message,
        // a one-click fix (e.g. add the suggested @key line)
        actions: fix
          ? [
              {
                name: fix.label,
                apply: (v) => {
                  const at = Math.min(fix.line, v.state.doc.lines);
                  const pos =
                    fix.line >= v.state.doc.lines
                      ? v.state.doc.length
                      : v.state.doc.line(at + 1).from;
                  const insert = fix.line >= v.state.doc.lines ? `\n${fix.text}` : `${fix.text}\n`;
                  v.dispatch({ changes: { from: pos, insert } });
                },
              },
            ]
          : undefined,
      };
    });
});

// The `dark` flag picks CodeMirror's built-in colours for its own widgets (the
// suggestion popup, search panel), so it follows the page's theme.
const isDark = () => document.documentElement.getAttribute("data-theme") !== "paper";
const themeFor = (dark: boolean) =>
  EditorView.theme(
    {
      "&": { backgroundColor: "var(--editor-bg)", color: "var(--editor-fg)", fontSize: "13px" },
      ".cm-content": {
        fontFamily: "var(--font-mono)",
        // characters as typed: no ligatures turning `#{` or `->` into glyphs
        fontVariantLigatures: "none",
        caretColor: "var(--accent)",
      },
      ".cm-gutters": {
        fontFamily: "var(--font-mono)",
        backgroundColor: "var(--editor-bg)",
        color: "var(--editor-gutter)",
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: "var(--fill-1)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--fill-1)" },
      ".cm-step-line": { backgroundColor: "var(--editor-step)" },
      // A served access pattern: a green check in the gutter, no underline
      // (it's good news, not a problem to fix).
      ".cm-lint-marker-info": {
        content: "none",
        backgroundImage: "none",
        display: "inline-grid",
        placeItems: "center",
      },
      ".cm-lint-marker-info::before": {
        content: '"✓"',
        color: "var(--enter)",
        fontWeight: "700",
        fontSize: "12px",
        lineHeight: "1",
      },
      ".cm-lintRange-info": { backgroundImage: "none" },
      "&.cm-focused": { outline: "none" },
      ".cm-selectionBackground, ::selection": { backgroundColor: "var(--editor-sel)" },
    },
    { dark },
  );

const themeSlot = new Compartment();

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
  /** Open the problems list (the same as Ctrl+Shift+M in the editor). */
  openProblems: () => void;
  /** Put the keyboard in the script, caret where it was. */
  focus: () => void;
  /** Insert lines before 0-based `line` (at the end when past it), then put
   *  the caret on the last inserted line and focus the script. */
  insertLines: (line: number, text: string) => void;
  /** Replace one 0-based line's text (an edit made in the tables). */
  replaceLine: (line: number, text: string) => void;
  /** Scroll a 0-based line into view and put the caret there (no focus). */
  revealLine: (line: number) => void;
}

export const Editor = forwardRef<
  EditorHandle,
  {
    initialDoc: string;
    onChange: (text: string) => void;
    activeLine?: number | null;
    /** Focus on mount with the caret at the end, ready to type. */
    autoFocus?: boolean;
    /** The 0-based line the caret moved to while typing; null when it leaves. */
    onCaretLine?: (line: number | null) => void;
    /** Ctrl/Cmd+Enter on a 0-based line; true if it ran something there. */
    onRunLine?: (line: number) => boolean;
  }
>(function Editor({ initialDoc, onChange, activeLine, autoFocus, onCaretLine, onRunLine }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Keep the latest onChange without re-creating the editor.
  const cb = useRef(onChange);
  cb.current = onChange;
  const caret = useRef(onCaretLine);
  caret.current = onCaretLine;
  const runLine = useRef(onRunLine);
  runLine.current = onRunLine;

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
      openProblems: () => {
        const view = viewRef.current;
        if (view) openLintPanel(view);
      },
      focus: () => viewRef.current?.focus(),
      insertLines: (line: number, text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { doc } = view.state;
        const atEnd = line >= doc.lines;
        const from = atEnd ? doc.length : doc.line(line + 1).from;
        const insert = atEnd
          ? (doc.length && doc.sliceString(doc.length - 1) !== "\n" ? "\n" : "") + text
          : `${text}\n`;
        const caret = atEnd ? from + insert.length : from + insert.length - 1;
        view.dispatch({
          changes: { from, insert },
          selection: EditorSelection.cursor(caret),
          effects: EditorView.scrollIntoView(caret, { y: "center" }),
        });
        view.focus();
      },
      replaceLine: (line: number, text: string) => {
        const view = viewRef.current;
        if (!view || !Number.isInteger(line) || line < 0 || line >= view.state.doc.lines) return;
        const l = view.state.doc.line(line + 1);
        view.dispatch({ changes: { from: l.from, to: l.to, insert: text } });
      },
      revealLine: (line: number) => {
        const view = viewRef.current;
        // Not a line of this doc (e.g. pinned from Canvas before the script
        // knows the item's line): nothing to reveal.
        if (!view || !Number.isInteger(line) || line < 0 || line >= view.state.doc.lines) return;
        const at = view.state.doc.line(line + 1).from;
        view.dispatch({
          selection: EditorSelection.cursor(at),
          effects: EditorView.scrollIntoView(at, { y: "center" }),
        });
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
          disarmOnOtherKeys,
          keymap.of([
            {
              key: "Mod-Enter",
              run: (v) => {
                const line = v.state.doc.lineAt(v.state.selection.main.head).number - 1;
                return runLine.current?.(line) ?? false;
              },
            },
          ]),
          basicSetup,
          dslHighlighting,
          keymap.of(completionKeymap),
          // Never preselect: an auto-opened menu must not turn Enter (a newline,
          // e.g. a blank line between groups) into "insert the first option".
          autocompletion({ override: [completeDsl], selectOnOpen: false }),
          dslLinter,
          lintGutter(),
          placeholder("item<Tab> to scaffold a row…"),
          themeSlot.of(themeFor(isDark())),
          stepLineField,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Model script",
            "aria-describedby": "editor-keys-help",
          }),
          EditorView.domEventHandlers({
            focus: (_e, v) => {
              lastLine = v.state.doc.lineAt(v.state.selection.main.head).number;
              caret.current?.(lastLine - 1);
            },
            blur: () => caret.current?.(null),
          }),
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
            const typing = editing.get(u.view);
            if (!typing || typing.line !== line)
              editing.set(u.view, { line, edited: u.docChanged });
            else if (u.docChanged) typing.edited = true;
            if (line !== lastLine) {
              lastLine = line;
              forceLinting(u.view); // refresh so the line you just left re-lints
              if (u.view.hasFocus) caret.current?.(line - 1);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    // Re-measure when the pane's size changes (expanding from the collapsed
    // strip, the splitter, the window): line heights depend on the width, and
    // stale ones leave the line numbers out of step with their lines.
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => view.requestMeasure());
    resize?.observe(host.current);
    if (autoFocus) {
      // Ready to type: caret at the end of the model. preventScroll, so landing
      // in the editor never scrolls the page.
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      view.contentDOM.focus({ preventScroll: true });
    }
    // Follow theme switches (the system setting, or the toggle).
    const observer = new MutationObserver(() =>
      view.dispatch({ effects: themeSlot.reconfigure(themeFor(isDark())) }),
    );
    observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    return () => {
      resize?.disconnect();
      observer.disconnect();
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

  return (
    <>
      <div className="editor" ref={host} />
      <span id="editor-keys-help" className="sr-only">
        Tab accepts a suggestion or moves to the next value. To leave the script, press Escape, then
        Tab. Control Enter on an access pattern line runs it.
      </span>
    </>
  );
});
