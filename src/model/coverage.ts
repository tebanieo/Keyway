import { pkAttrs, skAttrs } from "../engine/engine";
import { parseExpression } from "../engine/expression";
import { attributeTypes, typeMismatches } from "../engine/keyhelp";
import { runQuery } from "../engine/query";
import type { QuerySpec } from "../engine/query";
import type { IndexSpec, Item } from "../engine/types";
import { fold } from "../engine/engine";
import { parseGetKey } from "./dsl";
import type { AccessPattern, ParseResult } from "./dsl";

/**
 * v2 access-pattern coverage: instead of "does the named index exist?", we build
 * the AP's declared query and actually RUN it against the folded model, then
 * grade the result. This is the original "can my design serve all my access
 * patterns?" check - and it teaches, because an invalid query surfaces the exact
 * key rule it broke.
 *
 *  - served     ✓ the query is valid and returns ≥1 item
 *  - empty      ⚠ valid query, but no item matches (the model can't answer it yet)
 *  - invalid    ⚠ the key conditions break a query rule (missing PK, range on a
 *                 non-last SK, a non-key attribute…) - the teaching case
 *  - assigned   ~ an index is named but no key condition is given to verify
 *  - no-index   ✗ names an index that isn't defined
 *  - unassigned ✗ no index named at all
 */
export type CoverageStatus =
  "served" | "empty" | "invalid" | "assigned" | "no-index" | "unassigned";

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

/** Turn the AP's key into the real request for `index` → a runnable QuerySpec,
 *  or DynamoDB's error when it isn't a valid read on that index. */
function buildSpec(
  readOp: "get" | "query" | "scan",
  index: IndexSpec,
  keyText: string,
): QuerySpec | string {
  const base = { getKey: null, key: null, filter: null, consistent: false };
  if (readOp === "scan") return { ...base, op: "scan" };
  const pks = pkAttrs(index);
  const sks = skAttrs(index);
  if (readOp === "get") {
    const key = parseGetKey(keyText);
    if (typeof key === "string") return key;
    return { ...base, op: "get", getKey: key };
  }
  const parsed = parseExpression(keyText, "key", { hash: pks, range: sks });
  if (!parsed.expression) return parsed.error ?? "invalid KeyConditionExpression";
  return { ...base, op: "query", key: parsed.expression };
}

export function apCoverage(
  ap: AccessPattern,
  indexes: IndexSpec[],
  state: Map<string, Item>,
): Coverage {
  if (!ap.index) {
    return {
      status: "unassigned",
      message: "no index assigned - add `-> Index`",
      returned: 0,
      scanned: 0,
    };
  }
  const index = indexes.find((i) => i.name === ap.index);
  if (!index) {
    return {
      status: "no-index",
      message: `index "${ap.index}" isn't defined`,
      returned: 0,
      scanned: 0,
    };
  }

  const readOp = ap.readOp ?? "query";
  const keyText = ap.keyText ?? "";
  if (keyText === "" && readOp !== "scan") {
    return {
      status: "assigned",
      message: "index exists, but no key condition to verify - add e.g. `PK = :u  :u=USER#1`",
      returned: 0,
      scanned: 0,
    };
  }

  const spec = buildSpec(readOp, index, keyText);
  if (typeof spec === "string") {
    return { status: "invalid", message: spec, returned: 0, scanned: 0 };
  }

  const r = runQuery(state, index, spec, indexes[0]);
  if (r.error) {
    return { status: "invalid", message: r.error, returned: 0, scanned: 0 };
  }
  if (r.items.length === 0) {
    // A type mismatch is the usual reason a valid query finds nothing: say so.
    const why = spec.key ? typeMismatches(spec.key, attributeTypes(state.values()))[0] : undefined;
    return {
      status: "empty",
      message: why
        ? `valid query, but no item matches: ${why}`
        : "valid query, but no item matches - the model can't answer it yet",
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

/**
 * Each `@ap`'s coverage as a note on its own line, for the editor: served
 * patterns get an info mark, the rest a warning with the reason. Runs every
 * pattern against the finished model, as the Access patterns panel does.
 */
export function apLineNotes(
  parsed: Pick<ParseResult, "aps" | "ops" | "base" | "gsis">,
): { line: number; severity: "info" | "warning"; message: string }[] {
  if (parsed.aps.length === 0) return [];
  const state = fold(parsed.ops, parsed.base);
  const indexes = [parsed.base, ...parsed.gsis];
  return parsed.aps
    .filter((ap) => ap.line !== undefined)
    .map((ap) => {
      const cov = apCoverage(ap, indexes, state);
      const served = cov.status === "served";
      return {
        line: ap.line!,
        severity: served ? "info" : "warning",
        message: `AP${ap.n} ${served ? "served" : cov.status}: ${cov.message}`,
      };
    });
}
