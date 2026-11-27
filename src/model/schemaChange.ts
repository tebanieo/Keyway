import { pkAttrs, skAttrs } from "../engine/engine";
import type { IndexSpec } from "../engine/types";

/**
 * What a schema edit would mean in real DynamoDB. In Keyway, changing a key
 * in `@table` or `@gsi` just rebuilds the tables; DynamoDB can't do that in
 * place, so the app says what the real-world operation is.
 */
export interface SchemaChange {
  kind: "table-keys" | "gsi-keys" | "gsi-added";
  index: string;
  message: string;
}

const keysOf = (ix: IndexSpec) => [...pkAttrs(ix), "|", ...skAttrs(ix)].join(",");
const show = (ix: IndexSpec) =>
  [`pk=${pkAttrs(ix).join(",")}`, skAttrs(ix).length ? `sk=${skAttrs(ix).join(",")}` : ""]
    .filter(Boolean)
    .join(" ");

/** The changes from `prev` to `next` worth explaining, for a table that holds
 *  data (an empty table has nothing to migrate or backfill). */
export function schemaChanges(
  prev: { base: IndexSpec; gsis: IndexSpec[] },
  next: { base: IndexSpec; gsis: IndexSpec[] },
): SchemaChange[] {
  const out: SchemaChange[] = [];
  if (keysOf(prev.base) !== keysOf(next.base)) {
    out.push({
      kind: "table-keys",
      index: next.base.name,
      message:
        `A table's primary key can't change. Moving ${next.base.name} from ` +
        `${show(prev.base)} to ${show(next.base)} means creating a new table and copying every ` +
        `item into it (a scan-and-write job, or export then import), then switching the app over.`,
    });
  }
  for (const g of next.gsis) {
    const before = prev.gsis.find((p) => p.name === g.name);
    if (!before) {
      out.push({
        kind: "gsi-added",
        index: g.name,
        message:
          `Adding ${g.name} to a table that holds data starts a backfill: DynamoDB writes an ` +
          `entry for every item that has its keys, billed as writes, and the index can't be ` +
          `queried until it's ACTIVE.`,
      });
    } else if (keysOf(before) !== keysOf(g)) {
      out.push({
        kind: "gsi-keys",
        index: g.name,
        message:
          `A GSI's keys can't be modified. Changing ${g.name} from ${show(before)} to ` +
          `${show(g)} means deleting the index and creating it again; the new one backfills ` +
          `from the table before it can be queried.`,
      });
    }
  }
  return out;
}
