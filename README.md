# Keyway

An interactive, **100% client-side** tool for designing and *teaching* DynamoDB
single-table data models. Write your model as plain text, watch it project into
the base table and its indexes, step through writes, see the real cost of each
one, and query it — all in the browser. Nothing is sent to a server; nothing is
stored anywhere but your tab.

> Most people learn single-table design from static blog diagrams. Here you load
> a model and *watch it work* — the GSI reprojects, the sparse index skips a row,
> a key change costs a delete+put, a scan reads the whole table.

## Why it's different

- **The text is the model.** A tiny, readable DSL — diffable in a PR, editable in
  vim, pasteable in Slack. The format *is* the sharing mechanism.
- **A pure, tested engine.** `fold(ops) → state` and `project(state, index) → view`
  are DOM-free and covered by ~70 unit tests. The UI is just a lens on them.
- **It teaches the mechanics that bite people:** GSI overloading, sparse indexes,
  the reindex cost of a key change, transactional (2×) writes, projection modes,
  native multi-key GSIs, and why a filter doesn't reduce a query's read cost.

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
3. The included workflow (`.github/workflows/deploy.yml`) builds and publishes on
   every push to `main`. Vite's `base: "./"` makes it work at any subpath, so you
   don't need to configure the repo name.

## Sharing a model

- **Link** — the **share** button copies a URL with the whole model in it.
- **Example** — pick one from the **examples** menu.
- **Copy-paste** — the model is just text; paste it anywhere. Always works.

## Contributing an example

Add an entry to `src/model/examples.ts` (a name, a description, and the DSL text).
A test asserts every example parses cleanly, so a broken one fails CI.

## The DSL, briefly

```
@table pk=PK sk=SK                       # optional; base keys default to PK/SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK            # declare an index (one pane per @gsi)
@gsi ByRegion pk=tenant,region sk=status,date   # native multi-key GSI

u1: PK=USER#1  SK=PROFILE  name=Ada  _type=user   # label: attrs (label = stable id)
u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace      # same label = update
o1: PK=USER#2  SK=PROFILE                          # a new PK = atomic key change
delete o1                                          # remove an item
```

The `_type` attribute groups items into entities the editor can scaffold and
backfill. Comments (`#`) are free text.

---

Built with React + Vite + CodeMirror. MIT-licensed — use it, fork it, teach with it.
