# Access-pattern coverage

Declaring access patterns with `@ap` gives Keyway something to check. It answers
the real question (_"can my design serve all of its access patterns?"_) by
**building each pattern's declared query and running it against the finished
model**, then grading the result. The logic is in
[`src/model/coverage.ts`](https://github.com/tebanieo/Keyway/blob/main/src/model/coverage.ts).

This is stronger than "does the named index exist?". Because the query actually
runs, an unserved pattern tells you _why_, and an invalid one surfaces the exact
key rule it broke.

## How a pattern becomes a runnable query

For each `@ap … -> Index [op] [key]`:

1. The named index is looked up.
2. The key becomes the real request for that index (`buildSpec`):
   - `scan` needs nothing.
   - `get` maps the `attr=value` pairs onto the index's key attributes (the
     `Key`).
   - `query` takes the `KeyConditionExpression`, which
     [ExtendDB](https://github.com/ExtendDB/extenddb) validates against the
     index's key schema: equality on every partition key, at most a range on
     the last sort key given, no non-key attributes, no reserved words without
     a `#name`.
3. The spec runs through the same `runQuery` the query panel uses, against the
   folded state.

A rule broken in step 2 makes the pattern `invalid`, with DynamoDB's message,
e.g. _"Query condition missed key schema element: SK"_.

## The six statuses

| Status       | Symbol | Meaning                                                                                                           |
| ------------ | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `served`     | ✓      | the query is valid **and returns ≥ 1 item**                                                                       |
| `empty`      | ⚠      | valid query, but **no item matches**: the model can't answer it yet                                               |
| `invalid`    | ⚠      | the key conditions **break a query rule** (missing PK, range on a non-last SK, a non-key attr): the teaching case |
| `assigned`   | ~      | an index is named but **no key condition** was given to verify                                                    |
| `no-index`   | ✗      | names an index that **isn't defined**                                                                             |
| `unassigned` | ✗      | **no index named at all** (`-> Index` is missing)                                                                 |

Only `served` counts as truly covered (`isServed`). Each result also reports
`returned` (items after filter) and `scanned` (items charged), so a pattern that
"works" but scans the whole table is visible as such.

## Examples

```text
@ap Look up a user by email -> GSI1 GSI1PK = :e  :e=EMAIL#ada@analytical.io
#   -> served: the GSI1 partition holds the profile row.

@ap List pending orders -> GSI1 GSI1PK = :s  :s=STATUS#pending
#   -> served while pending orders exist; becomes empty once they all ship.

@ap Get a user's notification settings by type
#   -> unassigned: no `-> Index` yet, a coverage gap the app highlights.

@ap Open orders -> ByRegion tenant = :t AND #s = :s  #s=status :t=acme :s=open
#   -> invalid: ByRegion's partition key is (tenant, region), and region has no
#      equality. DynamoDB's message names the missing attribute.
```

Because coverage runs the _actual_ query, editing your data changes the verdict
live: ship the last pending order and "List pending orders" flips from `served`
to `empty`. That's the point: the spec is checked against the real model, not
against your intentions. See [Filters & query conditions](/filters) for the
key-rule details the `invalid` status enforces.
