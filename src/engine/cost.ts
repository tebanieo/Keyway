import type { IndexSpec, Item, Op } from "./types";
import {
  applyAction,
  conditionRejected,
  findById,
  keyOf,
  partitionLabel,
  pkAttrs,
  projectItem,
  skAttrs,
} from "./engine";
import { itemSize, wcu } from "./itemsize";

/**
 * What a single write does to one index.
 *   none:    the write doesn't touch this index (no key before or after)
 *   insert:  item enters the index for the first time
 *   delete:  item leaves the index (a key attribute was removed / row deleted)
 *   update:  item stays in the same index location; a projected attr changed
 *   reindex: the index KEY changed, so DynamoDB deletes the old projection and
 *             puts a new one. This is the costly case: two writes, not one.
 */
export type IndexEffect = "none" | "insert" | "delete" | "update" | "reindex";

export interface IndexCost {
  index: string;
  effect: IndexEffect;
  /** Write units this index consumes for the op. */
  writes: number;
  /** Old partition-key value, when the item left a partition. */
  from?: string;
  /** New partition-key value, when the item entered a partition. */
  to?: string;
}

export interface OpCost {
  base: "put" | "delete" | "transact";
  baseWrites: number;
  indexes: IndexCost[];
  /** True for TransactWriteItems: base writes are billed at 2×. */
  transactional: boolean;
  /** Base + every index. Each unit is ~1 WCU for an item up to 1 KB. */
  totalWrites: number;
  /** A `@if` guard failed: no change landed, but the attempt is still billed. */
  rejected?: boolean;
}

/** Does this index carry an attribute that changed between prev and next? */
function projectedChanged(prev: Item, next: Item, index: IndexSpec): boolean {
  const proj = index.projection;
  if (proj === undefined || proj === "ALL") {
    const keys = new Set([...Object.keys(prev.attrs), ...Object.keys(next.attrs)]);
    return [...keys].some((k) => prev.attrs[k] !== next.attrs[k]);
  }
  // KEYS_ONLY / INCLUDE: only the index keys and included attributes are carried
  // (base keys are identity and change only via a reindex, handled separately).
  const carried = new Set<string>([...pkAttrs(index), ...skAttrs(index)]);
  if (Array.isArray(proj)) for (const a of proj) carried.add(a);
  return [...carried].some((k) => prev.attrs[k] !== next.attrs[k]);
}

/** Cost on one index of moving an item from `prev` (maybe absent) to `next`. */
function transitionCost(
  prev: Item | null,
  next: Item,
  g: IndexSpec,
  baseIndex: IndexSpec,
): IndexCost {
  // GSI writes are sized by the PROJECTED item (KEYS_ONLY projects less → cheaper).
  const gWcu = (it: Item) => wcu(itemSize(projectItem(it, g, baseIndex)));
  const prevKey = prev ? keyOf(prev, g) : null;
  const newKey = keyOf(next, g);
  if (prevKey === null && newKey === null) {
    return { index: g.name, effect: "none", writes: 0 };
  }
  if (prevKey === null) {
    return { index: g.name, effect: "insert", writes: gWcu(next), to: partitionLabel(next, g) };
  }
  if (newKey === null) {
    return { index: g.name, effect: "delete", writes: gWcu(prev!), from: partitionLabel(prev!, g) };
  }
  if (prevKey === newKey) {
    const changed = projectedChanged(prev!, next, g);
    return {
      index: g.name,
      effect: changed ? "update" : "none",
      writes: changed ? gWcu(next) : 0,
      to: partitionLabel(next, g),
    };
  }
  return {
    index: g.name,
    effect: "reindex",
    writes: gWcu(prev!) + gWcu(next), // delete old projection + put new one
    from: partitionLabel(prev!, g),
    to: partitionLabel(next, g),
  };
}

/** Cost on one index of removing `prev` from the table. */
function removalCost(prev: Item | undefined, g: IndexSpec, baseIndex: IndexSpec): IndexCost {
  if (prev && keyOf(prev, g) !== null) {
    return {
      index: g.name,
      effect: "delete",
      writes: wcu(itemSize(projectItem(prev, g, baseIndex))),
      from: partitionLabel(prev, g),
    };
  }
  return { index: g.name, effect: "none", writes: 0 };
}

const sumWrites = (costs: IndexCost[]) => costs.reduce((n, c) => n + c.writes, 0);

