# Filters & query conditions

Keyway has two distinct places where you constrain a read, and they are not
interchangeable:

1. **Key conditions** shape _what a Query reads_: they run on the index's keys
   and are restricted to what a real DynamoDB Query allows.
2. **Filter expressions** run _after_ the read to trim what's returned.

Filters are real DynamoDB `FilterExpression`s, parsed, validated, and evaluated
by [ExtendDB](https://github.com/ExtendDB/extenddb)'s expression engine
(compiled to WebAssembly, running in your browser). The query key rules live in
[`src/engine/query.ts`](https://github.com/tebanieo/Keyway/blob/main/src/engine/query.ts).

## Filters run AFTER the read

::: warning The teaching point
A filter **does not reduce a query's read cost.** DynamoDB reads the items the
key condition selects, charges you for all of them, and _then_ drops the ones the
filter rejects. In the query result you'll see `scanned` (what you paid for) stay
the same while the returned items shrink.
:::

In the engine this is literal: the query reads the matching items, computes cost
from their **cumulative** size, and only then applies the filter to decide what
to _return_:

```ts
const items = filter ? read.filter((it) => evaluateCompiled(filter, it, "filter")) : read;
const bytes = read.reduce((n, it) => n + itemSize(it), 0);   // cost = what was READ
return { scanned: read.length, items, rcu: rcu(bytes, mode), … };
```

Use filters to express intent and see results; use **key design** to control
cost.

## The Query panel is the API request

The **Read / Query** panel takes exactly what the API (and the AWS CLI, and the
SDKs) take, one field per parameter:

| Field                       | What goes in it                                                |
| --------------------------- | -------------------------------------------------------------- |
| `Key` (GetItem)             | the typed key: `{"PK": {"S": "ORDER#1"}, "SK": {"S": "META"}}` |
| `KeyConditionExpression`    | `PK = :pk AND begins_with(SK, :sk)`                            |
| `FilterExpression`          | optional: `#s = :p AND size(#n) > :len`                        |
| `ExpressionAttributeNames`  | `{"#s": "status", "#n": "name"}`                               |
| `ExpressionAttributeValues` | `{":pk": {"S": "ORDER#1"}, ":len": {"N": "5"}}`                |

The key condition and the filter share the names and values, as in the API, and
every entry must be used by one of them. Under the form, the panel shows the
matching `aws dynamodb query` / `scan` / `get-item` command, live, with a copy
button.

`#names` are needed for reserved words (`status`, `name`, `date`, …) and special
characters. Values are typed: `{"S": "…"}` for a String, `{"N": "…"}` for a
Number.

The whole DynamoDB grammar works: comparators, `BETWEEN`, `IN`, `AND`/`OR`/`NOT`
with parentheses, and the functions (`attribute_exists`, `attribute_not_exists`,
`attribute_type`, `begins_with`, `contains`, `size`). Errors are DynamoDB's
own, labelled `Invalid FilterExpression`: a reserved word without a `#name`, an
undefined or unused placeholder, a `begins_with` on a Number.

::: tip `status = pending` compares two attributes
A bare word on the right of a comparison is an attribute name, not a value. The
panel warns when it sees one; use a placeholder (`#s = :p`, with
`{":p": {"S": "pending"}}` in the values).
:::

## Types come from your table

Keyway attributes are written as text, so Keyway reads their types from the
table: an attribute whose every value is a plain number (`42`, `-1.5`; no
leading zeros, at most 38 digits) holds Numbers (`N`); anything else (`007`,
`v2`) holds Strings (`S`). The panes sort Number keys numerically, as DynamoDB
does, and the panel uses these types to help:

- The templates and sort-key buttons type each value from the table, e.g.
  `{":sk": {"N": ""}}` when the sort key holds Numbers.
- When a value's type can't match what the table holds, the panel warns, e.g.
  _"SK holds Numbers (N) in this table, but :sk is a String (S): DynamoDB
  compares by type, so it won't match"_. Coverage says the same for an `@ap`
  that finds nothing for that reason.

::: warning Not checked yet
A real Query refuses a filter on the index's own key attributes ("Filter
Expression can only contain non-primary key attributes"). ExtendDB doesn't
enforce that for Query yet, so Keyway doesn't either; put key constraints in the
key condition.
:::

## Query sort-key conditions are a restricted set

A Query's `KeyConditionExpression` isn't the filter grammar: it mirrors
DynamoDB's real rules, checked by ExtendDB against the index's keys. The panel
pre-fills one for the chosen index (`PK = :pk`, with `{":pk": {"S": ""}}` to fill
in), and has a button per sort-key operator that writes the condition for you:
`=`, `<`, `<=`, `>`, `>=`, `BETWEEN` (both ends included), and `begins_with`
(Strings only, e.g. every `ORDER#…`). The rules:

- The **partition key** must be **equality** (`=`) for **every** partition
  attribute. (A multi-key GSI needs an equality value for each pk attr.)
- A **sort-key** condition may use only:

  ```text
  =   <   <=   >   >=   BETWEEN   begins_with
  ```

- On a **multi-key** sort key, only the **last supplied** sort attribute may use
  a range: every earlier sort attribute must be `=`. You also can't skip a sort
  attribute; conditions apply as a left prefix.
- Only `AND` joins the clauses: no `OR`, no `NOT`, no other functions.

Breaking a rule doesn't silently misbehave: you get DynamoDB's error, e.g.
_"Query condition missed key schema element: SK"_. That error is exactly what
drives the `invalid` status in [Access-pattern coverage](/access-patterns).

GetItem takes the `Key` instead: a value for every key attribute. It has no
FilterExpression, so the panel hides the filter box for it.

See [The cost model](/cost) for the multi-key query rules in the context of what
each read costs.
