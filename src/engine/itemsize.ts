import { sizeOf } from "./extenddb";
import type { Item } from "./types";

/**
 * Real DynamoDB item size and the capacity units it drives. Pure.
 *
 * The size comes from ExtendDB's `item_size_bytes`, measured against the
 * service: Σ over attributes of (UTF-8 bytes of the NAME + size of the VALUE).
 * A String (S) is its UTF-8 length; a Number (N) is sized by its significant
 * digits, `1 + ceil(int digits / 2) + ceil(fraction digits / 2)` (+1 if
 * negative), so `2024` is 3 bytes, not 4. Keyway sends a canonical number as
 * N (see `number.ts`), the same typing conditions and filters use. The 100-byte per-item
 * overhead in the docs is *storage* overhead, not capacity, so it's excluded.
 */

/** The capacity-relevant size of an item, in bytes. */
export function itemSize(item: Item): number {
  return sizeOf(item);
}

/** DynamoDB's 400 KB hard item-size limit. */
export const MAX_ITEM_BYTES = 400 * 1024;

/**
 * Write capacity units for a single item write: 1 WCU per 1 KB (rounded up,
 * min 1); transactional writes cost double. Same as ExtendDB's
 * `write_capacity_units`.
 */
export function wcu(bytes: number, transactional = false): number {
  const units = Math.max(1, Math.ceil(bytes / 1024));
  return transactional ? units * 2 : units;
}

export type ReadMode = "eventual" | "strong" | "transactional";

/**
 * Read capacity units for a given number of bytes read (ExtendDB's
 * `read_capacity_units`): 1 RCU per 4 KB
 * (rounded up, min 1) for strongly-consistent reads; eventually-consistent is
 * half; transactional is double. For Query/Scan, pass the CUMULATIVE size of
 * all items read (DynamoDB rounds the total once, not per item).
 */
export function rcu(bytes: number, mode: ReadMode = "eventual"): number {
  const units = Math.max(1, Math.ceil(bytes / 4096));
  const mult = mode === "strong" ? 1 : mode === "transactional" ? 2 : 0.5;
  return units * mult;
}
