# Filters & query conditions

Keyway has two distinct places where you constrain a read, and it's worth keeping
them apart:

1. **Key conditions** shape *what a Query reads* — they run on the index's keys
   and are restricted to what a real DynamoDB Query allows.
2. **Filter expressions** run *after* the read to trim what's returned.

The filter language lives in [`src/engine/filter.ts`](https://github.com/); the
query key rules in [`src/engine/query.ts`](https://github.com/).

## Filters run AFTER the read

::: warning The teaching point
A filter **does not reduce a query's read cost.** DynamoDB reads the items the
key condition selects, charges you for all of them, and *then* drops the ones the
filter rejects. In the query result you'll see `scanned` (what you paid for) stay
the same while the returned items shrink.
:::

In the engine this is literal: the query reads the matching items, computes cost
from their **cumulative** size, and only then applies the filter to decide what
to *return*:

```ts
const items = spec.filter ? read.filter((it) => evalFilter(spec.filter, it)) : read;
const bytes = read.reduce((n, it) => n + itemSize(it), 0);   // cost = what was READ
return { scanned: read.length, items, rcu: rcu(bytes, mode), … };
```

Use filters to express intent and see results; use **key design** to control
cost.

## Filter grammar

Values are written **inline** — there is no `:placeholder` / `#name` indirection.
The **left** side of a comparison is an attribute path; the **right** side is a
literal. Quote a value if it contains spaces:

```text
status = shipped
name = "Ada Lovelace"
```

### Comparators

```text
=   <>   <   <=   >   >=
```

Numeric-looking operands compare numerically; otherwise they compare as strings.
A missing attribute makes a comparison false.

### BETWEEN and IN

```text
total between 10 and 100
tier in (vip, general, comp)
```

### Boolean logic and grouping

```text
AND   OR   NOT   ( … )
```

`AND` / `OR` / `NOT` are case-insensitive. Precedence, highest to lowest:

1. `( … )` and functions
2. `NOT`
3. `AND`
4. `OR`

So `a = 1 OR b = 2 AND c = 3` parses as `a = 1 OR (b = 2 AND c = 3)`. Parenthesize
to override.

### Functions

```text
attribute_exists(attr)
attribute_not_exists(attr)
attribute_type(attr, S)          # S or N (see note)
begins_with(attr, prefix)
contains(attr, substring)
size(attr)                       # usable on either side of a comparison
```

- `attribute_exists` / `attribute_not_exists` test presence. Reads are
  own-property only, so inherited names like `constructor` never masquerade as
  attributes.
- `attribute_type` — since the model is currently all strings, a value is
  reported as `N` if it looks numeric, else `S` (real N/S/B typing is
  backlogged). This keeps typing consistent with how comparisons order values.
- `size(attr)` resolves to the string length and can appear on either side, e.g.
  `size(name) > 10`.

Examples:

```text
attribute_exists(GSI1PK) AND status <> cancelled
begins_with(SK, ORDER#) AND total between 20 and 100
NOT contains(tags, archived)
```

## Query sort-key conditions are a restricted set

A Query's key condition is not the free filter grammar — it mirrors DynamoDB's
real rules (enforced in `validate()` and `runQuery()`):

- The **partition key** must be **equality** (`=`) for **every** partition
  attribute. (A multi-key GSI needs an equality value for each pk attr.)
- A **sort-key** condition may use only:

  ```text
  =   begins_with   <   <=   >   >=   between
  ```

- On a **multi-key** sort key, only the **last supplied** sort attribute may use
  a range — every earlier sort attribute must be `=`. You also can't skip a sort
  attribute; conditions apply as a left prefix.

Breaking a rule doesn't silently misbehave — the query returns an error that
names the rule, e.g. *"only the last sort key (date) can use a range; status must
be `=`"*. That error is exactly what drives the `invalid` status in
[Access-pattern coverage](/access-patterns).

See [The cost model](/cost) for the multi-key query rules in the context of what
each read costs.
