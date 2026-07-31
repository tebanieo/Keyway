import type { IndexSpec, Item, Op, Partition, View, WriteAction } from "./types";

/**
 * Separator joining pk and sk into a composite key string. A NUL control
 * character (never a space or "#") so it can never collide with real key
 * material — DynamoDB keys routinely contain both spaces and "#".
 */
const KEY_SEP = String.fromCharCode(0);

/**
 * Compute an item's key string under an index, or `null` if the item does not
 * belong in that index (it lacks the pk, or lacks the sk when the index defines
 * one). `null` is how sparse indexes fall out for free: no key attribute → not
 * projected.
 */
export function keyOf(item: Item, index: IndexSpec): string | null {
  const pk = item.attrs[index.pk];
  if (pk === undefined || pk === "") return null;
  if (index.sk === undefined) return pk;
  const sk = item.attrs[index.sk];
  if (sk === undefined || sk === "") return null;
  return pk + KEY_SEP + sk;
}

/**
 * Fold the op log into current base-table state.
 *
 * Identity on the base table is the base primary key, exactly as in DynamoDB:
 * a `put` onto an occupied key overwrites (last write wins), a `delete` removes.
 * Items whose attributes don't form a complete base key are dropped — a base
 * table has no place for a keyless item.
 *
 * State preserves first-seen insertion order so downstream rendering is stable
 * and diffs are legible; partition/sort order is applied later, in `project`.
 *
 * Pure: same (ops, baseIndex) always yields the same Map.
 */
/** Apply one write action to a state map in place. */
export function applyAction(
  state: Map<string, Item>,
  action: WriteAction,
  baseIndex: IndexSpec,
): void {
  if (action.kind === "put") {
    const key = keyOf(action.item, baseIndex);
    if (key === null) return; // incomplete base key — not a valid row
    state.set(key, action.item);
  } else {
    // delete by stable id: find and remove whichever row carries it
    for (const [key, item] of state) {
      if (item.id === action.id) {
        state.delete(key);
        break;
      }
    }
  }
}

export function fold(ops: readonly Op[], baseIndex: IndexSpec): Map<string, Item> {
  const state = new Map<string, Item>();
  for (const op of ops) {
    if (op.kind === "transact") {
      // atomic bundle — apply every action, then it's one logical step
      for (const action of op.actions) applyAction(state, action, baseIndex);
    } else {
      applyAction(state, op, baseIndex);
    }
  }
  return state;
}

/**
 * Apply an index's projection to an item's visible attributes. The index's own
 * keys and the base table's keys are always kept (a GSI can always point back to
 * the base row); "ALL" keeps everything, "KEYS_ONLY" keeps only those keys, and
 * a string[] additionally keeps the listed INCLUDE attributes.
 */
function projectAttrs(item: Item, index: IndexSpec, baseIndex: IndexSpec): Item {
  const proj = index.projection;
  if (proj === undefined || proj === "ALL") return item;

  const keep = new Set<string>([index.pk, baseIndex.pk]);
  if (index.sk) keep.add(index.sk);
  if (baseIndex.sk) keep.add(baseIndex.sk);
  if (Array.isArray(proj)) for (const a of proj) keep.add(a);

  const attrs: Record<string, string> = {};
  for (const k of Object.keys(item.attrs)) {
    if (keep.has(k)) attrs[k] = item.attrs[k];
  }
  return { id: item.id, attrs };
}

/**
 * Project base-table state through an index into partitioned, sorted groups.
 *
 * - Sparse: items with no key under this index are excluded.
 * - Regrouping: items are grouped by this index's partition-key value, so a GSI
 *   reshuffles items into different partitions than the base table.
 * - Sort: within a partition, items are ordered by sort-key value (ties broken
 *   by stable id so the order is deterministic).
 * - Projection: `index.project` trims each item's visible attributes.
 *
 * Partitions are returned in first-appearance order of their pk value, which
 * keeps the layout stable as the model grows.
 *
 * Pure: same (state, index) always yields the same View.
 */
export function project(
  state: Map<string, Item>,
  index: IndexSpec,
  baseIndex: IndexSpec = index,
): View {
  const groups = new Map<string, Item[]>();

  for (const item of state.values()) {
    if (keyOf(item, index) === null) continue; // sparse: excluded
    const pkValue = item.attrs[index.pk];
    let bucket = groups.get(pkValue);
    if (!bucket) {
      bucket = [];
      groups.set(pkValue, bucket);
    }
    bucket.push(projectAttrs(item, index, baseIndex));
  }

  const partitions: Partition[] = [];
  for (const [pk, items] of groups) {
    items.sort((a, b) => {
      const sa = index.sk ? (a.attrs[index.sk] ?? "") : "";
      const sb = index.sk ? (b.attrs[index.sk] ?? "") : "";
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    partitions.push({ pk, items });
  }

  return { index, partitions };
}
