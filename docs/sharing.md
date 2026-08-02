# Share links & examples

Because [the text is the single artifact](/), sharing a model is just moving that
text. There are three ways, and none of them involve a server.

## Share links (`#m=`)

The **share** button builds a URL that carries the whole model in its **fragment**:

```text
https://your-host/keyway/#m=N4Ig…            (compressed DSL)
```

- The DSL text is compressed with **lz-string**
  (`compressToEncodedURIComponent`) into a URL-safe payload and placed after
  `#m=` (see [`src/model/share.ts`](https://github.com/)).
- The link is built from the current origin + path, so it works identically on
  `localhost` and on GitHub Pages (any base path is preserved).
- Opening a link reads the model back out of the fragment
  (`modelFromLocation`) and loads it through the same path an example uses.

::: tip Sensitive schemas stay local
A URL **fragment is never sent to a server** — browsers strip everything after
`#` from the request. So a shared link's contents travel only between the two
machines that hold the link. You can model a sensitive schema and share it with a
teammate without it touching any backend. There is no server to send it to
anyway: Keyway is 100% client-side.
:::

There's a practical length ceiling (`SAFE_URL_LEN`, 8000 chars) past which a link
gets awkward to paste into chat apps; beyond it the app suggests copy-paste
instead. Real browsers allow far more, but chat clients often truncate.

## The examples gallery

Keyway ships a set of curated models, each loaded through the **same** path a
shared link uses. They double as steppable, cost-annotated teaching artifacts:

| Example            | What it shows                                                                 |
| ------------------ | ----------------------------------------------------------------------------- |
| **Users & orders** | the guided tour — GSI overloading, a sparse index, a reindex on ship          |
| **Multi-tenant SaaS** | tenants, users, projects, everything scoped per tenant                     |
| **Social feed**    | profiles, follows as adjacency edges, a reverse-lookup GSI                     |
| **Event ticketing**| events and tickets, plus find-by-holder on GSI1                               |
| **Multi-key GSI**  | native composite keys — partition by (tenant, region), sort by (status, date) |

Each example is plain DSL. A test asserts every example parses cleanly, so a
broken one fails CI. Contributing an example is a single entry (a name, a
description, and the DSL text) in `src/model/examples.ts`.

## Plain copy-paste

The model is just text, so the most robust "share" is to select it and paste it
anywhere — a PR, a gist, a Slack message, a doc. It always works, it's diffable,
and it needs nothing but a text field on the other end. This is the fallback the
app points you to when a share link would be too long.
