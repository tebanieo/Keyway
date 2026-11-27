# The DSL

The model is a tiny text format. **One line = one op = one step.** It's meant to
be written and read by hand: skim it cold in a PR, or edit it in vim. No special
editor required. This page is the grammar, faithful to
[`src/model/dsl.ts`](https://github.com/).

A document has two kinds of lines:

- **Directives** (`@table`, `@gsi`, `@ap`) declare structure and access patterns.
- **Item / delete lines** are the operations: the data and the steps.

Blank lines and comments are ignored except where noted below.

## `@table`: the base table

```text
@table [Name] pk=<attr> sk=<attr>
```

- A leading bareword (one with no `=`) names the table; omit it to leave the
  table unnamed.
- `pk=` is required. `sk=` is **optional**: leave it out for a **PK-only
  table** (a `GetItem`/partition-only design).

```text
@table AppTable pk=PK sk=SK      # composite-key table named "AppTable"
@table pk=PK sk=SK               # unnamed, composite key
@table Sessions pk=sessionId     # PK-only table (no sort key)
```

If `pk=` is missing you get an error:
`@table needs pk= (e.g. @table AppTable pk=PK sk=SK, or pk= alone for a PK-only table)`.
A plain unnamed `PK`/`SK` table is the implicit default and need not be declared.

## `@gsi`: a secondary index

```text
@gsi <Name> pk=<attrs> [sk=<attrs>] [projection=all|keys|<comma-list>]
```

- `<Name>` and `pk=` are required; each declared GSI gets its own pane.
- **Multi-key GSIs** use a **comma list**, not repeated `pk=`. Up to **4
  partition** and **4 sort** attributes, kept as separate natively-typed columns
  (no string concatenation):

  ```text
  @gsi GSI1 pk=GSI1PK sk=GSI1SK
  @gsi ByRegion pk=tenant,region sk=status,date
  ```

- `projection=` controls what the index carries:
  - `all` (or omitted) → **ALL** attributes.
  - `keys` / `keys_only` → **KEYS_ONLY** (just the key attributes).
  - a comma list → **INCLUDE** those named attributes.

  ```text
  @gsi GSI2 pk=GSI2PK sk=GSI2SK projection=keys
  @gsi GSI3 pk=GSI3PK projection=status,total
  ```

::: warning How to write a multi key attribute
Writing `pk=a pk=b` (repeated `pk=`) instead of `pk=a,b` keeps **only the last**
key and silently collapses the index to a single key. Keyway flags this with a
warning: _"multi-key GSI: use a comma list (`pk=a,b`), not repeated `pk=`."_
More than 4 pk or 4 sk attributes is also warned.
:::

## `@ap`: a declared access pattern

An access pattern is the **spec**: what your design must be able to serve. They
are auto-numbered (AP1, AP2, …) in declaration order.

```text
@ap <description> [-> <Index> [get|query|scan] <key>]
```

- `<description>` is required (everything before the `->`).
- `-> <Index>` names the index that should serve it.
- The read op defaults to `query`; you can write `get` or `scan` explicitly.
- The **key** makes the pattern a _real, runnable read_:
  - **query**: a real DynamoDB `KeyConditionExpression`, then `names={…}` and
    `values={…}`, written as the API takes them (the same form as
    [`@if`](#if-a-conditional-write)). Equality on the partition key; optionally
    a sort-key condition with `= < <= > >= BETWEEN begins_with`.
  - **get**: `key={…}`, the API's typed `Key`, with every key attribute.
  - **scan**: nothing.

```text
@ap Get a user's profile and orders -> AppTable PK = :u  values={":u": {"S": "USER#1"}}
@ap Look up a user by email        -> GSI1 GSI1PK = :e  values={":e": {"S": "EMAIL#ada"}}
@ap List a tenant's users          -> SaasTable PK = :t AND begins_with(SK, :u)  values={":t": {"S": "TENANT#acme"}, ":u": {"S": "USER#"}}
@ap Open orders for a tenant+region -> ByRegion tenant = :t AND #r = :r AND #s = :s  names={"#r": "region", "#s": "status"}  values={":t": {"S": "acme"}, ":r": {"S": "us"}, ":s": {"S": "open"}}
@ap Get an event                   -> EventsTable get key={"PK": {"S": "EVENT#reinvent"}, "SK": {"S": "META"}}
@ap Get a user's notification settings by type
```

The key condition is checked by ExtendDB against the index's keys when the
pattern runs, so a broken rule shows DynamoDB's own error. The old forms
(`PK=USER#1 SK begins_with ORDER#`, or `:u=USER#1` pairs) are no longer read; the
editor points you at
the new one.

The last line declares a pattern with **no index yet**: a coverage gap that the
app surfaces. See [Access-pattern coverage](/access-patterns) for how each
pattern is graded by actually running its query.

## Item lines: a put (and updates)

```text
<label>: <attr>=<value>  <attr>=<value>  …
```

- The **label** before the colon is the item's **stable id**. A pin follows the
  label across steps, so repeating a label refers to the _same_ item.
- Attributes are `key=value`, separated by spaces. **Values may contain spaces**
  a value runs until the next ` key=` or the end of the line, so no quoting is
  needed:

  ```text
  u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  email=ada@analytical.io
  ```

- An item must carry its base key (its `PK`, and `SK` too on a composite table)
  or it won't appear: you get a warning: _"item … is missing its key … it won't
  appear."_

### Repeated label = update

A repeated label with the **same base key** is a **put that overwrites** the
prior item, an update:

```text
o1: PK=USER#1  SK=ORDER#1  status=pending
o1: PK=USER#1  SK=ORDER#1  status=shipped     # same key -> a put (update)
```

### Repeated label with a NEW base key = an atomic transact

A repeated label whose **base key changed** is a key change. DynamoDB can't
mutate a primary key in place, so Keyway emits it as an **atomic delete-old +
put-new** (`TransactWriteItems`):

```text
o1: PK=USER#1  SK=ORDER#1  status=shipped
o1: PK=USER#2  SK=ORDER#1  status=shipped     # new key -> atomic transact (delete+put)
```

This is why a key change is billed differently. See [The cost model](/cost).

## Delete lines

Remove an item by its label. Three spellings, all equivalent:

```text
delete o1
del o1
-o1
```

## `@if`: a conditional write

End a put or delete line with `@if` and a real DynamoDB `ConditionExpression`.
The write applies only if the condition holds against the item's **current**
state; otherwise it's rejected, nothing changes, and the failed check is still
billed (see [The cost model](/cost)).

```text
u1: PK=USER#1  SK=PROFILE  name=Ada  @if attribute_not_exists(PK)
o1: PK=USER#1  SK=ORDER#1  status=shipped  @if #s = :p  names={"#s": "status"}  values={":p": {"S": "pending"}}
delete o1  @if #s = :s  names={"#s": "status"}  values={":s": {"S": "shipped"}}
```

As in the API, names and values live outside the expression. After the
expression, give them as JSON, exactly as you'd pass them to the CLI or an SDK:

- `names={"#s": "status"}` is `ExpressionAttributeNames`. You need a `#name`
  for an attribute whose name is a reserved word (`status`, `name`, `date`, …)
  or has special characters.
- `values={":p": {"S": "pending"}}` is `ExpressionAttributeValues`. Every value
  is typed: `{"S": "…"}` for a String, `{"N": "42"}` for a Number. Types matter:
  DynamoDB compares by type, so `{"S": "42"}` never matches the Number `42`.

The expression is parsed, validated, and evaluated by
[ExtendDB](https://github.com/ExtendDB/extenddb)'s `extenddb-core`, compiled to
WebAssembly and running in your browser. So the editor reports DynamoDB's own
errors: a reserved word without a `#name`, a placeholder that's undefined or
never used, bad syntax. A line with an invalid condition is a
`ValidationException`: it never writes.

::: tip `status = pending` compares two attributes
In DynamoDB, a bare word on the right of a comparison is an attribute name, not
a value. The editor warns when it sees one; use a placeholder,
`#s = :p  values={":p": {"S": "pending"}}`.
:::

## `@transact … @end`: several writes, all or nothing

Wrap writes in `@transact` and `@end` to send them as one `TransactWriteItems`.
The block is **one step**: every write lands together, or none does.

```text
# place an order: create it, check the stock, empty the cart
@transact
o1: PK=USER#1  SK=ORDER#1  status=new  @if attribute_not_exists(PK)
check p1  @if stock >= :n  values={":n": {"N": "1"}}
delete cart1
@end
```

- Inside a block you can put items, `delete` them, and `check` them. A
  `check label @if …` is a `ConditionCheck`: it writes nothing, but its
  condition must hold.
- Every `@if` in the block is checked against the table **before** the
  transaction. If any one fails, the whole transaction is cancelled
  (`TransactionCanceledException`): nothing is written, and the attempt is
  still billed.
- Each action is billed at the transactional rate, 2 WCU per KB, a `check`
  included. GSI maintenance is billed as usual. See [The cost model](/cost).
- As in DynamoDB, a transaction can't touch the same item twice
  (`ValidationException`) and holds at most 100 actions. Blocks don't nest.
- A comment directly above `@transact` narrates the step.

## Comments and narration

- Lines starting with `#` or `//` are comments. Blank lines are ignored.
- A comment **directly above** an op (no blank line between them) becomes that
  step's **narration**. A blank line clears the pending comment, so header and
  section comments stay silent.

```text
# ada follows alan. GSI1 flips it so you can query alan's followers.
f1: PK=USER#ada  SK=FOLLOWS#alan  GSI1PK=USER#alan  GSI1SK=FOLLOWER#ada  _type=follow
```

Here the comment narrates the `f1` step. Put a blank line between a comment and a
line to keep it a silent header.

## The `_type` entity tag

`_type` is a reserved attribute that tags an item's **entity type** (facet). The
engine treats it like any other attribute, but the authoring layer reads it to
group items and derive **per-type templates**, so typing `order` on a fresh
line can scaffold a whole row with that entity's usual attributes (see
[Editor & autocomplete](/editor)). The schema is _inferred from the data_, never
declared separately, so it can't drift from what's actually in the model.

```text
u1: PK=USER#1  SK=PROFILE  name=Ada  _type=user-profile
o1: PK=USER#1  SK=ORDER#1  total=42  status=pending  _type=order
```

Defined in [`src/model/entities.ts`](https://github.com/); the tag name is
`_type`.
