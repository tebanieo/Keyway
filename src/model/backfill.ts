import type { IndexSpec, Item, Op } from "../engine/types";
import { TYPE_ATTR } from "./entities";

export interface Backfill {
  attr: string;
  type: string;
  /** The value to copy onto the other items of this type. */
  value: string;
  targets: Item[];
}

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

/**
 * If the latest op added a new (non-key, non-_type) attribute to a typed item,
 * and other live items of that same entity type lack it, suggest propagating it
 * — the "add discount to the other two orders?" prompt.
 *
 * Pure and derived from the op log, so it fires whether the edit came from the
 * grid or the text editor. Returns the first such attribute, or null.
 */
export function computeBackfill(
  prev: Map<string, Item>,
  cur: Map<string, Item>,
  op: Op | undefined,
  baseIndex: IndexSpec,
): Backfill | null {
  const item = putItemOf(op);
  if (!item) return null;
  const type = item.attrs[TYPE_ATTR];
  if (!type) return null;

  let prevItem: Item | undefined;
  for (const it of prev.values()) {
    if (it.id === item.id) {
      prevItem = it;
      break;
    }
  }
  if (!prevItem) return null; // brand-new item, not an attribute addition

  const skip = new Set(
    [TYPE_ATTR, baseIndex.pk, baseIndex.sk].filter((k): k is string => Boolean(k)),
  );
  const added = Object.keys(item.attrs).filter(
    (k) => !skip.has(k) && item.attrs[k] !== "" && !(k in prevItem!.attrs),
  );

  for (const attr of added) {
    const targets = [...cur.values()].filter(
      (i) => i.id !== item.id && i.attrs[TYPE_ATTR] === type && !(attr in i.attrs),
    );
    if (targets.length) return { attr, type, value: item.attrs[attr], targets };
  }
  return null;
}
