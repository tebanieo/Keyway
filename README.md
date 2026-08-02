# Keyway

An interactive, **100% client-side** tool for designing and _teaching_ DynamoDB
single-table data models. Write your model as plain text, watch it project into
the base table and its indexes, step through writes, see the real cost of each
one, and query it — all in the browser. Nothing is sent to a server; nothing is
stored anywhere but your tab.

> Most people learn single-table design from static blog diagrams. Here you load
> a model and _watch it work_ — the GSI reprojects, the sparse index skips a row,
> a key change costs a delete+put, a scan reads the whole table.

## Why it's different

- **The text is the model.** A tiny, readable DSL — diffable in a PR, editable in
  vim, pasteable in Slack. The format _is_ the sharing mechanism.
- **A pure, tested engine.** `fold(ops) → state` and `project(state, index) → view`
  are DOM-free and covered by 162 unit tests. The UI is just a lens on them.
- **Access patterns are first-class.** Declare what your design must serve with
  `@ap`, and the app runs each one against the model, so you see at a glance which
  patterns are covered and which are still gaps.
- **It teaches the mechanics that bite people:** GSI overloading, sparse indexes,
  the reindex cost of a key change, transactional (2×) writes, projection modes,
  native multi-key GSIs, conditional writes (`@if`) and what a failed condition
  still costs you, and why a filter doesn't reduce a query's read cost.
- **Guided tours built in.** The **Learn** menu plays short narrated scenarios —
  from "how the editor works" to GSI overloading, sparse indexes, atomic key
  changes, and conditional writes — each loading a model and stepping through it
  for you.

## Privacy

There is **no backend and no telemetry**. The app makes no network calls beyond
loading its own static assets. Your model lives in the browser tab (it isn't even
saved to `localStorage`), and **shared links carry the model in the URL fragment**
(`#m=…`), which browsers never send to a server. You can model sensitive schemas
without anything leaving your machine.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # the engine's unit tests
npm run build    # static site into dist/
```

## Deploy (GitHub Pages)

It's a static single-page app, so GitHub Pages is ideal and free.

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source = "GitHub Actions".**
3. The included workflow (`.github/workflows/deploy.yml`) builds the app **and**
   the reference docs on every push to `main`, serving the docs at `/docs`
   alongside it. Vite's `base: "./"` makes the app work at any subpath; for a
   project-Pages URL, set the VitePress `base` in `docs/.vitepress/config.ts` to
   `/<repo>/docs/`.

## Sharing a model

- **Link** — the **share** button copies a URL with the whole model in it.
- **Example** — pick one from the **examples** menu.
- **Copy-paste** — the model is just text; paste it anywhere. Always works.

## Learn it / docs

- **In the app** — the **Learn** menu plays guided, narrated tours (start with
  "Getting Started" and "How to Model"), and the **Docs** link opens the reference.
- **Reference manual** — a VitePress site under `docs/` (the DSL grammar, the
  editor, filters, the cost model, access patterns, sharing) that publishes at
  `/<site>/docs`. Run it locally with `npm run docs:dev`.

## Contributing an example

Add an entry to `src/model/examples.ts` (a name, a description, and the DSL text).
A test asserts every example parses cleanly, so a broken one fails CI.

## Development

```bash
npm run dev          # Vite dev server
npm test             # Vitest engine + model tests
npm run lint         # ESLint (flat config)
npm run format       # Prettier
```

A **Lefthook** pre-commit hook runs format, lint, typecheck, and the full test
suite on every commit; `npm install` wires it up automatically (no Python
needed). The engine lives in `src/engine/` (pure, DOM-free), the DSL and model
logic in `src/model/`, and the React UI in `src/components/`.

## The DSL, briefly

```
@table AppTable pk=PK sk=SK              # optional; base keys default to PK/SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK            # declare an index (one pane per @gsi)
@gsi ByRegion pk=tenant,region sk=status,date   # native multi-key GSI

@ap List a user's orders -> AppTable PK=USER#1 SK begins_with ORDER#   # a requirement
@ap Look up a user by email -> GSI1 GSI1PK=EMAIL#ada@x.io              # the app runs it + grades coverage

u1: PK=USER#1  SK=PROFILE  name=Ada  _type=user   # label: attrs (label = stable id)
u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace      # same label = update
o1: PK=USER#2  SK=PROFILE                          # a new PK = atomic key change
u2: PK=USER#3  SK=PROFILE  @if attribute_not_exists(PK)   # conditional write (create-only)
delete o1                                          # remove an item
```

- **`@ap`** declares an access pattern (a requirement); the app runs it against the
  model and shows which patterns are served and which aren't.
- **`@if`**, as the last clause on a put/delete, is a conditional write: it applies
  only if the condition holds, else it's rejected (and a failed check still costs).
- **`_type`** groups items into entities the editor can scaffold and backfill.
- Comments (`#`) are free text; a comment directly above a line narrates that step.

---

Created by [**Esteban Serna**](https://github.com/tebanieo) with ♥.
Built with React · Vite · CodeMirror. **MIT-licensed** — use it, fork it, teach with it.
