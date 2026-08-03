# Keyway - A NoSQL datamodeling tool

An interactive, **100% client-side** tool for designing and _teaching_ how to
model your data into a NoSQL database, initially with DynamoDB as the
destination. Write your model as plain text, watch it project into the base
table and its indexes, step through writes, see the estimated cost of each one, and
query it all in the browser. The data is yours! Your model is never sent to a
server and is stored nowhere but your browser tab (see [Privacy](#privacy)).

**Try it live: <https://tebanieo.github.io/Keyway/>** ·
[Reference docs](https://tebanieo.github.io/Keyway/docs/)

> Most people learn data modelling techniques such as single-table design from
> static blog diagrams. Here you load a model and _watch it work_: the GSI
> reprojects, the sparse index skips a row, a key change costs a `DELETE` +
> `PUT`, a `SCAN` reads the whole table.

## Why it's different

- **The text is the model.** A tiny, readable DSL, diffable in a PR, editable in
  vim, pasteable in Slack. The format _is_ the sharing mechanism.
- **Define your access patterns up-front.** Declare what your design must serve
  with `@ap`, and the app runs each one against the model, so you see at a glance
  which patterns are covered and which are still gaps.
- **It teaches core datamodelling techniques:** GSI overloading, sparse indexes,
  the reindex cost of a key change, transactional (2×) writes, projection modes,
  native multi-key GSIs, conditional writes (`@if`) and what a failed condition
  still costs you, and why a filter doesn't reduce a query's read cost.
- **Guided tours built in!** Most of the DynamoDB examples are plain text, and
  even if there is nothing wrong with that, I always believed it is easier to see
  it in a step-by-step movie. The **Learn** menu plays short narrated scenarios,
  from "how the editor works" to GSI overloading, sparse indexes, atomic key
  changes, and conditional writes.

## Not a replacement for NoSQL Workbench

If you want AWS's official tooling for DynamoDB, use
[NoSQL Workbench](https://aws.amazon.com/dynamodb/nosql-workbench/): that is what
AWS recommends, and it's a great tool. Keyway is not trying to compete with it.

I built Keyway because I wanted something those tools generally don't offer: a
text-first model you can diff and share as a link, stepped playback that shows the
estimated cost of each write, access-pattern coverage that actually runs your queries,
and narrated tours that teach the mechanics, all in the browser with nothing to
install. Different goals; use whichever fits.

## Privacy

**Your model never leaves your browser.** There is no backend. The app makes no
network calls with your data: your model lives in the tab (it isn't even saved to
`localStorage`), and **shared links carry the model in the URL fragment** (`#m=…`),
which browsers never send to a server. You can create your data model without
anything leaving your machine.

The one thing I count is **anonymous page-views** (via
[GoatCounter](https://www.goatcounter.com)), so I can tell roughly how many people
find Keyway useful. No cookies, no personal data, and **no IP addresses or
identifiers are stored**. You can't be tracked or profiled. Only the fact that a
page loaded (plus the referring site, and a couple of anonymous events like "an
example was opened") is counted, never anything you type.

### Don't trust me? Read the code.

You don't have to take my word for any of this. It's a static site: open your
DevTools Network tab and watch. Or read the exact lines:

- **Your model is never transmitted.** It's held in the URL fragment (`#m=…`),
  which the browser strips before it makes any request. See
  [`src/model/share.ts`](src/model/share.ts).
- **We send only the page path, to one place.** In [`index.html`](index.html) the
  page-view is sent by our own line, `goatcounter.count({ path: location.pathname })`,
  so the query string and the `#m=…` model are never included. The single request
  goes to `keyway.goatcounter.com/count`; on the live site you can watch it in the
  Network tab (on localhost nothing loads and nothing is sent).
- **The in-app events are one tiny, guarded call** with an event name and nothing
  else. See [`src/analytics.ts`](src/analytics.ts).
- **No IPs or cookies are stored**: that's GoatCounter's design, and it's
  open-source too, so you can audit it: <https://github.com/arp242/goatcounter>.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # the engine's unit tests
npm run build    # static site into dist/
```

## Deploy (GitHub Pages)

It's a static single-page app, so GitHub Pages is ideal and free. This repo
publishes to <https://tebanieo.github.io/Keyway/>.

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source = "GitHub Actions".**
3. The included workflow (`.github/workflows/deploy.yml`) builds the app **and**
   the reference docs on every push to `main`, serving the docs at `/Keyway/docs/`
   alongside the app. Vite's `base: "./"` keeps the app's assets relative, and the
   VitePress `base` is already set to `/Keyway/docs/` for this repo.

## Sharing a model

- **Link:** the **share** button copies a URL with the whole model in it.
- **Example:** pick one from the **examples** menu.
- **Copy-paste:** the model is just text; paste it anywhere. Always works.

## Learn it / docs

- **In the app:** the **Learn** menu plays guided, narrated tours (start with
  "Getting Started" and "How to Model"), and the **Docs** link opens the reference.
- **Reference manual:** a VitePress site under `docs/` (the DSL grammar, the
  editor, filters, the cost model, access patterns, sharing) that publishes at
  <https://tebanieo.github.io/Keyway/docs/>. Run it locally with `npm run docs:dev`.

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

- **`@ap`** declares an access pattern (a requirement); the app runs it against
  the model and shows which patterns are served and which aren't.
- **`@if`**, as the last clause on a put/delete, is a conditional write: it
  applies only if the condition holds, else it's rejected (and a failed check
  still costs).
- **`_type`** groups items into entities the editor can scaffold and backfill.
- Comments (`#`) are free text; a comment directly above a line narrates that step.

---

Created by [**Esteban Serna**](https://github.com/tebanieo) with ♥.
Built with React · Vite · CodeMirror. **MIT-licensed**: use it, fork it, teach
with it, or better yet, use the version already deployed at
<https://tebanieo.github.io/Keyway/>.

## Disclaimer

Keyway is a personal project. The opinions and views expressed in this repository
and in the tool are my own and do not represent those of my employer, Amazon Web
Services (AWS), or Amazon.com, Inc. Keyway is not an official AWS product and is
not affiliated with, endorsed by, or supported by AWS or Amazon.

Amazon DynamoDB, AWS, and NoSQL Workbench are trademarks of Amazon.com, Inc. or
its affiliates.
