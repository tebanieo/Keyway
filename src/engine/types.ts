// Core domain types for the single-table model.
// Everything here is plain data — no DOM, no React, no async.

/**
 * A stored item. `id` is a stable identity that survives across index views
 * and across edits — it's what animation keys (and, later,
 * `view-transition-name`) bind to. It is deliberately independent of the
 * item's key attributes, so an item can move between partitions under a GSI
 * while the UI still follows it as the same object.
 *
 * `attrs` is the flat attribute bag. Key attributes (PK, SK, GSI1PK, ...) live
 * here alongside ordinary attributes — exactly as they do in a real item.
 */
export interface Item {
  id: string;
  attrs: Record<string, string>;
}

/**
 * Describes how one index (the base table, or a GSI) derives its keys from an
 * item's attributes. `pk`/`sk` name which attributes serve as partition/sort
 * key for this index. `project`, when set, limits which attributes the index
 * carries (KEYS_ONLY / INCLUDE / ALL in DynamoDB terms).
 */
/**
 * What a secondary index projects. "ALL" (default) copies every attribute;
 * "KEYS_ONLY" copies only keys; a string[] is INCLUDE — those extra attributes.
 * The index's own keys AND the base table's keys are always projected on top,
 * regardless of this setting (that's how DynamoDB GSIs work).
 */
export type ProjectionSpec = "ALL" | "KEYS_ONLY" | string[];

export interface IndexSpec {
  name: string;
  /** Partition key attribute (single-key). For a multi-key GSI, `pks` holds all
   *  of them and this is the first (kept for compatibility). */
  pk: string;
  /** Sort key attribute (single-key). `sks` holds all for a multi-key GSI. */
  sk?: string;
  /** Multi-key GSI partition-key attributes (up to 4). Equality-only in queries. */
  pks?: string[];
  /** Multi-key GSI sort-key attributes (up to 4). Only the last takes a range. */
  sks?: string[];
  projection?: ProjectionSpec;
}

/** A single write against the table. The atoms a transaction is built from. */
export type WriteAction =
  | { kind: "put"; item: Item }
  | { kind: "delete"; id: string };

/**
 * The op log. Folding it left-to-right yields the current table state.
 *
 * A `transact` op is a TransactWriteItems: its actions apply atomically and
 * count as ONE step. The canonical use is renaming a key — which DynamoDB can't
 * do in place — as an atomic delete-old + put-new, rather than two separate
 * (and briefly inconsistent) writes.
 */
export type Op =
  | WriteAction
  | { kind: "transact"; actions: WriteAction[] };

/** One partition (all items sharing a partition-key value) under some index. */
export interface Partition {
  /** The partition-key value shared by every item in this group. */
  pk: string;
  /** Items in this partition, sorted by their sort-key value. */
  items: Item[];
}

/** The result of projecting table state through an index. */
export interface View {
  index: IndexSpec;
  partitions: Partition[];
}
