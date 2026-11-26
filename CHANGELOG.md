# Changelog

Notable changes to Keyway. The commit history is the full record; this file is a
hand-curated summary. It follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims for
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Enter is always a newline in the editor.** The suggestion menu that opens on
  a blank line no longer preselects its first option, so pressing Enter twice
  to leave a blank line no longer inserts an `@ap` template, and Enter after
  `_type=user` no longer swallows the newline. Tab still takes the top match
  once you've typed a prefix (`item`, `@g`), and `item` now leads the menu.
- **Closed drawers no longer hold tab stops.** Tab out of the editor used to
  land in the hidden Query panel and drawers (35 invisible stops); they're now
  `inert` while closed, and so is the collapsed editor.
- **Buttons and fields use the app's fonts** (they rendered in Arial, and the
  editor's line numbers in a generic monospace), and native controls and
  scrollbars follow the light or dark theme.
- **The light theme meets WCAG AA contrast.** Key attributes, errors, warnings,
  served/unserved counts, the accent and editor line numbers measured 1.7 to
  4.5:1 on white; they're now 4.5:1 or better on every light background, and
  the editor's line numbers and placeholders pass in the dark theme too. The
  editor's suggestion popup follows the theme instead of staying dark.
- **Motion respects the system's reduced-motion setting**, and the rail's
  attention pulse runs three times instead of forever. "1 items" reads "1 item".
- **You can type the moment Keyway opens.** It starts in the editor with the
  cursor at the end of the model (it used to open on the table view with
  nothing focused, about 11 keystrokes from typing), and a shared link no
  longer opens with the page scrolled under the toolbar.
- **Tab and Escape in the editor are predictable.** Tab never leaves the editor
  (on a blank line it opens suggestions), and `item`+Tab works however fast you
  type. Escape closes the menu, then ends the snippet, then lets you out: the
  next Tab moves on, Shift+Tab goes back, shown by a hint on the editor. It used
  to drop focus onto nothing.
