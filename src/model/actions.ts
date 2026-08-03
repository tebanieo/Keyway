import type { IndexSpec, Item, Op } from "../engine/types";
import { putItemOf } from "./backfill";

/**
 * Pure op-log / labelling helpers shared by the UI. None of these touch React:
 * they turn model data into ops or human-readable labels, so they live in the
 * model layer and stay unit-testable.
 */

/**
 * Next free `i1`, `i2`, … label for a new canvas-created item. It doubles as the
 * item's stable id AND its DSL label when serialized to the editor, so it must
 * be grammar-valid: a UUID has hyphens and breaks the label rule.
 */
export function nextItemLabel(ops: readonly Op[]): string {
  const used = new Set<string>();
  for (const op of ops) {
    const it = putItemOf(op);
    if (it) used.add(it.id);
    else if (op.kind === "delete") used.add(op.id);
  }
  let n = 1;
  while (used.has(`i${n}`)) n++;
  return `i${n}`;
}

/**
 * Turn a single cell edit into ops. A non-key change is one clean `put`. A base
 * key change is identity-changing, which DynamoDB models as an atomic
 * TransactWriteItems (delete old + put new), billed at 2× base.
 */
export function editToOps(item: Item, key: string, value: string, base: IndexSpec): Op[] {
  const attrs = { ...item.attrs, [key]: value };
  const next: Item = { id: item.id, attrs };
  if (key === base.pk || key === base.sk) {
    return [
      {
        kind: "transact",
        actions: [
          { kind: "delete", id: item.id },
          { kind: "put", item: next },
        ],
      },
    ];
  }
  return [{ kind: "put", item: next }];
}

/** `PK / SK` (or just PK for a PK-only table): the human key of an item. */
export function keyLabel(attrs: Record<string, string>, base: IndexSpec): string {
  const pk = attrs[base.pk] ?? "?";
  return base.sk ? `${pk} / ${attrs[base.sk] ?? "?"}` : pk;
}

/** A one-line summary of an op, for the step scrubber label. */
export function describe(op: Op | undefined, base: IndexSpec): { verb: string; detail: string } {
  if (!op) return { verb: "start", detail: "empty table" };
  if (op.kind === "delete") return { verb: "delete", detail: op.id };
  if (op.kind === "transact") {
    const p = op.actions.find((a) => a.kind === "put");
    const a = p?.kind === "put" ? p.item.attrs : undefined;
    return { verb: "transact", detail: a ? `${keyLabel(a, base)} (key change)` : "delete + put" };
  }
  return { verb: "put", detail: keyLabel(op.item.attrs, base) };
}
