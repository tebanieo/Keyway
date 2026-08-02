import type { Condition, IndexSpec, Item, Op, Partition, View, WriteAction } from "./types";
import { evalFilter } from "./filter";

/**
 * Separator joining pk and sk into a composite key string. A NUL control
 * character (never a space or "#") so it can never collide with real key
 * material — DynamoDB keys routinely contain both spaces and "#".
 */
const KEY_SEP = String.fromCharCode(0);
/** Visible separator for a multi-attribute partition/sort value ( · ). */
const DISPLAY_SEP = String.fromCharCode(32, 183, 32);

/** All partition-key attributes of an index (a multi-key GSI has up to 4). */
export function pkAttrs(index: IndexSpec): string[] {
  return index.pks ?? [index.pk];
}

/** All sort-key attributes of an index (empty if the index has no sort key). */
export function skAttrs(index: IndexSpec): string[] {
  return index.sks ?? (index.sk ? [index.sk] : []);
}

/**
 * Order items within a partition: by every sort attribute in turn (multi-key
 * safe), then by id as a stable tie-break. Shared by `project` and the diff so
 * the two can never disagree on row order.
 */
export function bySortThenId(index: IndexSpec): (a: Item, b: Item) => number {
  const sks = skAttrs(index);
  return (a, b) => {
    for (const attr of sks) {
      const va = a.attrs[attr] ?? "";
      const vb = b.attrs[attr] ?? "";
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/** Values of the given attributes, or null if any is missing/empty (sparse). */
function values(item: Item, attrs: string[]): string[] | null {
  const out: string[] = [];
  for (const a of attrs) {
    const v = item.attrs[a];
    if (v === undefined || v === "") return null;
    out.push(v);
  }
  return out;
}

/**
 * Compute an item's full key string under an index, or `null` if it doesn't
 * belong (missing any partition- or sort-key attribute). `null` is how sparse
 * indexes fall out for free. Handles multi-key GSIs (several pk/sk attributes).
 */
export function keyOf(item: Item, index: IndexSpec): string | null {
  const pk = values(item, pkAttrs(index));
  if (pk === null) return null;
  const sk = values(item, skAttrs(index));
  if (sk === null) return null; // an sk attribute is required but missing
  return [...pk, ...sk].join(KEY_SEP);
}

/** The display value of an item's partition under an index (joins multi keys). */
export function partitionLabel(item: Item, index: IndexSpec): string {
  return pkAttrs(index)
    .map((a) => item.attrs[a] ?? "")
    .join(DISPLAY_SEP);
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
/** Find the row carrying a given stable id, or undefined. */
export function findById(state: Map<string, Item>, id: string): Item | undefined {
  for (const it of state.values()) if (it.id === id) return it;
  return undefined;
}

/**
 * Whether a write's guard holds against the item currently at its target. A
 * missing item is evaluated as an empty item, so `attribute_not_exists(PK)` is
 * true (create-if-not-exists) and `status=pending` is false (no item to match).
 * No condition always holds.
 */
export function conditionHolds(condition: Condition | undefined, existing: Item | null): boolean {
  if (!condition) return true;
  return evalFilter(condition.ast, existing ?? { id: "", attrs: {} });
}

/**
 * Would this op be rejected by its `@if` guard, given the state just before it?
 * A rejected op is a DynamoDB ConditionalCheckFailed: no change, but still
 * billed. Pure — used by both the cost model and the rejected-step UI.
 */
export function conditionRejected(
  prevState: Map<string, Item>,
  op: Op,
  baseIndex: IndexSpec,
): boolean {
  const fails = (action: WriteAction): boolean => {
    if (!action.condition) return false;
    let existing: Item | null;
    if (action.kind === "put") {
      const key = keyOf(action.item, baseIndex);
      existing = key !== null ? prevState.get(key) ?? null : null;
    } else {
      existing = findById(prevState, action.id) ?? null;
    }
    return !conditionHolds(action.condition, existing);
  };
  return op.kind === "transact" ? op.actions.some(fails) : fails(op);
}

/**
 * Apply one write action to a state map in place. Returns whether it applied:
 * `false` when its `@if` guard fails (a rejected write) or its base key is
 * incomplete, so a rejected write leaves state untouched — exactly as DynamoDB
 * does on a ConditionalCheckFailed.
 */
export function applyAction(
  state: Map<string, Item>,
  action: WriteAction,
  baseIndex: IndexSpec,
): boolean {
  if (action.kind === "put") {
    const key = keyOf(action.item, baseIndex);
    if (key === null) return false; // incomplete base key — not a valid row
    if (!conditionHolds(action.condition, state.get(key) ?? null)) return false;
    state.set(key, action.item);
    return true;
  }
  // delete by stable id: find and remove whichever row carries it
  for (const [key, item] of state) {
    if (item.id === action.id) {
      if (!conditionHolds(action.condition, item)) return false;
      state.delete(key);
      return true;
    }
  }
  return false;
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
export function projectItem(item: Item, index: IndexSpec, baseIndex: IndexSpec): Item {
  const proj = index.projection;
  if (proj === undefined || proj === "ALL") return item;

  const keep = new Set<string>([
    ...pkAttrs(index),
    ...skAttrs(index),
    ...pkAttrs(baseIndex),
    ...skAttrs(baseIndex),
  ]);
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
  // Group by the (possibly multi-attribute) partition value. The map key is a
  // NUL-joined tuple so it can't collide; the display label is human-readable.
  const groups = new Map<string, { pk: string; items: Item[] }>();
  const pks = pkAttrs(index);

  for (const item of state.values()) {
    if (keyOf(item, index) === null) continue; // sparse: excluded
    const groupKey = pks.map((a) => item.attrs[a]).join(KEY_SEP);
    let g = groups.get(groupKey);
    if (!g) {
      g = { pk: partitionLabel(item, index), items: [] };
      groups.set(groupKey, g);
    }
    g.items.push(projectItem(item, index, baseIndex));
  }

  const cmp = bySortThenId(index);
  const partitions: Partition[] = [];
  for (const { pk, items } of groups.values()) {
    items.sort(cmp);
    partitions.push({ pk, items });
  }

  return { index, partitions };
}
