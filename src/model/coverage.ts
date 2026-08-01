import { pkAttrs, skAttrs } from "../engine/engine";
import { runQuery } from "../engine/query";
import type { Cond, QuerySpec } from "../engine/query";
import type { IndexSpec, Item } from "../engine/types";
import type { AccessPattern, ApCond } from "./dsl";

/**
 * v2 access-pattern coverage: instead of "does the named index exist?", we build
 * the AP's declared query and actually RUN it against the folded model, then
 * grade the result. This is the original "can my design serve all my access
 * patterns?" check — and it teaches, because an invalid query surfaces the exact
 * key rule it broke.
 *
 *  - served     ✓ the query is valid and returns ≥1 item
 *  - empty      ⚠ valid query, but no item matches (the model can't answer it yet)
 *  - invalid    ⚠ the key conditions break a query rule (missing PK, range on a
 *                 non-last SK, a non-key attribute…) — the teaching case
 *  - assigned   ~ an index is named but no key condition is given to verify
 *  - no-index   ✗ names an index that isn't defined
 *  - unassigned ✗ no index named at all
 */
export type CoverageStatus =
  | "served"
  | "empty"
  | "invalid"
  | "assigned"
  | "no-index"
  | "unassigned";

export interface Coverage {
  status: CoverageStatus;
  message: string;
  /** Items the query returns (post-filter). */
  returned: number;
  /** Items the query reads (charged). */
  scanned: number;
}

/** Only a query that actually returns data counts as served. */
export function isServed(c: Coverage): boolean {
  return c.status === "served";
}

/** Map the AP's conditions onto the index's key shape → a runnable QuerySpec,
 *  or an error string if a condition doesn't fit the index's keys. */
function buildSpec(
  readOp: "get" | "query" | "scan",
  pks: string[],
  sks: string[],
  conds: ApCond[],
): QuerySpec | string {
  if (readOp === "scan") {
    return { op: "scan", pk: [], sk: [], skParts: [], filter: null, consistent: false };
  }
  const keyAttrs = new Set([...pks, ...sks]);
  const stray = conds.find((c) => !keyAttrs.has(c.attr));
  if (stray) {
    return `"${stray.attr}" isn't a key of this index (keys: ${[...pks, ...sks].join(", ")})`;
  }
  const byAttr = new Map(conds.map((c) => [c.attr, c]));
  const pk = pks.map((a) => byAttr.get(a)?.value ?? "");

  if (readOp === "get") {
    const sk = sks.map((a) => byAttr.get(a)?.value ?? "");
    return { op: "get", pk, sk, skParts: [], filter: null, consistent: false };
  }

  // query: the sort-key prefix — leading contiguous sort attributes that have a
  // condition. validate() (inside runQuery) enforces equality-except-last.
  const skParts: Cond[] = [];
  for (const a of sks) {
    const c = byAttr.get(a);
    if (!c) break;
    skParts.push({ op: c.op, value: c.value, value2: c.value2 });
  }
  return { op: "query", pk, sk: [], skParts, filter: null, consistent: false };
}

export function apCoverage(
  ap: AccessPattern,
  indexes: IndexSpec[],
  state: Map<string, Item>,
): Coverage {
  if (!ap.index) {
    return { status: "unassigned", message: "no index assigned — add `-> Index`", returned: 0, scanned: 0 };
  }
  const index = indexes.find((i) => i.name === ap.index);
  if (!index) {
    return { status: "no-index", message: `index "${ap.index}" isn't defined`, returned: 0, scanned: 0 };
  }

  const readOp = ap.readOp ?? "query";
  const conds = ap.conds ?? [];
  if (conds.length === 0 && readOp !== "scan") {
    return {
      status: "assigned",
      message: "index exists, but no key condition to verify — add e.g. `PK=USER#1`",
      returned: 0,
      scanned: 0,
    };
  }

  const spec = buildSpec(readOp, pkAttrs(index), skAttrs(index), conds);
  if (typeof spec === "string") {
    return { status: "invalid", message: spec, returned: 0, scanned: 0 };
  }

  const r = runQuery(state, index, spec);
  if (r.error) {
    return { status: "invalid", message: r.error, returned: 0, scanned: 0 };
  }
  if (r.items.length === 0) {
    return {
      status: "empty",
      message: "valid query, but no item matches — the model can't answer it yet",
      returned: 0,
      scanned: r.scanned,
    };
  }
  return {
    status: "served",
    message: `returns ${r.items.length} item${r.items.length === 1 ? "" : "s"}`,
    returned: r.items.length,
    scanned: r.scanned,
  };
}