- **Drawers work from the keyboard.** Opening one moves focus inside (the Query
  panel's first field, the first example or tour), Escape closes it, and focus
  returns to where you came from. The tucked rail shows itself when it has
  keyboard focus, and the green ✓ marks only the button whose badge cleared.
- **Share is a real modal dialog**: it opens on "Copy link", Tab stays inside
  it, Escape closes it, and focus returns to the Share button.
- **Screen readers get state, names and structure.** Toggles report whether
  they're on (`aria-pressed`), the editor header whether it's expanded, icon
  buttons have names (Play/Pause, Step back, Pin, Delete, Close), the editor is
  labelled "Model script", panes are headings and each partition's table is
  named. Query results and errors, narration, the "copied" toast and the
  served count are announced, and the toolbar and rail are landmarks.
- **Problems are visible without a mouse.** The editor header counts errors and
  warnings and opens the problems list (also Ctrl+Shift+M; F8 jumps to the
  next). A problem you jump to now shows its message (the editor only stays
  quiet on a line you're in the middle of typing), and an `@ap` naming an index
  that doesn't exist gets a warning on its line.
- **Reset can be undone.** It used to empty the model with one keypress and no
  way back; now a toast offers **Undo** for ten seconds, and the cursor lands
  in the fresh editor.

### Changed

- **Expressions are written exactly as the DynamoDB API takes them**: the
  expression, plus `ExpressionAttributeNames` and typed
  `ExpressionAttributeValues` as JSON. On a DSL line that's
  `names={…} values={…}` after the expression; in the Query panel, a field per
  API parameter.
- **`@if` takes a real DynamoDB `ConditionExpression`**. It's parsed, validated, and evaluated by ExtendDB's
  `extenddb-core` running as WebAssembly in the page, so errors are DynamoDB's
  own (reserved words, undefined or unused placeholders), and a write with an
  invalid condition no longer lands. A comparison against a bare word warns that
  DynamoDB reads it as an attribute name.
- **The Query panel is the real API request**: `Key` (GetItem),
  `KeyConditionExpression`, `FilterExpression`, `ExpressionAttributeNames`, and
  `ExpressionAttributeValues`, with the API's rule that every name and value is
  used. A button per sort-key operator (`=`, `<`, `<=`, `>`, `>=`, `BETWEEN`,
  `begins_with`) writes the key condition, and the matching
  `aws dynamodb query` / `scan` / `get-item` command is shown live, ready to
  copy. GetItem no longer shows a filter, since the API has none.
- **Queries take a real DynamoDB `KeyConditionExpression`**, in `@ap` lines
  (`@ap … -> GSI1 GSI1PK = :e  values={":e": {"S": "EMAIL#ada"}}`) and in the
  panel. ExtendDB checks it against the index's key schema, so a broken key
  rule shows DynamoDB's own error (and flags the pattern `invalid` in coverage).
  An `@ap get` takes the API's typed `key={…}`.
- **Types come from the table.** An attribute holds Numbers when every value is
  written as a plain number. Templates and sort-key buttons type values to
  match, and a value whose type can't match what the table holds gets a
  warning, in the panel and in coverage: DynamoDB compares by type.
- **Capacity follows ExtendDB's measured rules.** Item size is ExtendDB's
  `item_size_bytes` (a plain number is sized as a Number: `2024` is 3
  bytes); an overwrite bills the larger of the old and new item; deleting a
  missing item bills the 1-WCU minimum; an in-place index update bills the
  larger index entry; and a GSI read is sized by its projected entries, so a
  `KEYS_ONLY` index reads cheaper.
- **Number keys sort numerically**, as DynamoDB orders an `N` key (`9` before
  `10`). A value counts as a Number only when written as a plain number: `007`
  stays a String.
- **The theme follows your system** (light or dark), live, until you pick one
  with the toggle; only that choice is remembered. Before, it defaulted to dark.
- **Breaking:** the earlier forms are no longer read: inline values
  (`@if status=pending`), `:v=value` pairs, and the compact `@ap` key
  (`PK=USER#1 SK begins_with ORDER#`). Write
  `@if #s = :p  names={"#s": "status"}  values={":p": {"S": "pending"}}`; the
  editor points old lines at that form. Shared links that use them show the
  error on those lines.

### Removed

- Keyway's hand-written filter/condition parser and evaluator
  (`src/engine/filter.ts`, ~400 lines): ExtendDB does that job now.

### Added

- **ExtendDB as Keyway's DynamoDB engine.** `wasm/` wraps ExtendDB's
  `extenddb-core` (Apache-2.0, pinned to v1.0.0, no fork) and compiles it to
  WebAssembly, which the page loads from the site itself and runs in the tab:
  conditions, filters, key conditions, and item size all go through it. The
  built bindings are committed, so working on the app needs no Rust, and the
  build is reproducible byte-for-byte (`npm run wasm:build`), with no local
  paths in the binary. ExtendDB's `LICENSE` and `NOTICE` ship under
  `/licenses/extenddb/`.

### Tooling

- A Claude Code guard hook (`scripts/guard-git.mjs`, wired in
  `.claude/settings.json`) that blocks any attempt to skip or disable the
  Lefthook pre-commit gate, plus `AGENTS.md` rules for coding agents.
- CI runs the full gate on pushes to every branch, not just `main`, as the
  backstop for anything that skips the local hook.
- A CI `wasm` job runs the Rust format, lint, and unit tests, rebuilds
  `wasm/pkg`, and fails if the committed binary differs from its source.

## [0.1.0-alpha] - 2026-08-02

First public pre-release.

### Added

- A text-first DSL for DynamoDB single-table models: `@table`, `@gsi` (including
  native multi-key GSIs), `@ap` access patterns, item and delete lines, and `@if`
  conditional writes.
- Live base-table and per-GSI panes with diffs, a step scrubber with narration,
  and an estimated per-write cost readout (WCU/RCU).
- Access-pattern coverage that runs each declared query against the model.
- A read/query panel with key conditions and filter expressions.
- Shareable links (the whole model compressed into the URL fragment) and a
  curated examples gallery.
- An in-app Learn drawer with guided, narrated tours, plus a VitePress reference
  manual published alongside the app.
- Anonymous, privacy-respecting page-view counting (GoatCounter): no cookies, no
  stored IP addresses, skipped on localhost.

### Tooling

- ESLint, Prettier, and a Lefthook pre-commit gate (format, lint, typecheck,
  tests). CI runs the same checks on every pull request.