/** Merge several per-action costs on the same index into one combined cost. */
function mergeIndex(name: string, parts: IndexCost[]): IndexCost {
  const writes = sumWrites(parts);
  const hasRemove = parts.some((p) => p.effect === "delete");
  const hasAdd = parts.some(
    (p) => p.effect === "insert" || p.effect === "update" || p.effect === "reindex",
  );
  const effect: IndexEffect =
    writes === 0
      ? "none"
      : hasRemove && hasAdd
        ? "reindex"
        : (parts.find((p) => p.effect !== "none")?.effect ?? "none");
  return {
    index: name,
    effect,
    writes,
    from: parts.find((p) => p.from)?.from,
    to: [...parts].reverse().find((p) => p.to)?.to,
  };
}

/**
 * Cost of applying one op against the state that precedes it.
 *
 * Index maintenance cost lives in the *transition*, not the snapshot: a put that
 * flips a GSI key is a 1-write base change but a 2-write reindex on the GSI. A
 * `transact` (TransactWriteItems) applies several actions atomically and bills
 * its BASE writes at 2×, so an atomic key rename (delete + put) is 4 base WCU,
 * the price of doing it safely instead of as two racy writes.
 *
 * GSI maintenance is billed at the standard rate even inside a transaction:
 * index propagation is asynchronous and outside the transaction's guarantee.
 *
 * Pure and deterministic.
 */
export function writeCost(
  prevState: Map<string, Item>,
  op: Op,
  baseIndex: IndexSpec,
  gsis: readonly IndexSpec[],
): OpCost {
  // A failed `@if` guard: the write never lands, so no index maintenance runs.
  // The check itself still costs a flat 1 WCU (2 inside a transaction), NOT the
  // item's size-based cost: you're billed for the attempt, not the write.
  if (conditionRejected(prevState, op, baseIndex)) {
    const transactional = op.kind === "transact";
    const baseWrites = transactional ? 2 : 1;
    return {
      base: op.kind,
      baseWrites,
      indexes: gsis.map((g) => ({ index: g.name, effect: "none" as const, writes: 0 })),
      transactional,
      totalWrites: baseWrites,
      rejected: true,
    };
  }

  if (op.kind === "put") {
    const baseKey = keyOf(op.item, baseIndex);
    const prev = baseKey ? (prevState.get(baseKey) ?? null) : null;
    const indexes = gsis.map((g) => transitionCost(prev, op.item, g, baseIndex));
    const baseWrites = wcu(itemSize(op.item));
    return {
      base: "put",
      baseWrites,
      indexes,
      transactional: false,
      totalWrites: baseWrites + sumWrites(indexes),
    };
  }

  if (op.kind === "delete") {
    const prev = findById(prevState, op.id);
    const indexes = gsis.map((g) => removalCost(prev, g, baseIndex));
    const baseWrites = prev ? wcu(itemSize(prev)) : 0;
    return {
      base: "delete",
      baseWrites,
      indexes,
      transactional: false,
      totalWrites: baseWrites + sumWrites(indexes),
    };
  }

  // transact: apply each action against a running clone, accrue per-index cost,
  // then merge. Base writes are billed at 2× (transactional rate).
  const running = new Map(prevState);
  const perIndexParts = new Map<string, IndexCost[]>(gsis.map((g) => [g.name, []]));
  let baseWrites = 0;

  for (const action of op.actions) {
    if (action.kind === "put") {
      const baseKey = keyOf(action.item, baseIndex);
      const prev = baseKey ? (running.get(baseKey) ?? null) : null;
      for (const g of gsis) {
        perIndexParts.get(g.name)!.push(transitionCost(prev, action.item, g, baseIndex));
      }
      baseWrites += wcu(itemSize(action.item), true); // transactional 2×
    } else {
      const prev = findById(running, action.id);
      for (const g of gsis) {
        perIndexParts.get(g.name)!.push(removalCost(prev, g, baseIndex));
      }
      if (prev) baseWrites += wcu(itemSize(prev), true);
    }
    applyAction(running, action, baseIndex);
  }

  const indexes = gsis.map((g) => mergeIndex(g.name, perIndexParts.get(g.name)!));
  return {
    base: "transact",
    baseWrites,
    indexes,
    transactional: true,
    totalWrites: baseWrites + sumWrites(indexes),
  };
}
