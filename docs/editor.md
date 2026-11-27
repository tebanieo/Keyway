# Editor & autocomplete

The editor is a CodeMirror surface wired to the same pure parser the rest of the
app uses. It offers context-aware completions, scaffolds whole rows, and flags
problems inline as you type. This page describes what
[`src/Editor.tsx`](https://github.com/) actually does.

## The empty-line completion menu

Land on a blank line (for example by pressing Enter) and the menu pops up on
its own to answer _"what can I do here?"_. It never preselects anything, so
**Enter is always a newline** (a blank line between groups stays blank). To take
an option, type a few letters and press **Tab** (the top match), or arrow down
to it and press Enter. At the **start of a line** it offers everything you can
begin a line with, `item` first:

- **`item`**: scaffold a whole new row using the base table's keys (the
  possibly-custom `pk`/`sk`), leaving `${label}` and each key value as tab stops.
- **`delete`**: a `delete ${label}` snippet.
- **`@` directives**: `@gsi`, `@gsi multi-key` (the comma-list form, up to 4
  pk / 4 sk), `@table`, and `@ap`.
- **Entity scaffolds**: one entry per `_type` already in the model. Picking
  `order` drops a whole row prefilled with that entity's usual attributes and
  `_type=order`. The detail shows how many items of that type exist (`3×`).

Typing `@` on a line filters straight to the directive templates.

## Mid-item completions

Once a line already has `label:`, the menu switches to what you can add to the
current item:

- **A whole GSI's keys**: pick a declared GSI (e.g. `GSI1`) to append all its
  key attributes at once (`GSI1PK=… GSI1SK=…`). Declared GSI keys are offered
  even before any item uses them.
- **`_type`**: tag with an existing entity type, or `_type` to start a brand-new
  one.
- **Any known attribute name**: every attribute seen anywhere in the model,
  offered as `attr=${value}`.

The completer is careful about where the cursor sits: if you're typing a
**value** (the current segment already contains an `=`), it stays quiet so it
can't garble the value into something like `SK=GSI1PK=…`.

### `_type=` value completion

Right after `_type=`, the menu lists the entity types already defined in the
model, so overloaded rows stay consistent.

## Tab behavior

Tab is overloaded to make row authoring fast, and the bindings win over the
defaults:

- **`item` + Tab** scaffolds a row **keys-only**. The snippet fills just the
  base keys as tab stops; Tab walks you through each value.
- **Tab inside a row** jumps to the **next `attr=` value** on the line and
  selects it, so you can type over it.
- **Tab at the end of an item line** appends a two-space separator and **opens
  the completion menu**, so adding the next `key=value` never collides with a
  snippet slot. You pick a GSI key, `_type`, or an attribute to add.
- **Shift-Tab** jumps **back** to the previous value on the line.
- Inside an active snippet, Tab advances the snippet field first (so an open
  popup can't hijack it), then accepts a completion (the highlighted one, or the
  top match once you've typed a prefix), then falls back to the attribute jump.
- **Tab never leaves the editor.** On a blank line it opens the suggestions;
  on a comment or `delete` line it does nothing.
- **Escape** walks back one step at a time: it closes the suggestion menu, then
  ends the snippet you're filling in, then gets the editor ready to let you
  out: the very next **Tab** moves on to the tables, **Shift+Tab** back to the
  toolbar. Any other key keeps you typing.
- **Ctrl/Cmd+Enter** on an `@ap` line runs that access pattern in the Query
  panel: its index, operation, key condition and values are written into the
  request, and the result (with the returned items) shows right away.

## Adding with a form

Prefer a form to start? **+ Index** and **+ Entity** on the pane bar (or
"Add an index" / "Add an entity type" in the command palette) open a short
form. It shows the exact script lines it will add as you fill it in, and puts
them in the script: an index under the schema lines, an entity as its `@key`
template plus a first item. From there it's ordinary text to edit.

## Keyboard across the app

- **Ctrl/Cmd+K** opens the command palette from anywhere (the editor
  included): type a few words to find any action, an example, or a tour, and
  Enter runs it.
- **?** shows every shortcut. Single keys act only when you're not typing:
  `i` script, `q` Query panel, `e` Examples, `l` Learn, `a` Access patterns,
  `p` play/pause, `]`/`[` step, `t` theme, `1`–`9` show/hide panes. The cheatsheet has a switch to turn
  them off (remembered in this browser).

## Live diagnostics (linting)

The editor runs the **same `parseDoc` parser** the app uses and surfaces its
diagnostics inline, with a lint gutter. Errors and warnings you'll see include:

- malformed or unknown directives,
- `@gsi` missing a name or `pk=`,
- the multi-key comma-list warning (repeated `pk=` kept only the last),
- more than 4 pk / 4 sk attributes,
- an item missing its base key ("it won't appear"),
- a line that isn't a valid `label: key=value …` or `delete label`.

One deliberate nicety: the linter **never nags the line your cursor is on**, so a
half-typed `o5: PK=` stays quiet until you move off it. When you change lines,
linting is re-run so the line you just left is re-checked.

## The collapse-to-focus editor header

The editor lives under a header that lets you collapse the surrounding panes to
focus on the text: the text is the single artifact, so the editor is designed to
be usable full-attention. (The header/collapse control is part of the app shell
around `Editor`.)
