# Changelog

Notable changes to Keyway. The commit history is the full record; this file is a
hand-curated summary. It follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims for
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Tab at the end of a `@gsi` or other directive line no longer adds two spaces and opens the line-start menu (that's for item lines).
- **A key change is now truly all-or-nothing.** If the new item's `@if` failed, the old item used to be deleted anyway; now the whole transaction is cancelled.
- **Screen readers:** Canvas tables are an ARIA grid (each cell says whether it's editable, the edit field is named "<attribute> of <item>", and the keys are described); diff marks read as "added / removed / modified"; the change and action columns have header text; the phone view switch sits in a labelled region. axe reports no issues in the example, playback, Canvas, editing, Query and phone states, apart from one false positive on the editor's scroller.
- **Switching Canvas → Editor no longer wipes the script's comments.** Canvas edits now write into the script itself: an edited or added item is appended as a line, a delete as `delete label`, and everything you wrote (comments, directives, layout) is kept.
- **Phone: loading an example shows the tables** instead of a blank script tab while it plays.
- **Line numbers stay on their lines** after expanding the script (the editor re-measures when its pane resizes).
- **Canvas keyboard grid** arrows past removed rows instead of stopping, keeps a focused cell clear of the sticky key column, and keeps focus in the pane after a delete or a key edit that moves the row. Stepping onto the last step hands focus to Play.
- **Accessibility:** rows dimmed during playback keep 4.5:1 contrast; Query field borders, the resting pin button, the splitter and checkbox focus reach 3:1; the phone Script/Tables switch and the footer pass contrast; rail buttons expose expanded/collapsed and include the unserved count in their name; the script tells screen readers how to leave it (Escape, then Tab).
- **"+ item" in Canvas no longer blanks the app.** Pinning the new item tried to reveal a script line that didn't exist yet.
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
- **The Query panel runs on the first try.** Its template is pre-filled with a
  real partition from your table (it used to start empty and fail with
  "`:pk` is empty"), and Ctrl/Cmd+Enter runs it from any field, the JSON ones
  included.

### Changed

- **Editing a cell changes its line.** A table edit now rewrites the attribute on the script line that wrote the item (as of the step you're on), so a correction stays a correction instead of becoming a new step. Rows written inside a `@transact` block still get a new line.
- **Calmer controls, one meaning each.** Panes and Diff/Compact are toggle chips (on is tinted with a filled dot), "Show all" is a link that appears only when a pane is hidden, segmented choices like Get/Query/Scan raise the chosen option instead of filling it, and Share is an outlined secondary button. Solid accent now marks only Play and Run. The script's tab reads "Script", and the empty table says how to start.
- **Columns line up across partitions.** Every partition in a pane shares one set of columns and widths, so an attribute sits at the same place in each item collection and can be compared down the page.
- **One interface: the script.** The Canvas/Editor switch is gone. The base table is still editable in place (double-click or Enter on a cell, delete a row, "+ item"), and every change is written into the script as a line, as if typed, so the text stays the single source of truth.
- **The hint under the tables** is a short keyed guide while the model is empty, and a single line after that.
- **Polish from the second review:**
  - **Reset:** "Undo" stays for 30 s and is in the command palette ("Undo reset"). Toasts sit above the status bar.
  - **Error count:** the editor's count no longer flashes "1 error" for the line you're still typing, and it matches the problems list.
  - **Wording:** one name per feature, in sentence case ("Read / Query", "Access patterns", "Strongly consistent", "Run"). The theme button says which theme it switches to.
  - **Lists:** Examples and Learn lists move with the arrow keys and Home/End.
  - **Headings:** panel titles are headings.
  - **Column headers:** table column headers are 11px.
  - **Splitter:** it has a 24px hit area.
  - **Command palette:** "No matching command" is announced.
- **More room for the tables.** A docked panel has a fixed 360px reading width and the script gives up a share, so the tables keep the most space. Below 1100px a panel sits under the tables (at most 40% of the height) instead of covering them, so matched rows stay visible while you query. Clicking elsewhere no longer closes a panel; use its ×, Escape or its rail button.
- **Wide tables show there's more to the right** (a shade at the edge that goes away at the end), and long values end in an ellipsis (hover for the whole value, click to copy it).
- **High zoom works:** in a short window (400% zoom, or under 520px tall) the page scrolls instead of squeezing the tables to nothing.
- **Phone:** a one-row toolbar, the Script/Tables switch and the rail share one bottom bar, and the footer no longer runs into itself. Rail labels no longer sit on top of the content or an open panel's header.
- **Playback reads at your pace.** Each step is held long enough to read its note, the default speed is labelled 1× (0.5× and 2× around it), and the step banner above the tables is always there (a step without a note shows what it does), so the tables no longer jump. Screen readers hear every step (number, write, cost and note) through one live region.
- **Examples keep the script open** beside the tables on wide screens, with the running step lit, and the keyboard lands on Play/Pause after loading an example or a tour.
- **Step narration sits above the tables, in full.** It was cut off with an ellipsis in the status bar; now it wraps at the top of the tables, where you're looking, on every screen size including phones.
- **Phone layout.** Below 700px wide the script and the tables take turns behind a Script | Tables switch, the rail is a row of buttons, panels open as bottom sheets, and the status bar keeps playback, the step and its cost.
- Tables: the sort-key column and diff gutter stay in place while a wide item scrolls sideways (the partition header no longer scrolls away), pane titles stay visible while scrolling, and the pin/delete buttons are larger, faintly visible at rest, and shown on keyboard focus.
- Panels (Query, Examples, Learn, Access Patterns) dock beside the tables on wide screens instead of covering them, and stay open while you click around; the rail is a fixed column. On narrower screens a panel opens as a bottom sheet.
- **A workbench layout: the script and the tables side by side.** The page is a
  fixed-height frame with no page scroll; the script sits on the left and the
  tables on the right, each scrolling on its own. At 1440x900 you see about 9
  table rows next to the whole script, where the stacked layout showed about 4
  rows below an editor that took half the screen. Tours and examples fold the
  script to a slim tab.
- **A permanent status bar.** Playback, the current step and its narration,
  that step's cost chips and a running WCU total for every step so far sit in
  one strip at the bottom. It replaces the narration pill and the cost pop-up
  that floated over the tables and vanished after 2.6 seconds.

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

- **Guided Add: "+ Index" and "+ Entity"** (on the pane bar, and in the command palette). A short form for a new GSI or a new entity type that writes ordinary script lines, previewed live as you fill it in, so the form teaches the syntax rather than hiding it. An entity's keys can use `{attribute}` and become a `@key` template, with a first item to fill in.
- **Key templates: `@key order  SK=ORDER#{date}#{id}  GSI1SK={date}`.** Every item tagged `_type=order` gets those keys filled in from its own attributes (in any order on the line), so a key redesign is one edit. Missing attributes and explicit keys that disagree are flagged. When existing items already follow a pattern, the editor offers the template as a one-click fix and flags an item that alone breaks it. Suggestions offer the attributes a template needs, and changing a template on a model with data explains that it's a migration in DynamoDB.
- **Access-pattern status in the script.** Every `@ap` line gets a gutter mark: a green ✓ when the pattern is served, a warning with the reason when it isn't (no index, invalid, empty), so coverage is visible while you type, without opening the Access patterns panel.
- **Warnings for design slips that parse fine:** a key attribute name one typo away from a declared key (`GS1PK` vs `GSI1PK`, so the item silently misses that index), an item with only part of an index's key (it won't appear in that index), and a value holding `name=` (two pairs run together).
- **Transactions: `@transact … @end`.** Group puts, deletes and `check label @if …` (a ConditionCheck) into one `TransactWriteItems`: one step, all or nothing. Every condition is checked against the table before the transaction; if any fails, it's cancelled and nothing is written (still billed). Each action costs the transactional rate (a check included). DynamoDB's rules are enforced: no two actions on one item, at most 100 actions, no nesting. The editor completes `@transact` and offers `check` inside a block.
- **"In real DynamoDB" notes for schema changes.** Changing a key in `@table` or `@gsi` (or adding a GSI) on a model with data still rebuilds the tables instantly, and now a note says what that would be in production: a new table plus a data copy for a primary-key change, delete-and-re-create plus a backfill for a GSI's keys, and a billed backfill for a new GSI.
- **Resize the script:** drag its right edge, or focus it and use the arrow keys (Shift for bigger steps); the width is remembered. Keys `1`–`9` show or hide the panes, and pane titles are larger.
- **Canvas tables work from the keyboard:** each table is one tab stop, the arrow keys (and Home/End) move between cells, Enter or F2 edits a cell, and Enter/Escape bring you back to it.
- **Command palette (Ctrl/Cmd+K)** with every action, example and tour, and **single-key shortcuts** (`q`, `e`, `l`, `a`, `p`, `[`/`]`, `t`, `i`) that act only when you're not typing. `?` shows them all, with a switch to turn the single keys off.
- **Ctrl/Cmd+Enter on an `@ap` line runs it** in the Query panel, with the pattern's index, key condition and values filled in.
- **Syntax highlighting** in the script: comments, directives, labels, attribute names, values, and expression placeholders each get a colour from the theme.
- **More editor completions:** index names after `->` in an `@ap`, `all`/`keys`/attribute names after `projection=`, and existing item labels after `delete`.
- **The script and the tables are linked.** The item line under the caret lights its row in every pane and scrolls it into view; pinning a row puts the caret on the line that wrote it.
- **The Query panel lists what it returned**, keys first then the other attributes, so you no longer have to hunt for highlighted rows.
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
