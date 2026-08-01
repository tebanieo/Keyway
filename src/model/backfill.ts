import type { IndexSpec, Item, Op } from "../engine/types";
import { TYPE_ATTR } from "./entities";

/** The put item an op introduces (from a put, or a transact's put action). */
export function putItemOf(op: Op | undefined): Item | null {
  if (!op) return null;
  if (op.kind === "put") return op.item;
  if (op.kind === "transact") {
    const p = op.actions.find((a) => a.kind === "put");
    return p && p.kind === "put" ? p.item : null;
  }
  return null;
}

export interface Backfill {
  attr: string;
  type: string;
  /** A value to copy onto the items that lack the attribute. */
  value: string;
  targets: Item[];
}

/**
 * Detect entity-schema drift: a type where some items carry an attribute and
 * others don't. That's the "you gave one order a `discount` — add it to the
 * other two?" prompt.
 *
 * Deliberately stateless — it inspects the current model rather than trying to
 * guess which op changed, so it fires correctly whether the edit landed via the
 * grid (appends to the log) or the text editor (edits a line anywhere). Returns
 * the first drifting (type, attribute), or null. Key attributes and `_type`
 * are never considered.
 */
export function computeBackfill(
  cur: Map<string, Item>,
  baseIndex: IndexSpec,
): Backfill | null {
  const skip = new Set(
    [TYPE_ATTR, baseIndex.pk, baseIndex.sk].filter((k): k is string => Boolean(k)),
  );

  const byType = new Map<string, Item[]>();
  for (const it of cur.values()) {
    const t = it.attrs[TYPE_ATTR];
    if (!t) continue;
    let arr = byType.get(t);
    if (!arr) byType.set(t, (arr = []));
    arr.push(it);
  }

  for (const [type, items] of byType) {
    if (items.length < 2) continue;
    const firstValue = new Map<string, string>();
    const count = new Map<string, number>();
    const order: string[] = [];
    for (const it of items) {
      for (const k of Object.keys(it.attrs)) {
        if (skip.has(k)) continue;
        if (!count.has(k)) {
          order.push(k);
          firstValue.set(k, it.attrs[k]);
        }
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    for (const attr of order) {
      if ((count.get(attr) ?? 0) < items.length) {
        const targets = items.filter((i) => !(attr in i.attrs));
        return { attr, type, value: firstValue.get(attr)!, targets };
      }
    }
  }
  return null;
}
