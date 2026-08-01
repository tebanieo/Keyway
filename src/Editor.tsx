import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import type { Command } from "@codemirror/view";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { basicSetup } from "codemirror";
import {
  acceptCompletion,
  autocompletion,
  completionKeymap,
  hasNextSnippetField,
  hasPrevSnippetField,
  nextSnippetField,
  prevSnippetField,
  snippetCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import type { CompletionContext } from "@codemirror/autocomplete";
import { forceLinting, linter, lintGutter } from "@codemirror/lint";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { fold, pkAttrs, skAttrs } from "./engine/engine";
import { parseDoc } from "./model/dsl";
import { BASE_INDEX } from "./model/seed";
import { allAttrNames, deriveEntities, TYPE_ATTR } from "./model/entities";
import type { EntityTemplate } from "./model/entities";
import type { IndexSpec } from "./engine/types";

// Two-space separator built via char code so no literal space sits in a string.
const SP2 = String.fromCharCode(32, 32);
const ph = (name: string) => "${" + name + "}"; // a snippet tabstop

// `item` scaffolds a whole row using the (possibly custom) base keys; `gsi` is
// ADDITIVE (a GSI's keys, appended to the item you're writing); `delete` removes.
function itemSnippet(base: IndexSpec) {
  const keys = [base.pk, base.sk]
    .filter((k): k is string => Boolean(k))
    .map((k) => `${k}=${ph(k)}`)
    .join(SP2);
  // Scaffold just the keys. Tab past the last one opens a menu to add GSI keys /
  // _type / attributes — so adding a whole key=value never collides with a slot.
  return snippetCompletion(`${ph("label")}: ${keys}`, {
    label: "item",
    detail: "new base item — Tab at the end to add keys/attrs",
    type: "keyword",
  });
}
/** Inserts one declared GSI's key attributes to add to the current item. */
function gsiKeysSnippet(g: IndexSpec) {
  const keys = [...pkAttrs(g), ...skAttrs(g)];
  return snippetCompletion(keys.map((a) => `${a}=${ph(a)}`).join(SP2), {
    label: g.name,
    detail: `${g.name} keys — ${keys.join(", ")}`,
    type: "property",
  });
}

const DELETE_SNIPPET = snippetCompletion(`delete ${ph("label")}`, {
  label: "delete",
  detail: "delete an item",
  type: "keyword",
});

// `@` directive completions — makes declaring indexes discoverable, including
// the multi-key comma-list form (the thing that isn't obvious).
const DIRECTIVES = [
  snippetCompletion(`@gsi ${ph("Name")} pk=${ph("pk")} sk=${ph("sk")}`, {
    label: "@gsi",
    detail: "declare a secondary index",
    type: "keyword",
  }),
  snippetCompletion(
    `@gsi ${ph("Name")} pk=${ph("pk1")},${ph("pk2")} sk=${ph("sk1")},${ph("sk2")}`,
    { label: "@gsi multi-key", detail: "up to 4 pk / 4 sk, comma-separated", type: "keyword" },
  ),
  snippetCompletion(`@table pk=${ph("pk")} sk=${ph("sk")}`, {
    label: "@table",
    detail: "custom base-table keys",
    type: "keyword",
  }),
];

/** Parse the live doc into base/index config + entity templates + attr names. */
function liveModel(doc: string) {
  const parsed = parseDoc(doc, BASE_INDEX);
  const base = parsed.base;
  const lead = [base.pk, base.sk].filter((k): k is string => Boolean(k));
  const items = [...fold(parsed.ops, base).values()];
  return {
    base,
    entities: deriveEntities(items, lead),
    attrs: allAttrNames(items),
    gsis: parsed.gsis,
  };
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
// so you pick what to add next — no conflicting slot. Returns false on a
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
      // Inside a snippet with another field, advance the field first — so the
      // open autocomplete popup can't hijack Tab. Otherwise accept a completion
      // if the popup is open, else jump to the next attribute on the line.
      run: (v) =>
        (hasNextSnippetField(v.state) && nextSnippetField(v)) ||
        acceptCompletion(v) ||
        tabForward(v),
      shift: (v) =>
        (hasPrevSnippetField(v.state) && prevSnippetField(v)) || tabBackward(v),
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

  // A directive line being typed (`@…`) → offer @gsi / @table templates.
  const dir = /^@([\w-]*)$/.exec(before);
  if (dir) {
    return { from: ctx.pos - dir[1].length - 1, options: DIRECTIVES };
  }

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

  const { base, entities, attrs, gsis } = liveModel(ctx.state.doc.toString());
  const started = /^\s*[\w-]+\s*:/.test(before); // line already has `label:`

  let options;
  if (started) {
    // mid-item: a whole GSI's keys, a _type tag, or any known attribute name
    // (incl. declared GSI keys even before any item uses them).
    const names = new Set(attrs);
    for (const g of gsis) {
      names.add(g.pk);
      if (g.sk) names.add(g.sk);
    }
    // _type completions: pick an existing entity type, or tag a brand-new one.
    const typeOpts = [
      ...entities.map((e) =>
        snippetCompletion(`${TYPE_ATTR}=${e.type}`, {
          label: `${TYPE_ATTR}=${e.type}`,
          detail: "entity type",
          type: "enum",
        }),
      ),
      snippetCompletion(`${TYPE_ATTR}=${ph("type")}`, {
        label: TYPE_ATTR,
        detail: "tag with a new entity type",
        type: "enum",
      }),
    ];
    options = [
      ...gsis.map(gsiKeysSnippet),
      ...typeOpts,
      ...[...names].map((a) =>
        snippetCompletion(`${a}=${ph("value")}`, {
          label: a,
          detail: "attribute",
          type: "property",
        }),
      ),
    ];
  } else {
    // line start: scaffold a fresh item — blank, or from an entity template
    options = [itemSnippet(base), DELETE_SNIPPET, ...entities.map(entityScaffold)];
  }

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

/** Imperative handle so the app can push text in (e.g. a backfill). */
export interface EditorHandle {
  appendLines: (text: string) => void;
  /** Append ` attr=value` to the last line defining each label, in place. */
  patchItems: (patches: { label: string; append: string }[]) => void;
}

export const Editor = forwardRef<
  EditorHandle,
  { initialDoc: string; onChange: (text: string) => void }
>(function Editor({ initialDoc, onChange }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Keep the latest onChange without re-creating the editor.
  const cb = useRef(onChange);
  cb.current = onChange;

  useImperativeHandle(ref, () => ({
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
  }), []);

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
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; the doc is uncontrolled from here (editor owns its text).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="editor" ref={host} />;
});
