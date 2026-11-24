import type { Expression, IndexSpec, Item } from "./types";
import { keyOf, pkAttrs, skAttrs } from "./engine";
import { evaluateCompiled, validateKeyCompiled } from "./extenddb";
import { itemSize, rcu } from "./itemsize";
import type { ReadMode } from "./itemsize";

export interface QuerySpec {
  op: "get" | "query" | "scan";
  /** get: the Key, a value per partition-key attribute. */
  pk: string[];
  /** get: the Key, a value per sort-key attribute. */
  sk: string[];
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
    const given = [...spec.pk, ...spec.sk];
    const missing = [...pkAttrs(index), ...skAttrs(index)].filter((_, i) => !given[i]);
    return missing.length
      ? `The provided key element does not match the schema: GetItem needs ${missing.join(", ")}`
      : null;
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
export function runQuery(state: Map<string, Item>, index: IndexSpec, spec: QuerySpec): QueryResult {
  const error = validate(index, spec);
  if (error) return { scanned: 0, bytes: 0, items: [], rcu: 0, error };

  const mode: ReadMode = spec.consistent ? "strong" : "eventual";
  const inIndex = (it: Item) => keyOf(it, index) !== null;

  if (spec.op === "get") {
    const pks = pkAttrs(index);
    const sks = skAttrs(index);
    const found = [...state.values()].find(
      (it) =>
        inIndex(it) &&
        pks.every((a, i) => it.attrs[a] === spec.pk[i]) &&
        sks.every((a, i) => it.attrs[a] === spec.sk[i]),
    );
    const bytes = found ? itemSize(found) : 0;
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
  const items = filter ? read.filter((it) => evaluateCompiled(filter, it, "filter")) : read;

  // Query/Scan RCU is the CUMULATIVE size of all items read, rounded once.
  const bytes = read.reduce((n, it) => n + itemSize(it), 0);
  return {
    scanned: read.length,
    bytes,
    items,
    rcu: rcu(bytes, mode),
    error: null,
  };
}
