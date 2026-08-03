import type { Item } from "../engine/types";

/**
 * The reserved attribute that tags an item's entity type (facet). It's an
 * ordinary attribute (the engine treats it like any other) but the authoring
 * layer reads it to derive per-type templates. Convention borrowed from
 * real single-table designs, which stash an "entity type" attribute on rows.
 */
export const TYPE_ATTR = "_type";

export interface EntityTemplate {
  type: string;
  /** Attribute names seen across items of this type (excluding _type), ordered
   *  base-keys-first then first-seen. This is the reuse template. */
  attrs: string[];
  count: number;
}

/**
 * Derive entity templates from a set of items: group by `_type`, union their
 * attributes. Pure: the schema is inferred from the data, never declared
 * separately, so it can't drift from what's actually in the model.
 */
export function deriveEntities(items: Iterable<Item>, lead: string[] = []): EntityTemplate[] {
  const acc = new Map<string, { attrs: string[]; seen: Set<string>; count: number }>();

  for (const item of items) {
    const type = item.attrs[TYPE_ATTR];
    if (!type) continue;
    let e = acc.get(type);
    if (!e) {
      e = { attrs: [], seen: new Set(), count: 0 };
      acc.set(type, e);
    }
    e.count++;
    for (const k of Object.keys(item.attrs)) {
      if (k === TYPE_ATTR || e.seen.has(k)) continue;
      e.seen.add(k);
      e.attrs.push(k);
    }
  }

  const leadSet = new Set(lead);
  return [...acc.entries()].map(([type, e]) => {
    const front = lead.filter((k) => e.seen.has(k));
    const rest = e.attrs.filter((k) => !leadSet.has(k));
    return { type, attrs: [...front, ...rest], count: e.count };
  });
}

/** Every attribute name in the model (excluding _type): for name completion. */
export function allAttrNames(items: Iterable<Item>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const item of items) {
    for (const k of Object.keys(item.attrs)) {
      if (k === TYPE_ATTR || seen.has(k)) continue;
      seen.add(k);
      order.push(k);
    }
  }
  return order;
}
