# Keyway

**Keyway** is a 100% client-side tool for designing and _teaching_ DynamoDB
single-table data models. You write your model as plain text, and the app
projects it into the base table and every secondary index, steps through the
writes, shows the real capacity cost of each one, and lets you query it, all in
the browser tab.

## The text is the single artifact

There is no separate schema file, no export format, no database to connect to.
The model _is_ a short, readable DSL document, and everything else is a lens on
that one string:

- The base-table and index views are `project(state, index)` over the folded ops.
- The cost bar is `writeCost(...)` over each op.
- A shared link is just the same text, compressed into a URL fragment.
- Access-pattern coverage runs your declared queries against that same folded state.

Because the text is the whole artifact, it is diffable in a pull request,
editable in vim, and pasteable into Slack. The format _is_ the sharing
mechanism: there is nothing else to move around.

## 100% client-side: your data stays in the browser

The app makes no network calls with your data:

- Your model lives only in the browser tab. It is not written to a server, and
  it is not even saved to `localStorage`.
- Shared links carry the model in the URL **fragment** (`#m=…`). Browsers never
  send the fragment to a server, so a link's contents stay on the two machines
  that hold it.
- The only thing counted is anonymous page-views (via
  [GoatCounter](https://www.goatcounter.com)): no cookies, no personal data, no
  IP addresses stored, no profiling. The counter records `location.pathname`
  only, so the `#m=…` model is never sent, and it is skipped on localhost. You
  can audit the whole surface in `index.html` and `src/analytics.ts`.

You can model a sensitive schema without your data leaving your machine. See
[Share links & examples](/sharing) for the details.

## Quick start

1. **Open the app.** It loads with a worked "Users & orders" example already in
   the editor.
2. **Read the left editor as a script.** Each line is one operation and one step:

   ```text
   @table AppTable pk=PK sk=SK
   @gsi GSI1 pk=GSI1PK sk=GSI1SK projection=all

   u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  GSI1PK=EMAIL#ada  GSI1SK=USER#1  _type=user-profile
   o1: PK=USER#1  SK=ORDER#1  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-01-14  _type=order
   ```

3. **Edit an item and watch it project.** Add an attribute, or repeat a label to
   update the same item: the base table and GSI panes update live.
4. **Change a GSI key** (e.g. `GSI1PK=STATUS#shipped`) and watch the item hop
   partitions on the index, and the cost bar bills it as a **reindex** (a
   delete + a put), not one write.
5. **Declare an access pattern** with `@ap … -> GSI1 …` and see whether the
   model actually _serves_ it.
6. **Share it**: the share button copies a link with the whole model inside.

From here, jump to:

- [The DSL](/dsl): the full grammar you write in the editor.
- [Editor & autocomplete](/editor): the completions and Tab behavior.
- [Filters & query conditions](/filters): how reads are shaped and trimmed.
- [The cost model](/cost): exactly how WCU/RCU are computed.
- [Access-pattern coverage](/access-patterns): grading a design against its queries.
