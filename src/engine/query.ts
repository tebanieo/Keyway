import type { IndexSpec, Item } from "./types";
import { keyOf, pkAttrs, skAttrs } from "./engine";
import { evalFilter } from "./filter";
import type { FilterNode } from "./filter";
import { itemSize, rcu } from "./itemsize";
import type { ReadMode } from "./itemsize";

/** Comparison operators usable on a sort key's last attribute, or a filter. */
export type CondOp = "=" | "begins_with" | "<" | "<=" | ">" | ">=" | "between";

export interface Cond {
  op: CondOp;
  value: string;
  value2?: string; // for "between"
}

export interface QuerySpec {
  op: "get" | "query" | "scan";
  /** Equality values for each partition-key attribute (get / query). */
  pk: string[];
  /** get: exact value per sort-key attribute. */
  sk: string[];
  /** query: a condition per sort-key attribute, left-to-right (a prefix). All
   *  but the last must be "=" — that's the multi-key sort rule. */
  skParts: Cond[];
  /** A parsed filter expression — applied AFTER the read, so it trims results
   *  but not cost. null = no filter. */
  filter: FilterNode | null;
  /** Strong (1 RCU / 4KB) vs eventually consistent (0.5 RCU / 4KB). */
  consistent: boolean;
}

export interface QueryResult {
  /** Items DynamoDB actually reads — this is what you're charged for. */
  scanned: number;
  /** Cumulative bytes read (drives the RCU). */
  bytes: number;
  /** Items returned to you (scanned minus filtered-out). */
  items: Item[];
  rcu: number;
  /** Which query rule (if any) the spec violates — the teaching guardrail. */
  error: string | null;
}

function cmp(v: string, c: Cond): boolean {
  switch (c.op) {
    case "=":
      return v === c.value;
    case "begins_with":
      return v.startsWith(c.value);
    case "<":
      return v < c.value;
    case "<=":
      return v <= c.value;
    case ">":
      return v > c.value;
    case ">=":
      return v >= c.value;
    case "between":
      return v >= c.value && v <= (c.value2 ?? c.value);
  }
}

/**
 * The multi-key query rule, validated so the tool teaches it: all partition
 * attributes need equality (implicit), and among the sort attributes only the
 * LAST supplied one may use a range — the earlier ones must be "=". You also
 * can't skip a sort attribute (the UI only offers a left prefix).
 */
export function validate(index: IndexSpec, spec: QuerySpec): string | null {
  if (spec.op === "scan") return null;
  const pks = pkAttrs(index);
  if (spec.pk.length < pks.length || spec.pk.some((v) => v === "")) {
    return `query needs an equality value for every partition key (${pks.join(", ")})`;
  }
  if (spec.op === "query") {
    const sks = skAttrs(index);
    for (let i = 0; i < spec.skParts.length; i++) {
      const isLast = i === spec.skParts.length - 1;
      if (!isLast && spec.skParts[i].op !== "=") {
        return `only the last sort key (${sks[spec.skParts.length - 1] ?? "?"}) can use a range; ${sks[i]} must be "="`;
      }
    }
  }
  return null;
}

function inPartition(item: Item, index: IndexSpec, pk: string[]): boolean {
  return pkAttrs(index).every((a, i) => item.attrs[a] === pk[i]);
}

/**
 * Run a read against the folded state through an index. Pure.
 *
 * - **get**: reads exactly one item by full key; costs 1 read whether or not it
 *   exists.
 * - **query**: reads the items matching the key condition (partition equality +
 *   the sort-key prefix). A filter trims what's *returned* but not what's read.
 * - **scan**: reads EVERY item in the index — the expensive one; a filter still
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
    const sks = skAttrs(index);
    read = [...state.values()].filter((it) => {
      if (!inIndex(it) || !inPartition(it, index, spec.pk)) return false;
      return spec.skParts.every((c, i) => sks[i] && cmp(it.attrs[sks[i]] ?? "", c));
    });
  }

  const items = spec.filter ? read.filter((it) => evalFilter(spec.filter!, it)) : read;

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
