import { snippetCompletion } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { fold, pkAttrs, skAttrs } from "../engine/engine";
import { parseDoc } from "../model/dsl";
import { BASE_INDEX } from "../model/seed";
import { allAttrNames, deriveEntities, TYPE_ATTR } from "../model/entities";
import type { EntityTemplate } from "../model/entities";
import type { IndexSpec } from "../engine/types";

// The editor's completion engine, kept separate from the CodeMirror wiring in
// Editor.tsx so it can be unit-tested against a plain EditorState + a
// CompletionContext, no DOM/view required. Editor.tsx feeds `completeDsl` to
// `autocompletion({ override })`.

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
  // _type / attributes: so adding a whole key=value never collides with a slot.
  return snippetCompletion(`${ph("label")}: ${keys}`, {
    label: "item",
    detail: "new base item, Tab at the end to add keys/attrs",
    type: "keyword",
  });
}
/** Inserts one declared GSI's key attributes to add to the current item. */
function gsiKeysSnippet(g: IndexSpec) {
  const keys = [...pkAttrs(g), ...skAttrs(g)];
  return snippetCompletion(keys.map((a) => `${a}=${ph(a)}`).join(SP2), {
    label: g.name,
    detail: `${g.name} keys: ${keys.join(", ")}`,
    type: "property",
  });
}

const DELETE_SNIPPET = snippetCompletion(`delete ${ph("label")}`, {
  label: "delete",
  detail: "delete an item",
  type: "keyword",
});

// `@` directive completions: makes declaring indexes discoverable, including
// the multi-key comma-list form (the thing that isn't obvious).
const DIRECTIVES = [
  snippetCompletion(`@gsi ${ph("Name")} pk=${ph("pk")} sk=${ph("sk")}`, {
    label: "@gsi",
    detail: "declare a secondary index",
    type: "keyword",
  }),
  snippetCompletion(
    `@gsi ${ph("Name")} pk=${ph("pk1")},${ph("pk2")} sk=${ph("sk1")},${ph("sk2")}`,
    {
      label: "@gsi multi-key",
      detail: "up to 4 pk / 4 sk, comma-separated",
      type: "keyword",
    },
  ),
  snippetCompletion(`@table ${ph("Name")} pk=${ph("pk")} sk=${ph("sk")}`, {
    label: "@table",
    detail: "name the base table + its keys",
    type: "keyword",
  }),
  snippetCompletion(`@ap ${ph("description")} -> ${ph("Index")}`, {
    label: "@ap",
    detail: "access pattern (auto-numbered)",
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

export function completeDsl(ctx: CompletionContext): CompletionResult | null {
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
  if (!word) return null;
  // Allow the menu on an empty line even without an explicit trigger, so it can
  // pop up on its own and show "what can I do here?".
  const atLineStart = before.trim() === "";
  if (word.from === word.to && !ctx.explicit && !atLineStart) return null;

  // If the cursor sits inside a value (current segment already has an `=`), the
  // user is typing a VALUE, not an attribute name: offering attribute/GSI
  // completions here would garble it (e.g. SK=GSI1PK=GSI1PK). Stay quiet.
  const segment = /(\S*)$/.exec(before)?.[1] ?? "";
  if (segment.includes("=")) return null;

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
    // line start: everything you can begin a line with, scaffold an item
    // (blank or from an entity template), delete, or an @ directive.
    options = [itemSnippet(base), DELETE_SNIPPET, ...DIRECTIVES, ...entities.map(entityScaffold)];
  }

  return { from: word.from, options };
}
