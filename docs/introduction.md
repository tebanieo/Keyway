# What Keyway is

Keyway is an interactive, **100% client-side** tool for learning and designing
AWS DynamoDB data models by typing them. You write the model as a short script;
the app projects it into the base table and its indexes as you type, steps
through the writes with the estimated cost of each, runs your access patterns,
and lets you query it. The data is yours: your model is never sent to a server,
and it lives nowhere but your browser tab.

## The text is the single artifact

There's no separate schema file to keep in sync, and no database to connect to.
The model _is_ a short, readable DSL document, and everything else is a lens on
that one string:

- The base-table and index views are `project(state, index)` over the folded ops.
- The cost bar is `writeCost(...)` over each op.
- A shared link is just the same text, compressed into a URL fragment.
- Access-pattern coverage runs your declared queries against that same folded state.

Because the text is the whole artifact, you can diff it in a pull request, edit
it in vim, or paste it into Slack. That is the sharing mechanism. There is
nothing else to move around.

## 100% client-side: your data stays in the browser

The app makes no network calls with your data:

- Your model lives only in the browser tab. It is not written to a server, and
  it is not even saved to `localStorage`.
- Shared links carry the model in the URL **fragment** (`#m=…`). Browsers never
  send the fragment to a server, so a link's contents stay on the two machines
  that hold it.
- The only things counted are anonymous page-views and a few named UI events
  (via [GoatCounter](https://www.goatcounter.com)): no cookies, no personal data,
  no IP addresses stored, no profiling. A page-view records `location.pathname`
  only, so the `#m=…` model is never sent. The events are just labels — e.g.
  which example or learn path was opened (`example:…`, `tour:…`), so I can tell
  which ones people find useful — never anything you type. Everything is skipped
  on localhost. You can audit the whole surface in `index.html` and
  `src/analytics.ts`, and see the numbers yourself: the
  [GoatCounter dashboard is public](https://keyway.goatcounter.com/).

You can create your data model without anything leaving your machine. See
[Share links & examples](/sharing) for the details.

## Quick start

1. **Open the app.** It opens on an empty script with the cursor ready: type
   on the left, and the tables on the right update as you go. (Prefer a worked
   model? **Examples** in the right-hand rail, or a tour under **Learn**.)
2. **Declare the table and an index**, then add items. `item` + Tab scaffolds a
   row with the table's keys:

   ```text
   @table AppTable pk=PK sk=SK
   @gsi GSI1 pk=GSI1PK sk=GSI1SK

   u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  GSI1PK=EMAIL#ada  GSI1SK=USER#1  _type=user
   o1: PK=USER#1  SK=ORDER#1  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-01-14  _type=order
   ```

3. **Let keys build themselves.** `@key order  SK=ORDER#{date}  GSI1PK=STATUS#{status}`
   fills every order's keys from its own attributes; change the template and
   they all re-key. (Already writing keys that follow a pattern? The editor
   offers the `@key` line as a one-click fix.)
4. **Fill it with sample data.** Type `@gen order 3 per user` and press Tab:
   the line becomes three orders for each user, in that user's partition.
5. **Change a GSI key** (e.g. `status=shipped`) and watch the item hop
   partitions on the index, and the status bar bill it as a **reindex** (a
   delete + a put), not one write. Step back and forth through every write with
   the playback controls.
6. **Declare an access pattern** with `@ap … -> GSI1 …`: its line gets a ✓ when
   the model serves it, or the reason it doesn't. Ctrl/Cmd+Enter on the line
   runs it in the **Read / Query** panel.
7. **Share it**: the Share button copies a link with the whole model inside.

From here, jump to:

- [The DSL](/dsl): the full grammar you write in the script, including `@key`,
  `@gen` and `@transact`.
- [Editor & autocomplete](/editor): completions, Tab, the warnings, and the
  keyboard.
- [Filters & query conditions](/filters): how reads are shaped and trimmed.
- [The cost model](/cost): exactly how WCU/RCU are computed.
- [Access-pattern coverage](/access-patterns): grading a design against its queries.

## Disclaimer

::: info Personal project, not affiliated with AWS
Keyway is a personal project. The opinions and views expressed here and in the
tool are my own and do not represent those of my employer, Amazon Web Services
(AWS), or Amazon.com, Inc. Keyway is not an official AWS product and is not
affiliated with, endorsed by, or supported by AWS or Amazon.

Amazon DynamoDB, AWS, and NoSQL Workbench are trademarks of Amazon.com, Inc. or
its affiliates.
:::
