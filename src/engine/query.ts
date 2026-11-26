import type { Expression, IndexSpec, Item } from "./types";
import { keyOf, pkAttrs, projectItem, skAttrs } from "./engine";
import { evaluateCompiled, toAttributeValue, validateKeyCompiled } from "./extenddb";
import type { AttributeValue } from "./extenddb";
import { itemSize, rcu } from "./itemsize";
import type { ReadMode } from "./itemsize";

export interface QuerySpec {
  op: "get" | "query" | "scan";
  /** get: the `Key`, a typed value per key attribute, as the API takes it:
   *  `{"PK": {"S": "ORDER#1"}, "SK": {"S": "META"}}`. */
  getKey: Record<string, AttributeValue> | null;
  /** query: a real KeyConditionExpression (see `parseExpression`), checked
   *  against the index's key schema and matched by ExtendDB. */
  key: Expression | null;
  /** A real FilterExpression (see `parseExpression`), applied AFTER the read
   *  by ExtendDB, so it trims results but not cost. null = no filter. */
  filter: Expression | null;
  /** Strong (1 RCU / 4KB) vs eventually consistent (0.5 RCU / 4KB). */
  consistent: boolean;
}

export interface QueryResult {
  /** Items DynamoDB actually reads: this is what you're charged for. */
  scanned: number;
  /** Cumulative bytes read (drives the RCU). */
  bytes: number;
  /** Items returned to you (scanned minus filtered-out). */
  items: Item[];
  rcu: number;
  /** Which query rule (if any) the spec violates, the teaching guardrail. */
  error: string | null;
}

/**
 * Which read rule (if any) the spec breaks, the teaching guardrail. A GetItem
 * needs the full primary key; a Query's KeyConditionExpression is checked by
 * ExtendDB against the index's key schema: equality on every partition key,
 * at most a range on the last sort key given, no non-key attributes.
 */
export function validate(index: IndexSpec, spec: QuerySpec): string | null {
  if (spec.op === "scan") return null;
  if (spec.op === "get") {
    // DynamoDB's message when the Key isn't exactly the table's key attributes.
    const schemaMismatch = "The provided key element does not match the schema";
    const attrs = [...pkAttrs(index), ...skAttrs(index)];
    const key = spec.getKey ?? {};
    const missing = attrs.filter((a) => !(a in key));
    const extra = Object.keys(key).filter((a) => !attrs.includes(a));
    if (missing.length) return `${schemaMismatch}: the Key needs ${missing.join(", ")}`;
    if (extra.length) return `${schemaMismatch}: ${extra.join(", ")} isn't a key attribute`;
    const empty = attrs.find((a) => Object.values(key[a] ?? {})[0] === "");
    if (empty) return `${empty} is empty: fill in its value`;
    return null;
  }
  if (!spec.key) return "a Query needs a KeyConditionExpression";
  return validateKeyCompiled(spec.key, pkAttrs(index), skAttrs(index));
}

/**
 * Run a read against the folded state through an index. Pure.
 *
 * - **get**: reads exactly one item by full key; costs 1 read whether or not it
 *   exists.
 * - **query**: reads the items matching the KeyConditionExpression (partition
 *   equality + the sort-key condition). A filter trims what's *returned* but not
 *   what's read.
 * - **scan**: reads EVERY item in the index, the expensive one; a filter still
 *   doesn't reduce the read.
 */
export function runQuery(
  state: Map<string, Item>,
  index: IndexSpec,
  spec: QuerySpec,
  /** The base table. A read on a GSI is billed by its PROJECTED entries (a
   *  KEYS_ONLY index reads less), as ExtendDB meters it; omit for the base. */
  base: IndexSpec = index,
): QueryResult {
  const error = validate(index, spec);
  if (error) return { scanned: 0, bytes: 0, items: [], rcu: 0, error };

  const mode: ReadMode = spec.consistent ? "strong" : "eventual";
  // On a GSI, DynamoDB reads the index ENTRY: only its projected attributes
  // exist there, for the read cost and for the filter alike.
  const entry = (it: Item) => (index.name === base.name ? it : projectItem(it, index, base));
  const readSize = (it: Item) => itemSize(entry(it));
  const inIndex = (it: Item) => keyOf(it, index) !== null;

  if (spec.op === "get") {
    // Match by type AND value, as DynamoDB does: {"S": "7"} isn't {"N": "7"}.
    const key = spec.getKey!;
    const same = (a: AttributeValue | undefined, b: AttributeValue | undefined) =>
      JSON.stringify(a) === JSON.stringify(b);
    const found = [...state.values()].find(
      (it) =>
        inIndex(it) &&
        Object.keys(key).every((a) => a in it.attrs && same(toAttributeValue(it.attrs[a]), key[a])),
    );
    const bytes = found ? readSize(found) : 0;
    return {
      scanned: 1, // a GetItem is charged even on a miss
      bytes,
      items: found ? [found] : [],
      rcu: rcu(bytes, mode),
      error: null,
    };
  }

  let read: Item[];
  if (spec.op === "scan") {
    read = [...state.values()].filter(inIndex);
  } else {
    const key = spec.key!; // validate() guarantees it
    read = [...state.values()].filter((it) => inIndex(it) && evaluateCompiled(key, it, "key"));
  }

  const filter = spec.filter;
  const items = filter ? read.filter((it) => evaluateCompiled(filter, entry(it), "filter")) : read;

  // Query/Scan RCU is the CUMULATIVE size of all items read, rounded once.
  const bytes = read.reduce((n, it) => n + readSize(it), 0);
  return {
    scanned: read.length,
    bytes,
    items,
    rcu: rcu(bytes, mode),
    error: null,
  };
}
