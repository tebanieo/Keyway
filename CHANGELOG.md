# Changelog

Notable changes to Keyway. The commit history is the full record; this file is a
hand-curated summary. It follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims for
[Semantic Versioning](https://semver.org/).

## [Unreleased]

First public pre-release (0.1.0-alpha). When it ships, rename this section to
`[0.1.0-alpha] - <date>` and open a fresh `[Unreleased]` above it.

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
