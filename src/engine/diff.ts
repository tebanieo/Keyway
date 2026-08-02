import { bySortThenId } from "./engine";
import type { IndexSpec, Item, View } from "./types";

/**
 * Classifies how each item changed between two rendered views.
 *
 * This is the whole trick behind scaling: rather than asking every element to
 * measure and animate, we ask "which items actually moved?" — and only those
 * get `layout`. An insert typically touches the inserted item plus whatever it
 * displaced within one partition, so `moved ∪ entered` stays tiny (2–3 items)
 * no matter whether the model holds 12 items or 400.
 */
export interface ViewDelta {
  /** Present in `next` but not `prev`. */
  entered: Set<string>;
  /** Present in `prev` but not `next`. */
  exited: Set<string>;
  /** Present in both, but changed partition or position within a partition. */
  moved: Set<string>;
  /** Present in both at the same partition and position. */
  stable: Set<string>;
}

interface Pos {
  pk: string;
  idx: number;
}

function positions(view: View): Map<string, Pos> {
  const map = new Map<string, Pos>();
  for (const part of view.partitions) {
    part.items.forEach((item, idx) => {
      map.set(item.id, { pk: part.pk, idx });
    });
  }
  return map;
}

export function diffViews(prev: View, next: View): ViewDelta {
  const a = positions(prev);
  const b = positions(next);

  const entered = new Set<string>();
  const exited = new Set<string>();
  const moved = new Set<string>();
  const stable = new Set<string>();

  for (const [id, pb] of b) {
    const pa = a.get(id);
    if (!pa) entered.add(id);
    else if (pa.pk !== pb.pk || pa.idx !== pb.idx) moved.add(id);
    else stable.add(id);
  }
  for (const id of a.keys()) {
    if (!b.has(id)) exited.add(id);
  }

  return { entered, exited, moved, stable };
}

/**
 * The set of item ids that should receive `layout` for this transition:
 * everything that entered or moved. Stable items render as plain static nodes,
 * which is what keeps the measurement pass O(changes), not O(model).
 */
export function animatedIds(delta: ViewDelta): Set<string> {
  return new Set([...delta.entered, ...delta.moved]);
}

/**
 * Per-row change status, git-diff style.
 *   added    — new to this partition (a fresh item, or one that moved in)
 *   removed  — left this partition (deleted, or moved out — a tombstone)
 *   modified — same partition, but a projected attribute changed
 *   same     — unchanged
 */
export type RowStatus = "added" | "removed" | "modified" | "same";

export interface DiffRow {
  item: Item;
  status: RowStatus;
}

export interface DiffPartition {
  pk: string;
  rows: DiffRow[];
}

function attrsDiffer(a: Item, b: Item): boolean {
  const keys = new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)]);
  for (const k of keys) if (a.attrs[k] !== b.attrs[k]) return true;
  return false;
}

/**
 * Render-ready diff between the previous and current view of one index.
 *
 * Crucially this is *partition-aware*: an item that changes its index key shows
 * up as `removed` from its old partition AND `added` to its new one — mirroring
 * exactly what DynamoDB does physically (delete the old projection, put a new
 * one). So on a GSI a key change reads as a red −/green + pair, while on the
 * base table the same edit is a single amber `modified` row.
 *
 * Removed rows are re-inserted as tombstones into the partition they left,
 * sorted back into their old position; a partition that emptied out entirely
 * still appears, as a ghost, so the deletion is visible.
 *
 * Pure: same (prev, curr, index) always yields the same partitions.
 */
export function diffPartitions(
  prev: View,
  curr: View,
  index: IndexSpec,
): DiffPartition[] {
  const prevPk = new Map<string, string>();
  const prevItem = new Map<string, Item>();
  for (const p of prev.partitions) {
    for (const it of p.items) {
      prevPk.set(it.id, p.pk);
      prevItem.set(it.id, it);
    }
  }
  const currPk = new Map<string, string>();
  for (const p of curr.partitions) {
    for (const it of p.items) currPk.set(it.id, p.pk);
  }

  const byPk = new Map<string, DiffRow[]>();
  const order: string[] = [];
  const bucket = (pk: string): DiffRow[] => {
    let rows = byPk.get(pk);
    if (!rows) {
      rows = [];
      byPk.set(pk, rows);
      order.push(pk);
    }
    return rows;
  };

  // Present rows: added (new or moved-in), modified, or same.
  for (const p of curr.partitions) {
    const rows = bucket(p.pk);
    for (const it of p.items) {
      const was = prevPk.get(it.id);
      let status: RowStatus;
      if (was === undefined || was !== p.pk) status = "added";
      else status = attrsDiffer(prevItem.get(it.id)!, it) ? "modified" : "same";
      rows.push({ item: it, status });
    }
  }

  // Tombstones: anything that left a partition (deleted, or moved elsewhere).
  for (const [id, pk] of prevPk) {
    if (currPk.get(id) !== pk) {
      bucket(pk).push({ item: prevItem.get(id)!, status: "removed" });
    }
  }

  // Same comparator `project` uses, so diff rows order identically (multi-key safe).
  const cmp = bySortThenId(index);
  return order.map((pk) => ({
    pk,
    rows: byPk.get(pk)!.sort((a, b) => cmp(a.item, b.item)),
  }));
}
