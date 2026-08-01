import type { Item } from "./types";

/**
 * Real DynamoDB item size and the capacity units it drives — so cost stops
 * being a ≤4KB estimate and becomes exact. Pure.
 *
 * Item size = Σ over attributes of (UTF-8 bytes of the NAME + bytes of the
 * VALUE). Our model is flat and every value is a string, so each value is sized
 * as a DynamoDB String (S): its UTF-8 byte length. (Number/Binary/Set/Map sizing
 * lands if/when typed attributes do.) The 100-byte per-item overhead in the docs
 * is *storage* overhead, not capacity, so it's excluded here.
 */

const enc = new TextEncoder();

/** UTF-8 byte length of a string (not `.length`, which counts code units). */
export function utf8Len(s: string): number {
  return enc.encode(s).length;
}

/** The capacity-relevant size of an item, in bytes. */
export function itemSize(item: Item): number {
  let bytes = 0;
  for (const name of Object.keys(item.attrs)) {
    bytes += utf8Len(name) + utf8Len(item.attrs[name]);
  }
  return bytes;
}

/** DynamoDB's 400 KB hard item-size limit. */
export const MAX_ITEM_BYTES = 400 * 1024;

/**
 * Write capacity units for a single item write: 1 WCU per 1 KB (rounded up,
 * min 1); transactional writes cost double.
 */
export function wcu(bytes: number, transactional = false): number {
  const units = Math.max(1, Math.ceil(bytes / 1024));
  return transactional ? units * 2 : units;
}

export type ReadMode = "eventual" | "strong" | "transactional";

/**
 * Read capacity units for a given number of bytes read: 1 RCU per 4 KB
 * (rounded up, min 1) for strongly-consistent reads; eventually-consistent is
 * half; transactional is double. For Query/Scan, pass the CUMULATIVE size of
 * all items read (DynamoDB rounds the total once, not per item).
 */
export function rcu(bytes: number, mode: ReadMode = "eventual"): number {
  const units = Math.max(1, Math.ceil(bytes / 4096));
  const mult = mode === "strong" ? 1 : mode === "transactional" ? 2 : 0.5;
  return units * mult;
}
