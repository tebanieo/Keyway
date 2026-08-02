# The cost model

Keyway computes **exact** capacity units, not a rough estimate, so you can see
why a write costs what it does. The math lives in
[`src/engine/itemsize.ts`](https://github.com/) (sizes and units) and
[`src/engine/cost.ts`](https://github.com/) (per-op, per-index effects).

## Item size

An item's capacity-relevant size is the sum, over its attributes, of the **UTF-8
byte length of the name plus the value**:

```text
itemSize(item) = Σ  utf8Len(name) + utf8Len(value)
```

Notes that keep this honest:

- Bytes are counted as **UTF-8**, not JavaScript `.length` (which counts code
  units), so multi-byte characters cost their real size.
- Every value is sized as a DynamoDB **String (S)**: its UTF-8 byte length. The
  model is flat and all-strings today; Number/Binary/Set/Map sizing lands with
  typed attributes.
- The 100-byte per-item overhead from the AWS docs is _storage_ overhead, not
  capacity, so it's excluded here. The 400 KB hard item limit is tracked as
  `MAX_ITEM_BYTES`.

## Write capacity (WCU)

```text
WCU = ceil(size / 1KB) × (1 standard | 2 transactional)      # min 1
```

- 1 WCU per 1 KB, rounded up, minimum 1.
- A **transactional** write bills **double**: its base writes cost 2×.

## Read capacity (RCU)

```text
RCU = ceil(cumulativeBytes / 4KB) × (0.5 eventual | 1 strong | 2 transactional)   # units min 1
```

- 1 RCU per 4 KB, rounded up, minimum 1 _unit_.
- **Eventually consistent** reads are half; **strong** is full; **transactional**
  is double.
- For a **Query/Scan**, pass the **cumulative** size of every item read:
  DynamoDB rounds the _total_ once, not per item. This is why a filter that drops
  most rows still leaves the cost high: cost is computed from what was read, not
  what was returned (see [Filters](/filters)).

## Index effects: what a write does to each index

Every write is priced per index by its **transition**, not a snapshot. The
vocabulary (`IndexEffect`):

| Effect    | Meaning                                                                 | Writes |
| --------- | ----------------------------------------------------------------------- | ------ |
| `none`    | the write doesn't touch this index (no key before or after)             | 0      |
| `insert`  | the item enters the index for the first time                            | 1×     |
| `delete`  | the item leaves the index (a key attr removed, or the row deleted)      | 1×     |
| `update`  | the item stays put, but a _projected_ attribute changed                 | 1×     |
| `reindex` | the index **key** changed → delete the old projection **and** put a new | 2×     |

A GSI write is sized by the **projected** item, so a `KEYS_ONLY` or `INCLUDE`
index that carries less data costs less. An `update` only fires when an attribute
the index actually _projects_ changed: a `KEYS_ONLY` GSI ignores changes to
attributes it doesn't carry.

### Why a key change is a 2-write reindex

DynamoDB can't move a projected row to a new key in place. When an index key
changes, it **deletes the old projection and puts a new one**: two writes on
that index. In Keyway this is the `reindex` effect, and it's the classic cost
that bites people: flipping `GSI1PK=STATUS#pending` to `STATUS#shipped` is a
1-write update on the base table but a **2-write reindex** on GSI1.

## Transactional writes bill base at 2×

A repeated label with a **new base key** becomes an atomic
`TransactWriteItems` (a delete-old + put-new, see [the DSL](/dsl#repeated-label-with-a-new-base-key-an-atomic-transact)).
For a transact:

- **Base writes are billed at 2×** (the transactional rate). So an atomic key
  rename is `2 × (delete + put)` = **4 base WCU**: the price of doing it safely
  instead of as two racy writes.
- **GSI maintenance is billed at the standard rate even inside a transaction**,
  because index propagation is asynchronous and outside the transaction's
  guarantee.

## Multi-key GSI query rules

A native multi-key GSI has up to 4 partition and 4 sort attributes as separate
columns. When you _query_ one:

- **Every partition attribute** must be supplied with **equality**.
- **Only the last** sort attribute may take a **range**; every earlier sort
  attribute must be `=`.
- **No skipping** sort attributes: conditions apply as a left-to-right prefix.

```text
@gsi ByRegion pk=tenant,region sk=status,date

@ap Open orders for a tenant+region -> ByRegion tenant=acme region=us status=open
#   tenant= and region= are equality (both partition attrs); status= is the
#   first sort attr as equality; add `date between …` as the last, rangeable one.
```

Break a rule and the query returns a naming error (e.g. _"only the last sort key
(date) can use a range; status must be `=`"_) rather than misbehaving: the same
error that flags a pattern `invalid` under [coverage](/access-patterns).
