# Changelog

Notable changes to Keyway. The commit history is the full record; this file is a
hand-curated summary. It follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims for
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **`@if` now takes a real DynamoDB `ConditionExpression`**, with its
  placeholders as trailing `#name=attr` / `:value=literal` pairs (quote a value
  to force a String). It's parsed, validated, and evaluated by ExtendDB's
  `extenddb-core` running as WebAssembly in the page, so errors are DynamoDB's
  own (reserved words, undefined or unused placeholders), and a write with an
  invalid condition no longer lands. A comparison against a bare word warns that
  DynamoDB reads it as an attribute name.
- **The Query panel's filter is a real DynamoDB `FilterExpression`**, written
  the same way (expression, then `#name=attr` / `:value=literal` pairs) and
  evaluated by ExtendDB, with DynamoDB's `Invalid FilterExpression` errors.
- **Queries take a real DynamoDB `KeyConditionExpression`**, in `@ap` lines
  (`@ap … -> GSI1 GSI1PK = :e  :e=EMAIL#ada`) and in the Query panel, which
  pre-fills one for the chosen index. ExtendDB checks it against the index's
  key schema, so a broken key rule shows DynamoDB's own error (and flags the
  pattern `invalid` in coverage). GetItem keeps its `Key` (`get PK=… SK=…`) and
  no longer shows a filter box, since GetItem has no FilterExpression.
- **Capacity follows ExtendDB's measured rules.** Item size is ExtendDB's
  `item_size_bytes` (a plain number is sized as a Number: `2024` is 3
  bytes); an overwrite bills the larger of the old and new item; deleting a
  missing item bills the 1-WCU minimum; an in-place index update bills the
  larger index entry; and a GSI read is sized by its projected entries, so a
  `KEYS_ONLY` index reads cheaper.
- **Number keys sort numerically**, as DynamoDB orders an `N` key (`9` before
  `10`). A value counts as a Number only when written as a plain number: `007`
  stays a String.
- **Breaking:** the old compact `@ap` key syntax, like
  `PK=USER#1 SK begins_with ORDER#`, is no longer read; the editor points at
  the new form.
- **Breaking:** the old inline syntax (`@if status=pending`) is no longer
  accepted; write `@if #s = :p  #s=status :p=pending`. Shared links that use it
  show the error on those lines.

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
